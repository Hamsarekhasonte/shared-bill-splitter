import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import './styles.css'

type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
type Bill = { id: string; title: string; totalCents: number; shares: Share[] }
type Member = { id: string; name: string }
type Balance = { memberId: string; name: string; outstandingCents: number }
type Dashboard = {
  home: { id: string; name: string }
  members: Member[]
  bills: Bill[]
  balances: Balance[]
}

export const Route = createFileRoute('/')({ component: Home })

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isShare(value: unknown): value is Share {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.memberId === 'string' &&
    typeof value.amountCents === 'number' &&
    Number.isSafeInteger(value.amountCents) &&
    value.amountCents >= 0 &&
    (typeof value.paidAt === 'string' || value.paidAt === null)
  )
}

function isDashboard(value: unknown): value is Dashboard {
  return (
    isRecord(value) &&
    isRecord(value.home) &&
    typeof value.home.id === 'string' &&
    typeof value.home.name === 'string' &&
    Array.isArray(value.members) &&
    value.members.every(
      (member) =>
        isRecord(member) && typeof member.id === 'string' && typeof member.name === 'string',
    ) &&
    Array.isArray(value.bills) &&
    value.bills.every(
      (bill) =>
        isRecord(bill) &&
        typeof bill.id === 'string' &&
        typeof bill.title === 'string' &&
        typeof bill.totalCents === 'number' &&
        Number.isSafeInteger(bill.totalCents) &&
        bill.totalCents > 0 &&
        Array.isArray(bill.shares) &&
        bill.shares.every(isShare),
    ) &&
    Array.isArray(value.balances) &&
    value.balances.every(
      (balance) =>
        isRecord(balance) &&
        typeof balance.memberId === 'string' &&
        typeof balance.name === 'string' &&
        typeof balance.outstandingCents === 'number' &&
        Number.isSafeInteger(balance.outstandingCents) &&
        balance.outstandingCents >= 0,
    )
  )
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new ApiError(
      'Could not reach the API. Check that the local server is running and try again.',
      null,
    )
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError(
      response.ok
        ? 'The API returned an unexpected response.'
        : `Request failed (${response.status}).`,
      response.status,
    )
  }
  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `Request failed (${response.status}).`
    throw new ApiError(message, response.status)
  }
  return payload
}

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  )
}

