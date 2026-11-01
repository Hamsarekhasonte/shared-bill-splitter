import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Home } from '../routes/index'

type TestShare = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

type TestDashboard = {
  home: { id: string; name: string }
  members: { id: string; name: string }[]
  bills: {
    id: string
    title: string
    totalCents: number
    shares: TestShare[]
  }[]
  balances: { memberId: string; name: string; outstandingCents: number }[]
}

const unpaidDashboard: TestDashboard = {
  home: { id: 'home-1', name: 'Maple House' },
  members: [{ id: 'member-1', name: 'Asha' }],
  bills: [
    {
      id: 'bill-1',
      title: 'Internet',
      totalCents: 1200,
      shares: [{ id: 'share-1', memberId: 'member-1', amountCents: 1200, paidAt: null }],
    },
  ],
  balances: [{ memberId: 'member-1', name: 'Asha', outstandingCents: 1200 }],
}

const paidDashboard: TestDashboard = {
  ...unpaidDashboard,
  bills: [
    {
      id: 'bill-1',
      title: 'Internet',
      totalCents: 1200,
      shares: [
        {
          id: 'share-1',
          memberId: 'member-1',
          amountCents: 1200,
          paidAt: '2026-11-01T12:00:00.000Z',
        },
      ],
    },
  ],
  balances: [{ memberId: 'member-1', name: 'Asha', outstandingCents: 0 }],
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred promise was not initialized')
  }
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve: (value: T) => resolve(value) }
}

function fetchMock() {
  return vi.mocked(globalThis.fetch)
}

async function openHome(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: 'Home ID' }), 'home-1')
  await user.click(screen.getByRole('button', { name: /Open home/ }))
}

describe('home dashboard workflows', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000001',
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('shows loading while home data is pending', async () => {
    const user = userEvent.setup()
    const pending = deferred<Response>()
    fetchMock().mockReturnValueOnce(pending.promise)
    render(<Home />)

    await openHome(user)

    expect(screen.getByRole('status').textContent).toContain('Loading your home')
    pending.resolve(jsonResponse(unpaidDashboard))
    expect(await screen.findByRole('heading', { name: 'Maple House' })).not.toBeNull()
  })

  it('shows helpful empty states for a home without members or bills', async () => {
    const user = userEvent.setup()
    const emptyDashboard: TestDashboard = {
      home: { id: 'home-1', name: 'Quiet House' },
      members: [],
      bills: [],
      balances: [],
    }
    fetchMock().mockResolvedValueOnce(jsonResponse(emptyDashboard))
    render(<Home />)

    await openHome(user)

    expect(await screen.findByText('No bills yet')).not.toBeNull()
    expect(screen.getByText('Start by adding the people who share this home.')).not.toBeNull()
    expect(screen.getByText('Add members to see balances.')).not.toBeNull()
  })

  it.each([
    { status: 404, message: 'Home not found' },
    { status: 500, message: 'Service temporarily unavailable' },
  ])('shows API error responses ($status)', async ({ status, message }) => {
    const user = userEvent.setup()
    fetchMock().mockResolvedValueOnce(jsonResponse({ error: message }, status))
    render(<Home />)

    await openHome(user)

    expect((await screen.findByRole('alert')).textContent).toContain(message)
  })

  it('shows a useful message when the API cannot be reached', async () => {
    const user = userEvent.setup()
    fetchMock().mockRejectedValueOnce(new TypeError('Network unavailable'))
    render(<Home />)

    await openHome(user)

    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the API')
  })

  it('keeps a share due until the server confirms payment', async () => {
    const user = userEvent.setup()
    const payment = deferred<Response>()
    const refresh = deferred<Response>()
    let homeReads = 0
    fetchMock().mockImplementation((_input, init) => {
      if (init?.method === 'POST') return payment.promise
      homeReads += 1
      return homeReads === 1 ? Promise.resolve(jsonResponse(unpaidDashboard)) : refresh.promise
    })
    render(<Home />)
    await openHome(user)
    await screen.findByRole('heading', { name: 'Maple House' })

    await user.click(screen.getByRole('button', { name: 'Mark paid' }))
    expect(screen.getByText('Due')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Paying…' })).not.toBeNull()

    const postCall = fetchMock().mock.calls.find(([, init]) => init?.method === 'POST')
    expect(new Headers(postCall?.[1]?.headers).get('Idempotency-Key')).toBe(
      '00000000-0000-4000-8000-000000000001',
    )
    payment.resolve(
      jsonResponse({
        id: 'share-1',
        memberId: 'member-1',
        amountCents: 1200,
        paidAt: '2026-11-01T12:00:00.000Z',
      }),
    )

    expect(await screen.findByText('Paid')).not.toBeNull()
    refresh.resolve(jsonResponse(paidDashboard))
  })

  it('keeps a share unpaid and shows an error when payment fails', async () => {
    const user = userEvent.setup()
    fetchMock().mockResolvedValueOnce(jsonResponse(unpaidDashboard))
    render(<Home />)
    await openHome(user)
    await screen.findByRole('heading', { name: 'Maple House' })
    fetchMock().mockResolvedValueOnce(jsonResponse({ error: 'Payment service failed' }, 500))

    await user.click(screen.getByRole('button', { name: 'Mark paid' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Payment service failed')
    expect(screen.getByText('Due')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Mark paid' })).not.toBeNull()
  })

  it('prevents duplicate clicks while payment is processing', async () => {
    const user = userEvent.setup()
    const payment = deferred<Response>()
    let isPaid = false
    fetchMock().mockImplementation((_input, init) => {
      if (init?.method === 'POST') return payment.promise
      return Promise.resolve(jsonResponse(isPaid ? paidDashboard : unpaidDashboard))
    })
    render(<Home />)
    await openHome(user)
    await screen.findByRole('heading', { name: 'Maple House' })
    const payButton = screen.getByRole('button', { name: 'Mark paid' })

    await user.click(payButton)
    expect(screen.getByRole('button', { name: 'Paying…' }).hasAttribute('disabled')).toBe(true)
    await user.click(payButton)
    expect(fetchMock().mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)

    payment.resolve(
      jsonResponse({
        id: 'share-1',
        memberId: 'member-1',
        amountCents: 1200,
        paidAt: '2026-11-01T12:00:00.000Z',
      }),
    )
    isPaid = true
    expect(await screen.findByText('Paid')).not.toBeNull()
  })

  it('keeps the paid status after refresh and a full page reload', async () => {
    const user = userEvent.setup()
    let isPaid = false
    fetchMock().mockImplementation((_input, init) => {
      if (init?.method === 'POST') {
        isPaid = true
        return Promise.resolve(
          jsonResponse({
            id: 'share-1',
            memberId: 'member-1',
            amountCents: 1200,
            paidAt: '2026-11-01T12:00:00.000Z',
          }),
        )
      }
      return Promise.resolve(jsonResponse(isPaid ? paidDashboard : unpaidDashboard))
    })
    const firstRender = render(<Home />)
    await openHome(user)
    await screen.findByRole('heading', { name: 'Maple House' })
    await user.click(screen.getByRole('button', { name: 'Mark paid' }))
    expect(await screen.findByText('Paid')).not.toBeNull()

    firstRender.unmount()
    render(<Home />)

    expect(await screen.findByText('Paid')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull()
    expect(screen.getByText('$0.00')).not.toBeNull()
  })
})
