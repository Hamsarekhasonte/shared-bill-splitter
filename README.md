# Shared Bill Splitter

A small household expense app for creating a shared home, splitting bills equally, recording payments safely, and seeing each member's outstanding balance.

## Project Overview

Create a home and add its members, then record bills in whole cents. Each bill is divided evenly across members, with remainder cents assigned in member insertion order. Members can mark individual shares paid. The ledger and balances are stored in D1.

## Technology Stack

- TypeScript, React 19, Vite, and TanStack Router
- Hono on Cloudflare Workers
- Cloudflare D1 (SQLite)
- Vitest in the Cloudflare Workers runtime for the API and jsdom for frontend tests
- Biome and pnpm workspaces

## Architecture

The `web` workspace contains the React single page app and proxies `/api` to the local Worker during development. The `api` workspace exposes Hono routes running on Cloudflare Workers. Its `DB` binding points to D1; the same SQL migrations initialize local development and the Workers test database.

## Features

- Create homes and add members in a stable insertion order
- Create equally split bills with deterministic remainder distribution
- Pay individual shares with idempotency keys
- View per-member outstanding balances
- JSON errors and input validation across the API
- Responsive dashboard with loading, empty, and error states

## Database Design

The migration creates `homes`, `members`, `bills`, and `shares`. Auto-incremented integer IDs preserve home/member/share insertion order. Bills use generated UUIDs so their IDs can be written explicitly to all rows in one atomic D1 batch. Named foreign keys connect members and bills to homes and shares to bills and members. Named checks require nonempty names/titles, positive whole bill cents, nonnegative whole share cents, and consistent payment state. A named unique constraint prevents duplicate shares for a bill/member pair. Indexes support home, bill, and unpaid-share lookups.

## API Documentation

All errors return `{ "error": "message" }`.

### `POST /api/homes`

Request: `{ "name": "Maple Street" }`

Response (`201`): `{ "id": "1", "name": "Maple Street" }`

### `POST /api/homes/:homeId/members`

Request: `{ "name": "Alice" }`

Response (`201`): `{ "id": "1", "homeId": "1", "name": "Alice" }`

### `POST /api/homes/:homeId/bills`

Request: `{ "title": "Electricity", "totalCents": 1000 }`

Response (`201`): `{ "id": "5ca5e1aa-0fb0-48bb-a8fa-0e31f2a1379c", "homeId": "1", "title": "Electricity", "totalCents": 1000, "shares": [{ "id": "1", "memberId": "1", "amountCents": 1000, "paidAt": null }] }`

### `POST /api/bills/:billId/shares/:shareId/pay`

Send an `Idempotency-Key` header. Response (`200`): `{ "id": "1", "memberId": "1", "amountCents": 1000, "paidAt": "2026-11-01T12:00:00.000Z" }`. Repeating the same key returns the original result; a different key after payment returns `409`.

### `GET /api/homes/:homeId/balances`

Response (`200`): `{ "balances": [{ "memberId": "1", "name": "Alice", "outstandingCents": 1000 }] }`

### Dashboard data: `GET /api/homes/:homeId`

Returns the home, ordered members, bills and their shares, and balances for the web app.

## Installation

```sh
pnpm install
```

## Local Development

```sh
pnpm dev
```

This applies local D1 migrations, then starts the API at `http://localhost:8787` and the Vite app at `http://localhost:5173`. Open the Vite URL and enter an existing home ID or create a home.

The API dev command applies local D1 migrations before starting Wrangler. To apply them without starting the app, use:

```sh
pnpm --filter bill-splitter-api exec wrangler d1 migrations apply DB --local
```

## Demo Instructions

Start the app with `pnpm dev`, then seed fictional demo data in another terminal:

```sh
pnpm --filter bill-splitter-api seed:local
```

The seed command uses Wrangler's local D1 database only, inserts or reuses a `Local Demo Home - Shared Bill Splitter`, and prints its home ID. It creates three members, one unpaid unevenly split bill, and one bill with a paid share. Re-running it does not delete or duplicate records. Open `http://localhost:5173`, enter the printed home ID, and use **Mark paid** on any unpaid share. The split bill form can create additional test bills. You can also create a fresh home and its members directly in the UI.

## Testing

```sh
pnpm test
```

`pnpm test` runs both suites: API integration tests in the Cloudflare Workers runtime against D1 migrations, and frontend interaction tests in jsdom.

## Quality Checks

```sh
pnpm check
pnpm typecheck
pnpm build
```

## Decisions

1. **Use integer cents and a stable remainder rule.** This avoids floating-point money errors and makes every split deterministic: the first members receive any leftover cents.
2. **Use conditional SQL updates and idempotency keys for payments.** The `paid_at IS NULL` condition makes the transition a single database operation; the stored key distinguishes a safe retry from a conflicting second payment.
3. **Enforce integrity in D1.** Named foreign keys, checks, and uniqueness constraints protect relationships and payment/share data even when writes do not come through the API.
