import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, createBill, createHome, type Share } from './helpers'

describe('API edge cases', () => {
  it('returns a JSON error for malformed request JSON', async () => {
    const response = await exports.default.fetch(
      new Request('http://localhost/api/homes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'A valid home name is required' })
  })

  it('allows only one concurrent payment with different keys', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')

    const responses = await Promise.all([
      call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': 'concurrent-first' },
      }),
      call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': 'concurrent-second' },
      }),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
  })

  it('returns the original result for simultaneous retries with the same key', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')
    const key = 'same-concurrent-operation'
    const path = `/api/bills/${bill.body.id}/shares/${share.id}/pay`

    const responses = await Promise.all([
      call<Share>('POST', path, { headers: { 'Idempotency-Key': key } }),
      call<Share>('POST', path, { headers: { 'Idempotency-Key': key } }),
    ])

    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(responses[0]?.body.paidAt).toBe(responses[1]?.body.paidAt)
  })

  it('does not pay a share through a different bill URL', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const firstBill = await createBill(homeId, 1000)
    const secondBill = await createBill(homeId, 1200)
    const share = firstBill.body.shares[0]
    if (!share) throw new Error('bill has no shares')

    const response = await call<Share>(
      'POST',
      `/api/bills/${secondBill.body.id}/shares/${share.id}/pay`,
      { headers: { 'Idempotency-Key': 'wrong-bill-operation' } },
    )

    expect(response.status).toBe(404)
  })

  it('rejects a blank idempotency key', async () => {
    const { homeId } = await createHome(['Asha'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')

    const response = await call<Share>(
      'POST',
      `/api/bills/${bill.body.id}/shares/${share.id}/pay`,
      { headers: { 'Idempotency-Key': '   ' } },
    )

    expect(response.status).toBe(400)
  })

  it('preserves the original payment after a conflicting key', async () => {
    const { homeId } = await createHome(['Asha'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')
    const path = `/api/bills/${bill.body.id}/shares/${share.id}/pay`
    const original = await call<Share>('POST', path, {
      headers: { 'Idempotency-Key': 'original-key' },
    })
    const conflict = await call<Share>('POST', path, {
      headers: { 'Idempotency-Key': 'conflicting-key' },
    })
    const retry = await call<Share>('POST', path, {
      headers: { 'Idempotency-Key': 'original-key' },
    })

    expect(original.status).toBe(200)
    expect(conflict.status).toBe(409)
    expect(retry.status).toBe(200)
    expect(retry.body.paidAt).toBe(original.body.paidAt)
  })

  it('rolls back the bill if a share insert fails within the batch', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    await env.DB.exec(
      `CREATE TRIGGER fail_share_insert BEFORE INSERT ON shares BEGIN SELECT RAISE(ABORT, 'forced failure'); END`,
    )

    try {
      const failedBill = await createBill(homeId, 1000)
      const remaining = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM bills WHERE home_id = ?',
      )
        .bind(Number(homeId))
        .first<{ count: number }>()

      expect(failedBill.status).toBe(500)
      expect(remaining?.count).toBe(0)
    } finally {
      await env.DB.exec('DROP TRIGGER fail_share_insert')
    }
  })

  it('leaves a share unpaid when the payment update fails', async () => {
    const { homeId } = await createHome(['Asha'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')
    await env.DB.exec(
      `CREATE TRIGGER fail_share_payment BEFORE UPDATE OF paid_at ON shares WHEN NEW.paid_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'forced failure'); END`,
    )

    try {
      const failedPayment = await call<Share>(
        'POST',
        `/api/bills/${bill.body.id}/shares/${share.id}/pay`,
        { headers: { 'Idempotency-Key': 'payment-that-fails' } },
      )
      const storedShare = await env.DB.prepare(
        'SELECT paid_at, idempotency_key FROM shares WHERE id = ?',
      )
        .bind(Number(share.id))
        .first<{ paid_at: string | null; idempotency_key: string | null }>()

      expect(failedPayment.status).toBe(500)
      expect(storedShare).toEqual({ paid_at: null, idempotency_key: null })
    } finally {
      await env.DB.exec('DROP TRIGGER fail_share_payment')
    }
  })
})
