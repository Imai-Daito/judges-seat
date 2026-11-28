---
inclusion: always
---

# Technology policy — Judges Seat

## Toolchain

- **pnpm only.** The root `preinstall` script rejects npm/yarn. Use the
  pnpm workspace with catalogs (`pnpm-workspace.yaml`); Node.js 24,
  TypeScript 5.9 (strict, project references via `tsconfig.base.json`).
- Frontend: React + Vite + Tailwind, framer-motion for reveal motion,
  `lucide-react` icons, `qrcode.react` for invites (`artifacts/judges-seat/`).
- API: **Express 5**, `cookie-parser`, pino logging, esbuild CJS bundle
  (`artifacts/api-server/`).
- DB: **PostgreSQL 16 + Drizzle ORM** (`lib/db/`). Schema lives in
  `lib/db/src/schema/`. Apply changes with `pnpm --filter @workspace/db run push`
  in dev only — never auto-migrate in production, never destructive diffs.
  The API checks required tables/columns read-only at startup and refuses to
  listen (with the dev-only fix command) if they are missing.
- Validation: Zod v4 + `drizzle-zod`.
- API contract: `lib/api-spec/openapi.yaml` is the single source of truth.
  After editing it, regenerate with `pnpm --filter @workspace/api-spec run codegen`
  (Orval → `lib/api-client-react/`, `lib/api-zod/`). Never hand-edit generated files.

## API & security rules

- Writes require the `X-Judges-Client: 1` header; no cross-origin CORS.
- Identity = HttpOnly cookie. Reconnection means same browser + same cookie.
- Writes are transaction-serialized with row locking + version checks;
  irreversible actions (publish) never retry silently and expect HTTP 409 on
  same-version collisions.
- SSE carries revision numbers only; each process discovers revisions from
  PostgreSQL, so multi-process sync works without in-memory state.
- `/api/healthz` = liveness only. `/api/readyz` = DB readiness
  (`200`/`503`, always `Cache-Control: no-store`, never connection details).
- Result links: organizer-controlled bearer tokens in the URL fragment;
  revocation destroys the token, re-enabling issues a new one; never log tokens.

## Rate limits (PostgreSQL-backed, fail closed)

- 600 writes/min per verified member per room; unverified traffic shares
  600 writes/min per normalized IP. Room creation: 20/h per device.
- Normalized-IP ceilings: 12,000 writes/min and 400 creations/h (bounds
  rotating-cookie abuse while allowing ~20 rooms on one Wi-Fi). IPv6 groups by /56.
- Failed requests count; limiter storage errors fail closed; reads and SSE
  stay available. Counters store hashed subjects and expire independently of rooms.

## Testing & verification commands

```bash
pnpm run typecheck            # everything
pnpm run build                # typecheck + build all packages
pnpm --filter @workspace/scripts run test:judging
pnpm --filter @workspace/scripts run test:judging-api
pnpm --filter @workspace/scripts run test:judging-limits
pnpm --filter @workspace/scripts run test:judging-sync
pnpm --filter @workspace/scripts run test:sharing
pnpm --filter @workspace/scripts run test:sharing-api
pnpm --filter @workspace/api-server test:readiness
pnpm --filter @workspace/api-server test:database-failures
pnpm --filter @workspace/judges-seat test:synchronization
```

- Fault suites spin up their own disposable PostgreSQL on Unix sockets
  (`initdb`/`pg_ctl` required) and never read `DATABASE_URL`, never stop the
  managed API, never touch shared data; they delete only rooms they created.
- When bundling Node tests with esbuild, bundle workspace dependencies
  explicitly — do not externalize them like installed npm packages
  (see `.agents/memory/test-bundling.md`).
- The live app must never import the mockup sandbox's local-storage state or
  demo data.
