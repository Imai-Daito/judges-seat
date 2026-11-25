import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pool } from "../../../lib/db/src/index.ts";
import { hashIdentity } from "../src/lib/judging.ts";
import { rateKey, networkSubject, roomRatePolicies as limits } from "../src/lib/room-rate-limits.ts";
import { servers } from "./helpers/room-servers.mjs";

// Real policies, real PostgreSQL and two OS processes; no reduced test limits.
const api = await servers();
const roomIds = [], keys = new Set();
const host = {}, guest = {};
const input = { nickname: "幹事", title: "制限テスト", performers: ["組A", "組B"], retentionDays: 30 };
const who = actor => hashIdentity(actor.cookie.split("=")[1]);
const track = (policy, subject) => {
  const key = rateKey(policy, subject);
  keys.add(key);
  return key;
};
function trackNetwork(ip) {
  const subject = networkSubject({ ip });
  for (const policy of [limits.createNetwork, limits.writeNetwork, limits.writeAnonymous]) track(policy, subject);
  return subject;
}
async function call(server, actor, path, body, status = 200) {
  const result = await api.call(server, actor, path, body, status);
  if (actor.cookie) track(limits.createDevice, who(actor));
  return result;
}
async function create(actor, server = "a") {
  const room = await call(server, actor, "", input, 201);
  roomIds.push(room.id);
  track(limits.writeMember, `${room.id}:${who(actor)}`);
  return room;
}
async function limited(server, actor, path, body, limit, maxSeconds) {
  const response = await api.open(server, actor, path, body);
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  assert.equal(response.statusCode, 429);
  assert.match(response.headers["cache-control"], /no-store/);
  const retry = Number(response.headers["retry-after"]);
  assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= maxSeconds);
  assert.equal(Number(response.headers["ratelimit-limit"]), limit);
  assert.equal(response.headers["ratelimit-remaining"], "0");
  assert.equal(Number(response.headers["ratelimit-reset"]), retry);
  const data = JSON.parse(Buffer.concat(chunks).toString());
  assert.deepEqual(Object.keys(data), ["error"]);
  assert.equal(typeof data.error, "string");
}
async function seed(policy, subject, hits, expired = false) {
  await pool.query(`INSERT INTO judging_rate_limits(key,hits,reset_at)
    VALUES ($1,$2,NOW() + $3 * INTERVAL '1 millisecond')
    ON CONFLICT(key) DO UPDATE SET hits=EXCLUDED.hits,reset_at=EXCLUDED.reset_at`,
  [track(policy, subject), hits, expired ? -1000 : policy.windowMs]);
}
async function wave(count, fn) {
  for (let i = 0; i < count; i += 40) {
    await Promise.all(Array.from({ length: Math.min(40, count - i) }, (_, j) => fn(i + j)));
  }
}
try {
  const network = trackNetwork(api.ip);
  await Promise.all(["a", "b"].map(api.start));
  const a = await create(host), b = await create(host, "b");
  // More than 20 independent organizers can create rooms on the same Wi-Fi.
  for (let i = 0; i < 21; i++) await create({}, i % 2 ? "a" : "b");
  await call("b", guest, `/${a.id}/join`, { nickname: "友達" });
  track(limits.writeMember, `${a.id}:${who(guest)}`);

  // Use all 600 member requests, spread across both processes concurrently.
  await wave(600, i => call(i % 2 ? "a" : "b", host, `/${a.id}/join`, { nickname: "再接続" }));
  await limited("a", host, `/${a.id}/join`, { nickname: "再接続" }, 600, 60);
  await limited("b", host, `/${a.id}/sharing`, { enabled: true }, 600, 60);
  await limited("b", host, `/${a.id}/actions`, { type: "start", version: 0 }, 600, 60);
  assert.equal((await call("a", host, `/${a.id}`)).version, 1, "429 must not mutate the room");
  await call("a", host, `/${b.id}/join`, { nickname: "別ルーム" });
  await call("b", guest, `/${a.id}/join`, { nickname: "別の審査員" });
  await api.stop("a");
  await api.start("a");
  await limited("a", host, `/${a.id}/join`, { nickname: "再起動" }, 600, 60);

  // Expiry is database-driven; only this fixture's counters are adjusted.
  await seed(limits.writeMember, `${a.id}:${who(host)}`, 601, true);
  await call("a", host, `/${a.id}/join`, { nickname: "回復" });
  const stored = await pool.query("SELECT hits FROM judging_rate_limits WHERE key=$1",
    [track(limits.writeMember, `${a.id}:${who(host)}`)]);
  assert.equal(stored.rows[0].hits, 1);

  // Per-device creation budget is shared across processes and room IDs.
  // Two creations above + 18 invalid attempts = 20; failures count too.
  await wave(18, i => call(i % 2 ? "a" : "b", host, "", {}, 400));
  await limited("b", host, "", input, 20, 3600);
  await api.stop("b");
  await api.start("b");
  await limited("b", host, "", input, 20, 3600);
  await seed(limits.createDevice, who(host), 21, true);
  await create(host, "b");

  // Unverified traffic cannot obtain member budgets by changing cookies,
  // room IDs or body IDs. Nor can it exhaust a participant's own budget.
  await seed(limits.writeAnonymous, network, 599);
  const fake = { cookie: `judges_device=${randomBytes(32).toString("base64url")}` };
  await call("a", fake, `/${a.id}/actions`, { type: "start", version: 1, memberId: a.hostId }, 403);
  await limited("b", {}, `/${b.id}/join`, { nickname: "連打" }, 600, 60);
  await limited("a", fake, `/${"x".repeat(24)}/actions`, {}, 600, 60);
  await call("b", guest, `/${a.id}/join`, { nickname: "通常利用" });
  await call("b", host, `/${b.id}/join`, { nickname: "通常利用" });
  await seed(limits.writeAnonymous, network, 601, true);
  await call("a", {}, `/${"x".repeat(24)}/join`, { nickname: "不存在" }, 404);

  // Aggregate network ceilings still prevent rotating-cookie/member abuse.
  await seed(limits.createNetwork, network, 399);
  const created = await Promise.all(["a", "b"].map(async server => {
    const actor = {};
    const response = await api.open(server, actor, "", input);
    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    if (response.headers["set-cookie"]) {
      actor.cookie = response.headers["set-cookie"][0].split(";")[0];
      track(limits.createDevice, who(actor));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (response.statusCode === 201) roomIds.push(data.id);
    return response.statusCode;
  }));
  assert.deepEqual(created.sort(), [201, 429], "Atomic network creation cutoff across two processes");
  await limited("a", {}, "", input, 400, 3600);
  await seed(limits.writeNetwork, network, 11999);
  const statuses = await Promise.all(["a", "b"].map(async server => {
    const response = await api.open(server, guest, `/${a.id}/join`, { nickname: "同時操作" });
    response.resume();
    return response.statusCode;
  }));
  assert.deepEqual(statuses.sort(), [200, 429]);
  await limited("b", host, `/${b.id}/join`, { nickname: "連打" }, 12000, 60);
  // Read-only recovery remains available even when writes are throttled.
  await call("b", host, `/${b.id}`);

  // IPv6 /56 network normalization is effective at the actual HTTP boundary.
  const ip6a = "2001:db8:abcd:1200::1", ip6b = "2001:db8:abcd:12ff::2";
  const ipv6Network = trackNetwork(ip6a);
  assert.equal(ipv6Network, trackNetwork(ip6b));
  await seed(limits.writeAnonymous, ipv6Network, 600);
  await limited("a", { ip: ip6a }, `/${a.id}/join`, { nickname: "IPv6" }, 600, 60);
  await limited("b", { ip: ip6b }, `/${b.id}/join`, { nickname: "IPv6" }, 600, 60);
  console.log("PASS: real 600-request budget; same-Wi-Fi rooms and judges isolated; cross-process/restart 429; device/network creation ceilings; anonymous/cookie rotation defense; expiry, IPv6, Retry-After and read recovery.");
} finally {
  await api.close();
  try {
    if (roomIds.length) await pool.query("DELETE FROM judging_rooms WHERE id=ANY($1::text[])", [roomIds]);
    if (keys.size) await pool.query("DELETE FROM judging_rate_limits WHERE key=ANY($1::text[])", [[...keys]]);
  } finally { await pool.end(); }
}
