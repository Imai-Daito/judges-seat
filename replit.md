# 審査員席

友達が同じテレビを囲み、それぞれのスマホで採点と最終決戦の投票を行う非公式観戦アプリ。

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port injected by managed workflow)
- `artifacts/judges-seat: web` — managed web workflow, preview `/`
- `pnpm --filter @workspace/scripts run test:judging` — scoring, permissions, privacy, single-runoff rules
- `pnpm --filter @workspace/scripts run test:judging-api` — real HTTP/SSE basics plus 20-session, two-process crash/restart and expiry tests (requires running API, shared proxy and development DB)
- `pnpm --filter @workspace/scripts run test:judging-limits` — real PostgreSQL/two-process rate limits, same-Wi-Fi isolation, restart, expiry and 429 headers
- `pnpm --filter @workspace/scripts run test:judging-sync` — client reconnection, stale-response/expiry races, duplicate-submit protection and 20-judge reveal timing in a simulated DOM
- `pnpm --filter @workspace/scripts run test:sharing` — image pagination, complete score/vote coverage, ties and private-field exclusion
- `pnpm --filter @workspace/scripts run test:sharing-api` — independent HTTP sessions for opt-in/out, organizer permissions, public data and expiry
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/judges-seat/` — actual room application; mockup remains untouched for reference
- `artifacts/api-server/src/lib/judging.ts` — authoritative room transitions and per-participant response projection
- `artifacts/api-server/src/routes/rooms.ts` — cookie identity, transaction-serialized writes, SSE revisions
- `lib/db/src/schema/judging.ts` — PostgreSQL room persistence and expiry
- `lib/api-spec/openapi.yaml` — API contract, regenerate helpers after edits

## Architecture decisions

- Never send another participant's unpublished score or vote, including to the organizer. SSE contains only revision numbers, not room state.
- Row locking plus version checking prevents races between editing, joining, and publication. Do not weaken those checks or retry irreversible actions silently.
- Reconnection uses the same browser's HttpOnly cookie. Losing cookies loses the seat; there is intentionally no nickname-only recovery that could impersonate someone.
- Each running instance discovers revisions from PostgreSQL, so synchronization does not depend on an in-memory participant list or single process.
- Write budgets are shared in PostgreSQL: 600/minute per verified member per room; unverified traffic shares 600/minute per normalized IP. Creation is 20/hour per device. Additional normalized-IP ceilings (12,000 writes/minute, 400 creations/hour) bound rotating-cookie abuse while allowing 20 room groups on one Wi-Fi. IPv6 uses /56 grouping. Failures count, limiter storage errors fail closed, and reads/SSE remain accessible. Device cookies are not proof of membership: only identities stored in live rooms receive member budgets.
- Rate-limit counters store hashed subjects, expire independently of rooms, and are cleaned at startup and hourly. Apply the additive DB schema before starting updated servers; never run the migration against production as part of a task.
- API startup checks required room/counter columns read-only before listening. A missing table/column stops startup with the table name and development-only schema command; it never changes schema automatically. For development, confirm the database target and approval before `pnpm --filter @workspace/db run push` (also run by the existing post-merge setup). Do not force a destructive diff. Expiry errors identify the affected table and do not skip cleanup of the other table.

## Product

ログイン不要の招待リンク・QR・ニックネーム参加。幹事が開始すると参加者が固定され、全員の提出後に公開。未公開の自分の点数・票だけ修正可能。合計同点は同率順位、決勝の同票は最多同票組で一度だけ再投票し、さらに同票なら同率優勝。全体・個人順位、全員の公開採点・投票履歴を表示。

## User preferences

確定した保存期間、採点・投票ルール、発表の動き・文字・配色は `.agents/memory/judging-product.md` を参照。

## Gotchas

- Expired rooms are immediately inaccessible; hourly cleanup deletes expired rows while a server is running, and cleanup also runs at startup.
- API integration checks create independent temporary test rooms, which expire under the same 30-day policy.
- Fault tests start disposable API processes on Unix sockets, never stop the managed API workflow, and delete only their own newly created room. Their intentional same-version collisions expect HTTP 409; only test submissions retry after a newer revision, never publication.
- `pnpm --filter @workspace/api-server test:database-failures` starts a disposable, Unix-socket-only PostgreSQL cluster (requires `initdb`/`pg_ctl`). It never reads `DATABASE_URL` or imports the shared DB client. It verifies real statement timeouts, aborted updates, rejected commits, lost commit acknowledgements, failed rollbacks, connection release and SSE cleanup. `pnpm --filter @workspace/judges-seat test:synchronization` checks hook/rendered error state and read-only recovery with controlled fetch/SSE failures.
- `/api/healthz` remains process liveness only (`200 {"status":"ok"}`), including during database outages. Use `/api/readyz` for ongoing database readiness: `200 {"status":"ok"}` or `503 {"status":"unavailable"}`, always `Cache-Control: no-store`, never connection/error details. It checks required columns and SELECT access without reading rows or writing data; it does not prove writes will succeed. The one-second deadline covers acquisition plus SQL; concurrent checks share one probe, timed-out queries discard their client, and a pending acquisition cannot accumulate across repeated probes. Idle pool errors are handled without exposing connection details or crashing the API.
- `pnpm --filter @workspace/api-server test:readiness` uses its own Unix-socket-only PostgreSQL cluster and read-only role to check readiness, schema/permission failures, lock timeouts, pool saturation, actual database stop/restart, liveness compatibility, unchanged data and connection cleanup. It never reads `DATABASE_URL`, stops the managed API or touches shared data.
- Both fault suites also cover result-link enabling, stopping and re-enabling: rolled-back writes, lost commit acknowledgements/HTTP replies, read-only recovery, token revocation/rotation, and no automatic toggle replay. UI sharing checks render the actual Results screen with the generated HTTP client; all database faults stay in the disposable cluster.
- The live app never imports the mockup's local-storage state, demo scores, or demo participant controls.
- API writes require `X-Judges-Client: 1`; no cross-origin CORS access is enabled.
- Result links are opt-in, organizer-controlled bearer links, independent of invitations. Revocation destroys the token; enabling again issues a different link. Share state is stored on the room and expires with it.
- Result links use `#results=…` to keep the token out of HTML requests and referrers. Their public API is no-store and strictly allowlisted; never add participant fields or credentials. Do not log bearer tokens.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