export function Home() {
  const [homeId, setHomeId] = useState(() => localStorage.getItem('bill-splitter-home') ?? '')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [homeName, setHomeName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [billTitle, setBillTitle] = useState('')
  const [billAmount, setBillAmount] = useState('')
  const [paymentKeys] = useState(() => new Map<string, string>())

  const load = useCallback(async (id: string) => {
    if (!id.trim()) return
    setLoading(true)
    setErrorMessage('')
    try {
      const data = await request(`/api/homes/${encodeURIComponent(id.trim())}`)
      if (!isDashboard(data)) throw new ApiError('The API returned unexpected home data.', 200)
      setDashboard(data)
      setHomeId(id.trim())
      localStorage.setItem('bill-splitter-home', id.trim())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not load this home.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const storedHomeId = localStorage.getItem('bill-splitter-home')
    if (storedHomeId) void load(storedHomeId)
  }, [load])

  const membersById = useMemo(
    () => new Map(dashboard?.members.map((member) => [member.id, member.name]) ?? []),
    [dashboard],
  )

  async function createHome(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setWorking('home')
    setErrorMessage('')
    try {
      const result = await request('/api/homes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: homeName }),
      })
      if (!isRecord(result) || typeof result.id !== 'string') {
        throw new ApiError('The API returned unexpected home data.', 201)
      }
      setHomeName('')
      await load(result.id)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create home.')
    } finally {
      setWorking(null)
    }
  }

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dashboard) return
    setWorking('member')
    setErrorMessage('')
    try {
      await request(`/api/homes/${dashboard.home.id}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: memberName }),
      })
      setMemberName('')
      await load(dashboard.home.id)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not add member.')
    } finally {
      setWorking(null)
    }
  }

  async function createBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dashboard) return
    setWorking('bill')
    setErrorMessage('')
    try {
      await request(`/api/homes/${dashboard.home.id}/bills`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: billTitle, totalCents: Number(billAmount) }),
      })
      setBillTitle('')
      setBillAmount('')
      await load(dashboard.home.id)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create bill.')
    } finally {
      setWorking(null)
    }
  }

  async function pay(billId: string, shareId: string) {
    const operationId = `${billId}:${shareId}`
    const key = paymentKeys.get(operationId) ?? crypto.randomUUID()
    paymentKeys.set(operationId, key)
    setWorking(operationId)
    setErrorMessage('')
    try {
      const result = await request(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
      })
      if (!isShare(result) || result.paidAt === null || result.id !== shareId) {
        throw new ApiError('The API returned unexpected payment data.', 200)
      }
      setDashboard((current) =>
        current
          ? {
              ...current,
              bills: current.bills.map((bill) =>
                bill.id === billId
                  ? {
                      ...bill,
                      shares: bill.shares.map((share) =>
                        share.id === shareId ? { ...share, paidAt: result.paidAt } : share,
                      ),
                    }
                  : bill,
              ),
            }
          : current,
      )
      paymentKeys.delete(operationId)
      await load(homeId)
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status !== null &&
        error.status >= 400 &&
        error.status < 500
      ) {
        paymentKeys.delete(operationId)
      }
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Payment failed. The share remains unpaid; retry to safely check the result.',
      )
      if (error instanceof ApiError && error.status === 409) {
        await load(homeId)
        setErrorMessage(error.message)
      }
    } finally {
      setWorking(null)
    }
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Shared home home">
          <span className="brand-mark">⌂</span>
          <span>
            common<span className="brand-light">/place</span>
          </span>
        </a>
        <span className="top-note">A calmer way to split household costs</span>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">SHARED HOME, CLEAR ACCOUNTS</span>
          <h1>
            Good living.
            <br />
            <em>Fair splitting.</em>
          </h1>
          <p>
            Keep household bills simple. Add your people, split each cost evenly, and see what
            everyone still owes.
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="sun" />
          <div className="art-house">
            <div className="roof" />
            <div className="house-body">
              <div className="window" />
              <div className="door" />
            </div>
            <div className="plant plant-one">✳</div>
            <div className="plant plant-two">✳</div>
          </div>
          <div className="art-caption">A little more together.</div>
        </div>
      </section>

      <div className="content-grid">
        <section className="main-column">
          {!dashboard ? (
            <section className="panel welcome-panel">
              <div className="section-kicker">GET STARTED</div>
              <h2>Find your home</h2>
              <p>Enter a home ID to see bills, or create a home to get started.</p>
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void load(homeId)
                }}
              >
                <label className="sr-only" htmlFor="home-id">
                  Home ID
                </label>
                <input
                  id="home-id"
                  value={homeId}
                  onChange={(event) => setHomeId(event.target.value)}
                  placeholder="Home ID"
                />
                <button
                  className="button button-dark"
                  type="submit"
                  disabled={loading || !homeId.trim()}
                >
                  Open home <span>↗</span>
                </button>
              </form>
              <div className="form-divider">
                <span>OR CREATE A NEW HOME</span>
              </div>
              <form className="inline-form" onSubmit={createHome}>
                <label className="sr-only" htmlFor="new-home">
                  Home name
                </label>
                <input
                  id="new-home"
                  value={homeName}
                  onChange={(event) => setHomeName(event.target.value)}
                  placeholder="e.g. Maple Street Flat"
                  required
                  maxLength={120}
                />
                <button className="button button-sage" type="submit" disabled={working === 'home'}>
                  {working === 'home' ? 'Creating…' : 'Create home'}
                </button>
              </form>
            </section>
          ) : (
            <>
              <section className="home-heading">
                <div>
                  <div className="section-kicker">YOUR HOUSEHOLD</div>
                  <h2>{dashboard.home.name}</h2>
                  <p>
                    Home ID <span className="home-id">{dashboard.home.id}</span>
                  </p>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    setDashboard(null)
                    setHomeId('')
                  }}
                >
                  Switch home ↗
                </button>
              </section>
              {dashboard.members.length === 0 && (
                <div className="empty-members">Start by adding the people who share this home.</div>
              )}
              <section className="bills-section">
                <div className="section-heading">
                  <div>
                    <div className="section-kicker">THE HOUSEHOLD LEDGER</div>
                    <h2>
                      Bills <span className="count">{dashboard.bills.length}</span>
                    </h2>
                  </div>
                  <span className="small-note">Most recent first</span>
                </div>
                {dashboard.bills.length === 0 ? (
                  <div className="empty-card">
                    <div className="empty-icon">＋</div>
                    <h3>No bills yet</h3>
                    <p>Add your first shared expense to start tracking balances.</p>
                  </div>
                ) : (
                  <div className="bill-list">
                    {dashboard.bills.map((bill) => (
                      <article className="bill-card" key={bill.id}>
                        <div className="bill-top">
                          <div>
                            <span className="bill-label">SHARED BILL</span>
                            <h3>{bill.title}</h3>
                          </div>
                          <div className="bill-total">
                            {money(bill.totalCents)}
                            <small>total</small>
                          </div>
                        </div>
                        <div className="share-list">
                          {bill.shares.map((share) => (
                            <div className="share-row" key={share.id}>
                              <div className="avatar">
                                {(membersById.get(share.memberId) ?? '?').slice(0, 1).toUpperCase()}
                              </div>
                              <div className="share-person">
                                <strong>
                                  {membersById.get(share.memberId) ?? 'Former member'}
                                </strong>
                                <span>{money(share.amountCents)} share</span>
                              </div>
                              {share.paidAt ? (
                                <span className="status status-paid">
                                  <span />
                                  Paid
                                </span>
                              ) : (
                                <>
                                  <span className="status status-due">
                                    <span />
                                    Due
                                  </span>
                                  <button
                                    className="pay-button"
                                    type="button"
                                    onClick={() => void pay(bill.id, share.id)}
                                    disabled={
                                      working === `${bill.id}:${share.id}` || working !== null
                                    }
                                  >
                                    {working === `${bill.id}:${share.id}` ? 'Paying…' : 'Mark paid'}
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
          {errorMessage && (
            <div className="alert" role="alert">
              <span className="alert-icon">!</span>
              <span>{errorMessage}</span>
              <button type="button" aria-label="Dismiss error" onClick={() => setErrorMessage('')}>
                ×
              </button>
            </div>
          )}
          {loading && (
            <div className="loading-state" role="status">
              <span className="spinner" />
              Loading your home…
            </div>
          )}
        </section>

        <aside className="side-column">
          {dashboard ? (
            <>
              <section className="balance-panel">
                <div className="section-kicker">AT A GLANCE</div>
                <h2>Outstanding</h2>
                <p className="balance-intro">What each person has left to pay.</p>
                {dashboard.balances.length === 0 ? (
                  <p className="muted">Add members to see balances.</p>
                ) : (
                  <div className="balance-list">
                    {dashboard.balances.map((balance) => (
                      <div className="balance-row" key={balance.memberId}>
                        <div className="balance-name">
                          <span className="mini-avatar">
                            {balance.name.slice(0, 1).toUpperCase()}
                          </span>
                          {balance.name}
                        </div>
                        <strong
                          className={balance.outstandingCents ? 'amount-due' : 'amount-clear'}
                        >
                          {money(balance.outstandingCents)}
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
                <div className="balance-foot">
                  Updated just now <span>↻</span>
                </div>
              </section>
              <section className="panel compact-panel">
                <div className="section-kicker">HOUSEHOLD</div>
                <h3>
                  Your people <span className="count">{dashboard.members.length}</span>
                </h3>
                <div className="member-chips">
                  {dashboard.members.map((member) => (
                    <span className="member-chip" key={member.id}>
                      <span>{member.name.slice(0, 1).toUpperCase()}</span>
                      {member.name}
                    </span>
                  ))}
                </div>
                <form className="stack-form" onSubmit={addMember}>
                  <label htmlFor="member-name">Add a member</label>
                  <div className="input-button">
                    <input
                      id="member-name"
                      value={memberName}
                      onChange={(event) => setMemberName(event.target.value)}
                      placeholder="Their name"
                      required
                      maxLength={120}
                    />
                    <button type="submit" aria-label="Add member" disabled={working === 'member'}>
                      ＋
                    </button>
                  </div>
                </form>
              </section>
              <section className="panel compact-panel bill-form-panel">
                <div className="section-kicker">NEW EXPENSE</div>
                <h3>Split a bill</h3>
                <form className="stack-form" onSubmit={createBill}>
                  <label htmlFor="bill-title">Bill name</label>
                  <input
                    id="bill-title"
                    value={billTitle}
                    onChange={(event) => setBillTitle(event.target.value)}
                    placeholder="e.g. Internet"
                    required
                    maxLength={120}
                  />
                  <label htmlFor="bill-amount">
                    Total amount <span>in cents</span>
                  </label>
                  <input
                    id="bill-amount"
                    value={billAmount}
                    onChange={(event) => setBillAmount(event.target.value)}
                    placeholder="e.g. 8500"
                    inputMode="numeric"
                    pattern="[0-9]+"
                    required
                  />
                  <button
                    className="button button-dark full-button"
                    type="submit"
                    disabled={working === 'bill' || dashboard.members.length === 0}
                  >
                    {working === 'bill' ? 'Splitting…' : 'Split evenly'} <span>↗</span>
                  </button>
                  {dashboard.members.length === 0 && (
                    <small>Add a member before splitting a bill.</small>
                  )}
                </form>
              </section>
            </>
          ) : (
            <section className="side-note">
              <div className="note-mark">✳</div>
              <h3>
                Made for the
                <br />
                people you live with.
              </h3>
              <p>One clear place for shared bills and who owes what.</p>
              <div className="note-rule" />
              <span className="note-caption">SHARE THE LOAD, KEEP THE PEACE</span>
            </section>
          )}
        </aside>
      </div>
      <footer className="footer">
        <span>common/place</span>
        <span>Shared costs, made clearer.</span>
        <span>✳</span>
      </footer>
    </main>
  )
}
