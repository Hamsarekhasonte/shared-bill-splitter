import { type Context, Hono } from 'hono'

type Bindings = { DB: D1Database }
type HomeRow = { id: number; name: string }
type MemberRow = { id: number; home_id: number; name: string }
type BillRow = { id: string; home_id: number; title: string; total_cents: number }
type ShareRow = {
  id: number
  member_id: number
  amount_cents: number
  paid_at: string | null
  idempotency_key?: string | null
}

const app = new Hono<{ Bindings: Bindings }>()
const error = (
  c: Context<{ Bindings: Bindings }>,
  status: 400 | 404 | 409 | 422 | 500,
  message: string,
) => c.json({ error: message }, status)

async function bodyObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json()
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 120
}

function parseId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function validBillId(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value)
}

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const body = await bodyObject(c.req.raw)
  if (!body || !validName(body.name)) return error(c, 400, 'A valid home name is required')
  try {
    const result = await c.env.DB.prepare('INSERT INTO homes (name) VALUES (?)')
      .bind(body.name.trim())
      .run()
    return c.json({ id: String(result.meta.last_row_id), name: body.name.trim() }, 201)
  } catch {
    return error(c, 500, 'Could not create home')
  }
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = parseId(c.req.param('homeId'))
  if (homeId === null) return error(c, 404, 'Home not found')
  const body = await bodyObject(c.req.raw)
  if (!body || !validName(body.name)) return error(c, 400, 'A valid member name is required')
  try {
    const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
      .bind(homeId)
      .first<{ id: number }>()
    if (!home) return error(c, 404, 'Home not found')
    const result = await c.env.DB.prepare('INSERT INTO members (home_id, name) VALUES (?, ?)')
      .bind(homeId, body.name.trim())
      .run()
    return c.json(
      { id: String(result.meta.last_row_id), homeId: String(homeId), name: body.name.trim() },
      201,
    )
  } catch {
    return error(c, 500, 'Could not add member')
  }
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = parseId(c.req.param('homeId'))
  if (homeId === null) return error(c, 404, 'Home not found')
  const body = await bodyObject(c.req.raw)
  if (!body || !validName(body.title)) return error(c, 400, 'A valid bill title is required')
  if (
    typeof body.totalCents !== 'number' ||
    !Number.isSafeInteger(body.totalCents) ||
    body.totalCents <= 0
  ) {
    return error(c, 422, 'totalCents must be a positive whole number')
  }
  try {
    const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
      .bind(homeId)
      .first<{ id: number }>()
    if (!home) return error(c, 404, 'Home not found')
    const members = await c.env.DB.prepare('SELECT id FROM members WHERE home_id = ? ORDER BY id')
      .bind(homeId)
      .all<{ id: number }>()
    if (members.results.length === 0) return error(c, 422, 'Home has no members')
    const base = Math.floor(body.totalCents / members.results.length)
    const remainder = body.totalCents % members.results.length
    const shares = members.results.map((member, index) => ({
      memberId: member.id,
      amountCents: base + (index < remainder ? 1 : 0),
    }))
    if (shares.reduce((sum, share) => sum + share.amountCents, 0) !== body.totalCents)
      return error(c, 500, 'Could not split bill')
    const billId = crypto.randomUUID()
    const statements = [
      c.env.DB.prepare(
        'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
      ).bind(billId, homeId, body.title.trim(), body.totalCents),
    ]
    for (const share of shares) {
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO shares (bill_id, member_id, amount_cents) VALUES (?, ?, ?)',
        ).bind(billId, share.memberId, share.amountCents),
      )
    }
    await c.env.DB.batch(statements)
    const storedShares = await c.env.DB.prepare(
      'SELECT id, member_id, amount_cents, paid_at FROM shares WHERE bill_id = ? ORDER BY id',
    )
      .bind(billId)
      .all<ShareRow>()
    return c.json(
      {
        id: billId,
        homeId: String(homeId),
        title: body.title.trim(),
        totalCents: body.totalCents,
        shares: storedShares.results.map((share) => ({
          id: String(share.id),
          memberId: String(share.member_id),
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        })),
      },
      201,
    )
  } catch {
    return error(c, 500, 'Could not create bill')
  }
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = parseId(c.req.param('shareId'))
  const key = c.req.header('Idempotency-Key')
  if (!key || key.trim().length === 0 || key.length > 200)
    return error(c, 400, 'A valid Idempotency-Key header is required')
  if (!validBillId(billId) || shareId === null) return error(c, 404, 'Bill or share not found')
  try {
    const now = new Date().toISOString()
    const update = await c.env.DB.prepare(
      'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
    )
      .bind(now, key, shareId, billId)
      .run()
    const share = await c.env.DB.prepare(
      'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
    )
      .bind(shareId, billId)
      .first<ShareRow>()
    if (!share) return error(c, 404, 'Bill or share not found')
    if (update.meta.changes === 1 || share.idempotency_key === key) {
      return c.json({
        id: String(share.id),
        memberId: String(share.member_id),
        amountCents: share.amount_cents,
        paidAt: share.paid_at,
      })
    }
    return error(c, 409, 'Share has already been paid with a different key')
  } catch {
    return error(c, 500, 'Could not process payment')
  }
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = parseId(c.req.param('homeId'))
  if (homeId === null) return error(c, 404, 'Home not found')
  try {
    const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
      .bind(homeId)
      .first<{ id: number }>()
    if (!home) return error(c, 404, 'Home not found')
    const result =
      await c.env.DB.prepare(`SELECT m.id AS member_id, m.name, COALESCE(SUM(CASE WHEN s.paid_at IS NULL AND b.home_id = m.home_id THEN s.amount_cents ELSE 0 END), 0) AS outstanding_cents
      FROM members m LEFT JOIN shares s ON s.member_id = m.id LEFT JOIN bills b ON b.id = s.bill_id AND b.home_id = m.home_id
      WHERE m.home_id = ? GROUP BY m.id, m.name ORDER BY m.id`)
        .bind(homeId)
        .all<{ member_id: number; name: string; outstanding_cents: number }>()
    return c.json({
      balances: result.results.map((row) => ({
        memberId: String(row.member_id),
        name: row.name,
        outstandingCents: row.outstanding_cents,
      })),
    })
  } catch {
    return error(c, 500, 'Could not load balances')
  }
})

