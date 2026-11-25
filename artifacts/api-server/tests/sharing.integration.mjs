import assert from "node:assert/strict";
import { pool } from "../../../lib/db/src/index.ts";

// Real cookie-isolated sessions. Do not print cookies, room IDs or bearer links.
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const host = {}, guest = {}, stranger = {};
let room, checks = 0;
async function call(actor, path, body, expected = 200, header = true) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET", cache: "no-store",
    headers: { ...(actor.cookie ? { Cookie: actor.cookie } : {}), ...(body ? { "Content-Type": "application/json", ...(header ? { "X-Judges-Client": "1" } : {}) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  });
  if (res.headers.get("set-cookie")) actor.cookie = res.headers.get("set-cookie").split(";")[0];
  assert.equal(res.status, expected, `Request status (check ${checks})`);
  assert.match(res.headers.get("cache-control"), /no-store/);
  if (path.startsWith("/shared-results/")) {
    assert.match(res.headers.get("x-robots-tag"), /noindex/);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  }
  checks++;
  return res.json();
}
async function act(actor, action) {
  room = await call(actor, `/rooms/${room.id}/actions`, { ...action, version: room.version });
}
function clean(result) {
  assert.deepEqual(Object.keys(result).sort(), ["title", "members", "performers", "rounds", "final", "runoff", "expiresAt"].sort());
  const serialized = JSON.stringify(result);
  for (const key of ["identity", "hostId", "ownScore", "ownVote", "submitted", "resultToken", room.id]) assert.ok(!serialized.includes(key));
}
async function main() {
room = await call(host, "/rooms", { nickname: "共有幹事", title: "共有検証2026", performers: ["長い日本語のコンビ名その一", "組B"], retentionDays: 30 }, 201);
room = await call(guest, `/rooms/${room.id}/join`, { nickname: "共有友達" });
await call(stranger, `/rooms/${room.id}/sharing`, undefined, 401);
await call(guest, `/rooms/${room.id}/sharing`, undefined, 403);
await call(guest, `/rooms/${room.id}/sharing`, { enabled: true }, 403);
await call(host, `/rooms/${room.id}/sharing`, { enabled: true }, 403, false);
assert.equal((await call(host, `/rooms/${room.id}/sharing`)).enabled, false);
const shared = await call(host, `/rooms/${room.id}/sharing`, { enabled: true });
assert.match(shared.token, /^[A-Za-z0-9_-]{48}$/);
room = await call(host, `/rooms/${room.id}`);
const path = `/shared-results/${shared.token}`;
assert.ok(!JSON.stringify(await call(guest, `/rooms/${room.id}`)).includes(shared.token));
let result = await call(stranger, path);
clean(result);
assert.equal(stranger.cookie, undefined);
await call(stranger, path, { enabled: false }, 405);
await act(host, { type: "start" });
for (const p of room.performers) {
  await act(host, { type: "score", performerId: p.id, score: 100 });
  await act(guest, { type: "score", performerId: p.id, score: 0 });
  result = await call(stranger, path);
  assert.ok(!result.rounds.some(r => r.performerId === p.id));
  await act(host, { type: "publishScore", performerId: p.id });
}
await act(host, { type: "finalists", candidates: room.performers.map(p => p.id) });
await act(host, { type: "vote", performerId: room.performers[0].id });
await act(guest, { type: "vote", performerId: room.performers[1].id });
result = await call(stranger, path);
clean(result);
assert.deepEqual(result.final, { published: false, candidates: [], votes: {} });
await act(host, { type: "publishVote" });
assert.equal(Object.keys((await call(stranger, path)).final.votes).length, 2);
await act(host, { type: "runoff" });
await act(host, { type: "vote", runoff: true, performerId: room.performers[0].id });
await act(guest, { type: "vote", runoff: true, performerId: room.performers[1].id });
assert.deepEqual((await call(stranger, path)).runoff, { published: false, candidates: [], votes: {} });
await act(host, { type: "publishVote", runoff: true });
result = await call(stranger, path);
clean(result);
assert.equal(Object.keys(result.runoff.votes).length, 2);
assert.equal(result.rounds.length, 2);
await call(guest, `/rooms/${room.id}/sharing`, { enabled: false }, 403);
await call(host, `/rooms/${room.id}/sharing`, { enabled: false });
await call(stranger, path, undefined, 404);
const renewed = await call(host, `/rooms/${room.id}/sharing`, { enabled: true });
assert.notEqual(renewed.token, shared.token);
await call(stranger, path, undefined, 404);
await call(stranger, "/shared-results/not-a-token", undefined, 404);
await call(stranger, `/shared-results/${"a".repeat(48)}`, undefined, 404);
await pool.query("UPDATE judging_rooms SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [room.id]);
await call(stranger, `/shared-results/${renewed.token}`, undefined, 404);
await call(host, `/rooms/${room.id}/sharing`, undefined, 404);
await pool.query("DELETE FROM judging_rooms WHERE id=$1", [room.id]);
console.log(`PASS: ${checks} HTTP checks; separate sessions, opt-in/out, token rotation, expiry, unpublished privacy, immutable scores and tied runoff.`);
}
try { await main(); } finally { await pool.end(); }
