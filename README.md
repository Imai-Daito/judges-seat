# Judges Seat （審査員席）

An unofficial watch-party scoring app for friend groups watching the same TV.
Everyone scores each act from their own phone, the host publishes all scores at
once with a TV-style stepped reveal, and the final showdown is decided by a
plaque-flip vote. Think of it as a pocket "judges' seat" for the manzai
battle on screen — 漫才採点バトル.

Kiroween 2026 entry (Costume Contest).

## Features

- **No login.** Join from a QR code / invite link with just a nickname. Identity
  is a HttpOnly cookie bound to the browser; losing the cookie loses the seat.
- **Scoring.** Each act is scored 0–100 in 1-point steps via an on-screen digit
  pad plus ± buttons. Ranking is by the sum of all judges' scores.
- **One-press reveal.** When every judge has submitted, the host publishes and
  every score is revealed automatically, one judge at a time: a large card is
  hurled from the front and lands (with one vertical spin) in its slot, then
  the grand total appears. 90+ gold, 80+ silver, below bronze.
- **Final vote.** Each judge votes for one finalist. On publish, each judge's
  plaque flips one by one to the voted finalist's color (red / blue / yellow for
  the first three candidates, stable per candidate across revotes). Vote
  counts appear only after every plaque has turned.
- **Ties.** Equal total scores share a rank (e.g. 1st, 1st, 3rd). A tie for
  the most final votes triggers exactly one runoff between the tied acts; a
  second tie means co-champions.
- **Results.** Overall ranking, champion and vote breakdown (including the
  runoff), everyone's scorecards, and your own rank vs. the overall rank.
  Save the results as an image, or share a read-only public link that the
  organizer explicitly enables/revokes (separate from the invite link; the
  token stays in the URL fragment).
- **Privacy.** Unpublished scores and votes are never sent to anyone — not
  even the organizer. Server-sent events carry revision numbers only, never
  room state. Rooms and results expire 30 days after creation.
- **Built to scale a living room.** 20 judges on the same Wi-Fi are supported
  (per-member and per-IP rate limits in PostgreSQL; failures fail closed).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + framer-motion (`artifacts/judges-seat/`)
- API: Express 5 (`artifacts/api-server/`), cookie identity, SSE revisions
- DB: PostgreSQL 16 + Drizzle ORM (`lib/db/`)
- Validation: Zod (`zod/v4`) + `drizzle-zod`
- API contract: OpenAPI (`lib/api-spec/openapi.yaml`) → Orval codegen into
  `lib/api-client-react/` and `lib/api-zod/`
- Build: esbuild (CJS bundle)

## Quickstart (Replit)

This repository is a Replit workspace. Open it in Replit and the managed
workflows start the API server and the web preview automatically.

Locally / manually:

```bash
pnpm install                 # pnpm is enforced by preinstall
pnpm --filter @workspace/db run push   # dev only: apply DB schema
export DATABASE_URL=postgres://...    # required by the API
pnpm --filter @workspace/api-server run dev
# in another shell: serve artifacts/judges-seat (vite dev / build+preview)
```

See `replit.md` for the full command list.

## Tests & verification

```bash
pnpm run typecheck           # full typecheck across all packages
pnpm run build               # typecheck + build all packages
pnpm --filter @workspace/scripts run test:judging         # scoring / privacy / single-runoff rules
pnpm --filter @workspace/scripts run test:judging-api     # HTTP/SSE, 20 sessions, crash/restart, expiry
pnpm --filter @workspace/scripts run test:judging-limits  # real Postgres rate limits, one Wi-Fi, 429s
pnpm --filter @workspace/scripts run test:judging-sync    # reconnect, stale/expiry races, reveal timing
pnpm --filter @workspace/scripts run test:sharing         # share image coverage, ties, private-field exclusion
pnpm --filter @workspace/scripts run test:sharing-api     # opt-in/out, organizer permission, public data
pnpm --filter @workspace/api-server test:readiness        # /api/readyz against a disposable Postgres
pnpm --filter @workspace/api-server test:database-failures
pnpm --filter @workspace/judges-seat test:synchronization
```

Fault-injection suites start their own disposable PostgreSQL on Unix sockets
and never touch the managed API workflow or shared data.

## Repository layout

- `artifacts/judges-seat/` — the room application (the mockup sandbox is kept
  untouched for reference)
- `artifacts/api-server/` — Express 5 API; authoritative room transitions in
  `src/lib/judging.ts`, routes/SSE in `src/routes/rooms.ts`
- `lib/db/` — Drizzle schema (`src/schema/judging.ts`, `rate-limits.ts`)
- `lib/api-spec/` — OpenAPI contract + Orval config (regenerate clients after edits)
- `.kiro/` — Kiro steering rules and the `spooky-ui` spec driving this build

## License

MIT © 2026 Daito Imai — see [LICENSE](LICENSE).