app.get('/api/homes/:homeId', async (c) => {
  const homeId = parseId(c.req.param('homeId'))
  if (homeId === null) return error(c, 404, 'Home not found')
  try {
    const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
      .bind(homeId)
      .first<HomeRow>()
    if (!home) return error(c, 404, 'Home not found')
    const bills = await c.env.DB.prepare(
      'SELECT id, home_id, title, total_cents FROM bills WHERE home_id = ? ORDER BY created_at DESC, id DESC',
    )
      .bind(homeId)
      .all<BillRow>()
    const members = await c.env.DB.prepare(
      'SELECT id, home_id, name FROM members WHERE home_id = ? ORDER BY id',
    )
      .bind(homeId)
      .all<MemberRow>()
    const shares = await c.env.DB.prepare(
      `SELECT s.id, s.member_id, s.amount_cents, s.paid_at, s.bill_id FROM shares s JOIN bills b ON b.id = s.bill_id WHERE b.home_id = ? ORDER BY s.id`,
    )
      .bind(homeId)
      .all<ShareRow & { bill_id: string }>()
    const balances = await c.env.DB.prepare(
      `SELECT m.id AS member_id, m.name, COALESCE(SUM(CASE WHEN s.paid_at IS NULL AND b.home_id = m.home_id THEN s.amount_cents ELSE 0 END), 0) AS outstanding_cents FROM members m LEFT JOIN shares s ON s.member_id = m.id LEFT JOIN bills b ON b.id = s.bill_id AND b.home_id = m.home_id WHERE m.home_id = ? GROUP BY m.id, m.name ORDER BY m.id`,
    )
      .bind(homeId)
      .all<{ member_id: number; name: string; outstanding_cents: number }>()
    return c.json({
      home: { id: String(home.id), name: home.name },
      members: members.results.map((member) => ({ id: String(member.id), name: member.name })),
      bills: bills.results.map((bill) => ({
        id: String(bill.id),
        title: bill.title,
        totalCents: bill.total_cents,
        shares: shares.results
          .filter((share) => share.bill_id === bill.id)
          .map((share) => ({
            id: String(share.id),
            memberId: String(share.member_id),
            amountCents: share.amount_cents,
            paidAt: share.paid_at,
          })),
      })),
      balances: balances.results.map((row) => ({
        memberId: String(row.member_id),
        name: row.name,
        outstandingCents: row.outstanding_cents,
      })),
    })
  } catch {
    return error(c, 500, 'Could not load home')
  }
})

app.notFound((c) => error(c, 404, 'Not found'))
app.onError((_cause, c) => error(c, 500, 'Unexpected server error'))

export default app
