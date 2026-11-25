// Run: node artifacts/api-server/tests/rooms.database-failures.mjs
// Requires local PostgreSQL binaries. Never imports the application's DB module
// or reads DATABASE_URL. All SQL runs in a disposable Unix-socket-only cluster.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { request } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";

const requireDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Pool } = requireDb("pg");
const exec = promisify(execFile);
const connectionError = () => Object.assign(new Error("injected connection failure"), { code: "08006" });

test("isolated PostgreSQL failures never falsely acknowledge room writes", { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "judging-pg-"));
  const cache = fileURLToPath(new URL("../node_modules/.cache/", import.meta.url));
  await mkdir(cache, { recursive: true });
  const output = await mkdtemp(join(cache, "db-failures-"));
  let started = false, database, server, armed, releases = [], trace = [], sqlErrors = [], dropSharingReply = false;
  const streams = [];
  t.after(async () => {
    for (const response of streams) response.destroy();
    if (server) {
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await closed;
    }
    if (database) await database.end();
    delete globalThis[Symbol.for("judging.test.pool")];
    try {
      if (started) await exec("pg_ctl", ["-D", join(directory, "data"), "-m", "immediate", "-w", "stop"]);
    } finally {
      await Promise.all([rm(directory, { recursive: true, force: true }), rm(output, { recursive: true, force: true })]);
    }
  });
  await exec("initdb", ["-D", join(directory, "data"), "-A", "trust", "-U", "fault_test", "--no-locale"]);
  await exec("pg_ctl", ["-D", join(directory, "data"), "-l", join(directory, "postgres.log"),
    "-o", `-k ${directory} -c listen_addresses='' -c fsync=off`, "-w", "start"]);
  started = true;
  database = new Pool({ host: directory, port: 5432, database: "postgres", user: "fault_test", max: 2 });
  await database.query(`CREATE TABLE judging_rooms (
    id text PRIMARY KEY, state jsonb NOT NULL, expires_at timestamptz NOT NULL);
    CREATE TABLE judging_rate_limits (key text PRIMARY KEY, hits integer NOT NULL, reset_at timestamptz NOT NULL);
    CREATE TABLE fault_parent (id integer PRIMARY KEY);
    CREATE TABLE fault_deferred (id integer REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED)`);
  const take = name => {
    if (armed?.point !== name) return false;
    armed = null;
    return true;
  };
  const faultPool = {
    on(event, listener) { database.on(event, listener); },
    async query(sql, values) {
      if (take("pool-query")) throw connectionError();
      if (sql.includes("AS version") && take("sse-query")) throw connectionError();
      return database.query(sql, values);
    },
    async connect() {
      if (take("connect")) throw connectionError();
      const client = await database.connect();
      let rollbackFails = false;
      return {
        async query(sql, values) {
          trace.push(sql.split(" ")[0]);
          if (sql === "ROLLBACK" && rollbackFails) throw connectionError();
          if (sql === "BEGIN" && take("rollback-rule")) rollbackFails = true;
          if (sql.includes("FOR UPDATE") && take("timeout")) {
            await client.query("SET LOCAL statement_timeout = '25ms'");
            try { await client.query("SELECT pg_sleep(1)"); }
            catch (error) { sqlErrors.push(error.code); throw error; }
          }
          if (sql === "COMMIT" && take("commit")) {
            // A deferred constraint fails at COMMIT, not at UPDATE/INSERT.
            await client.query("INSERT INTO fault_deferred VALUES (1)");
          }
          let result;
          try { result = await client.query(sql, values); }
          catch (error) { sqlErrors.push(error.code); throw error; }
          if (sql === "BEGIN" && take("begin")) throw connectionError();
          if (sql.startsWith("UPDATE") && (armed?.point === "update" || armed?.point === "rollback")) {
            rollbackFails = take("rollback");
            take("update");
            // This is a real failed SQL statement after the pending room update.
            try { await client.query("SELECT 1/0"); }
            catch (error) { sqlErrors.push(error.code); throw error; }
          }
          if (sql === "COMMIT" && take("commit-ack")) throw connectionError();
          return result;
        },
        release(error) { releases.push(error); client.release(error); },
      };
    },
  };
  globalThis[Symbol.for("judging.test.pool")] = faultPool;
  const bundle = await build({
    stdin: {
      contents: `export { default } from "./app";
        export { assertDatabaseReady } from "./lib/database-readiness";
        export { cleanExpiredRecords } from "./lib/expiry";`,
      resolveDir: fileURLToPath(new URL("../src/", import.meta.url)),
      loader: "ts",
    },
    outfile: join(output, "app.mjs"), bundle: true, platform: "node", format: "esm",
    packages: "external", write: false,
    alias: {
      "@workspace/api-zod": fileURLToPath(new URL("../../../lib/api-zod/src/index.ts", import.meta.url)),
      zod: fileURLToPath(new URL("../../../lib/api-zod/node_modules/zod", import.meta.url)),
    },
    // Test-only dependency substitution: production cannot enable fault hooks.
    plugins: [{
      name: "isolated-postgres",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "pool", namespace: "fault-test" }));
        builder.onLoad({ filter: /.*/, namespace: "fault-test" }, () => ({
          contents: 'export const pool = globalThis[Symbol.for("judging.test.pool")];', loader: "js",
        }));
      },
    }],
  });
  await writeFile(join(output, "app.mjs"), bundle.outputFiles[0].text);
  const { default: app, assertDatabaseReady, cleanExpiredRecords } = await import(pathToFileURL(join(output, "app.mjs")).href);
  await t.test("readiness is read-only and names missing tables/columns with safe development instructions", async () => {
    await assertDatabaseReady();
    for (const table of ["judging_rooms", "judging_rate_limits"]) {
      await database.query(`ALTER TABLE ${table} RENAME TO hidden_table`);
      try {
        await assert.rejects(assertDatabaseReady(), error => {
          assert.match(error.message, new RegExp(table));
          assert.match(error.message, /42P01/);
          assert.match(error.message, /pnpm --filter @workspace\/db run push/);
          assert.match(error.message, /本番DBにはこのコマンドを実行しない/);
          return true;
        });
        assert.equal((await database.query("SELECT to_regclass($1) AS table_name", [table])).rows[0].table_name, null,
          "Startup must never create missing tables");
      } finally {
        await database.query(`ALTER TABLE hidden_table RENAME TO ${table}`);
      }
    }
    await database.query("ALTER TABLE judging_rate_limits RENAME COLUMN reset_at TO hidden_column");
    try {
      await assert.rejects(assertDatabaseReady(), /judging_rate_limits.*42703/);
    } finally {
      await database.query("ALTER TABLE judging_rate_limits RENAME COLUMN hidden_column TO reset_at");
    }
    armed = { point: "pool-query" };
    await assert.rejects(assertDatabaseReady(), error => {
      assert.match(error.message, /readiness check failed.*08006/);
      assert.ok(!error.message.includes("run push"), "Do not misdiagnose connection failures as schema drift");
      return true;
    });
    assert.equal(armed, null);
    await assertDatabaseReady();
  });
  // Only the disposable app is served here; the managed preview stays running.
  server = app.listen(join(directory, "api.sock"));
  // Drop the HTTP reply after the handler has committed, not the transaction.
  server.prependListener("request", (req, res) => {
    const end = res.end;
    res.end = function (...args) {
      if (dropSharingReply && req.method === "POST" && req.url.endsWith("/sharing")) {
        dropSharingReply = false;
        res.destroy();
        return this;
      }
      return end.apply(this, args);
    };
  });
  server.on("connection", socket => Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" }));
  await once(server, "listening");
  const host = {}, guest = {};
  async function open(actor, path, body) {
    return new Promise((resolve, reject) => {
      const req = request({
        socketPath: join(directory, "api.sock"), path: path.startsWith("/api/") ? path : `/api/rooms${path}`,
        method: body ? "POST" : "GET", headers: {
          ...(actor.cookie ? { Cookie: actor.cookie } : {}),
          ...(body ? { "Content-Type": "application/json", "X-Judges-Client": "1" } : {}),
        },
      }, res => { req.setTimeout(0); resolve(res); });
      req.setTimeout(3000, () => req.destroy(new Error("HTTP response timed out")));
      req.on("error", reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  async function call(actor, path, body, status = 200) {
    const response = await open(actor, path, body);
    response.setTimeout(3000, () => response.destroy(new Error("HTTP body timed out")));
    if (response.headers["set-cookie"]) actor.cookie = response.headers["set-cookie"][0].split(";")[0];
    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(response.statusCode, status);
    if (status === 500) assert.deepEqual(data, { error: "保存できませんでした。通信を確認してもう一度お試しください" });
    return data;
  }
  let room = await call(host, "", { title: "隔離障害検証", nickname: "幹事", performers: ["組A", "組B"], retentionDays: 30 }, 201);
  const path = `/${room.id}`;
  await call(guest, `${path}/join`, { nickname: "友達" });
  room = await call(host, path);
  const action = (actor, body, status = 200) => call(actor, `${path}/actions`, { ...body, version: room.version }, status);
  room = await action(host, { type: "start" });
  const beforeState = async () => (await database.query("SELECT state FROM judging_rooms WHERE id=$1", [room.id])).rows[0].state;
  const stable = data => { const { serverTime, ...rest } = data; return rest; };
  async function failWrite(body, point) {
    const before = await beforeState(), snapshot = stable(await call(host, path));
    trace = []; releases = [];
    armed = { point };
    await action(host, body, 500);
    assert.equal(armed, null, "The intended fault must actually be reached");
    assert.deepEqual(await beforeState(), before, "Failed transaction must not persist state/version");
    assert.deepEqual(stable(await call(host, path)), snapshot, "Recovery must not acknowledge the failed operation");
    if (["pool-query", "connect"].includes(point)) {
      assert.deepEqual(trace, []); assert.equal(releases.length, 0);
    } else {
      assert.equal(trace.at(-1), "ROLLBACK");
      assert.equal(releases.length, 1, "Release exactly once");
      assert.equal(releases[0] instanceof Error, point === "rollback", "Discard only uncertain connections");
      assert.equal(trace.includes("COMMIT"), point === "commit");
    }
    assert.equal(database.totalCount - database.idleCount, 0, "No checked-out connection leaks");
    assert.equal(database.waitingCount, 0);
  }
  for (const point of ["pool-query", "connect", "begin", "timeout", "update", "commit", "rollback"]) {
    await t.test(`score submission: ${point}`, () => failWrite({ type: "score", performerId: room.activeId, score: 95 }, point));
  }
  assert.ok(sqlErrors.includes("57014"), "PostgreSQL really cancelled a timed-out statement");
  assert.ok(sqlErrors.includes("22012"), "PostgreSQL really aborted a transaction");
  assert.ok(sqlErrors.includes("23503"), "PostgreSQL really rejected COMMIT");
  await t.test("failed rollback preserves the original conflict response and discards the connection", async () => {
    const before = await beforeState();
    armed = { point: "rollback-rule" }; trace = []; releases = [];
    const response = await call(host, `${path}/actions`,
      { type: "score", performerId: room.activeId, score: 95, version: room.version - 1 }, 409);
    assert.match(response.error, /ルームが更新されました/);
    assert.equal(armed, null);
    assert.equal(trace.at(-1), "ROLLBACK");
    assert.equal(releases.length, 1);
    assert.ok(releases[0] instanceof Error);
    assert.deepEqual(await beforeState(), before);
    assert.equal(database.totalCount - database.idleCount, 0);
  });
  room = await action(host, { type: "score", performerId: room.activeId, score: 95 });
  room = await action(guest, { type: "score", performerId: room.activeId, score: 90 });
  for (const point of ["connect", "timeout", "update", "commit", "rollback"]) {
    await t.test(`score publication: ${point}`, () => failWrite({ type: "publishScore", performerId: room.activeId }, point));
  }
  await t.test("lost COMMIT acknowledgement is an error; refetch discovers exactly one committed publication", async () => {
    const before = room.version;
    armed = { point: "commit-ack" }; trace = []; releases = [];
    await action(host, { type: "publishScore", performerId: room.activeId }, 500);
    assert.equal(armed, null);
    assert.deepEqual(trace.slice(-2), ["COMMIT", "ROLLBACK"]);
    assert.equal(releases.length, 1);
    room = await call(host, path);
    assert.equal(room.version, before + 1);
    assert.equal(room.rounds.length, 1);
    await action(host, { type: "publishScore", performerId: room.performers[0].id }, 409);
    assert.equal((await call(host, path)).version, before + 1);
  });
  room = await action(host, { type: "score", performerId: room.activeId, score: 85 });
  room = await action(guest, { type: "score", performerId: room.activeId, score: 80 });
  room = await action(host, { type: "publishScore", performerId: room.activeId });
  room = await action(host, { type: "finalists", candidates: room.performers.map(p => p.id) });
  for (const runoff of [false, true]) {
    if (runoff) room = await action(host, { type: "runoff" });
    for (const point of ["connect", "timeout", "update", "commit", "rollback"]) {
      await t.test(`${runoff ? "runoff" : "final"} vote: ${point}`, () =>
        failWrite({ type: "vote", performerId: room.performers[0].id, runoff }, point));
    }
    room = await action(host, { type: "vote", performerId: room.performers[0].id, runoff });
    room = await action(guest, { type: "vote", performerId: room.performers[1].id, runoff });
    for (const point of ["connect", "timeout", "update", "commit", "rollback"]) {
      await t.test(`${runoff ? "runoff" : "final"} publication: ${point}`, () =>
        failWrite({ type: "publishVote", runoff }, point));
    }
    room = await action(host, { type: "publishVote", runoff });
  }
  await t.test("sharing failures preserve authoritative opt-in/out and revoke old links only on commit", async t => {
    const sharingPath = `${path}/sharing`;
    const readSharing = () => call(host, sharingPath);
    const writeSharing = (enabled, status = 200) => call(host, sharingPath, { enabled }, status);
    const publicLink = (token, status = 200) => call({}, `/api/shared-results/${token}`, undefined, status);
    let revokedToken;
    for (const [label, enabled] of [["enable", true], ["disable", false], ["re-enable", true]]) {
      const before = await beforeState();
      const confirmed = await readSharing();
      assert.equal(confirmed.enabled, !enabled);
      for (const point of ["pool-query", "connect", "begin", "timeout", "update", "commit", "rollback"]) {
        await t.test(`${label}: ${point}`, async () => {
          armed = { point }; trace = []; releases = [];
          await writeSharing(enabled, 500);
          assert.equal(armed, null, "The intended sharing fault must be reached");
          assert.deepEqual(await beforeState(), before, "Failed sharing must not persist token or version");
          assert.deepEqual(await readSharing(), confirmed, "GET must report only committed sharing state");
          if (confirmed.token) await publicLink(confirmed.token);
          if (revokedToken) await publicLink(revokedToken, 404);
          if (["pool-query", "connect"].includes(point)) {
            assert.deepEqual(trace, []); assert.equal(releases.length, 0);
          } else {
            assert.equal(trace.at(-1), "ROLLBACK");
            assert.equal(releases.length, 1);
            assert.equal(releases[0] instanceof Error, point === "rollback");
          }
          assert.equal(database.totalCount - database.idleCount, 0);
          assert.equal(database.waitingCount, 0);
        });
      }
      // Test both uncertainty at COMMIT acknowledgement and a genuinely lost
      // HTTP response. Reset explicitly between cases; never replay a failed POST.
      for (const loss of ["commit-ack", "http-response"]) {
        await t.test(`${label}: lost ${loss} recovers by GET`, async () => {
          const previous = await beforeState();
          if (loss === "commit-ack") {
            armed = { point: loss };
            await writeSharing(enabled, 500);
            assert.equal(armed, null);
          } else {
            dropSharingReply = true;
            await assert.rejects(writeSharing(enabled), error => error.code === "ECONNRESET");
            assert.equal(dropSharingReply, false);
          }
          const recovered = await readSharing();
          const committed = await beforeState();
          assert.equal(recovered.enabled, enabled);
          assert.equal(recovered.token, committed.resultToken ?? null);
          assert.equal(committed.version, previous.version + 1, "Exactly one transition was committed");
          const { version: oldVersion, resultToken: oldToken, ...oldResults } = previous;
          const { version: newVersion, resultToken: newToken, ...newResults } = committed;
          assert.deepEqual(newResults, oldResults, "Sharing must not alter scores or votes");
          if (enabled) {
            assert.ok(recovered.token);
            assert.notEqual(recovered.token, revokedToken, "Re-enabling must never resurrect a revoked link");
            await publicLink(recovered.token);
          } else {
            assert.equal(recovered.token, null);
            revokedToken = previous.resultToken;
            await publicLink(revokedToken, 404);
          }
          assert.deepEqual(await readSharing(), recovered);
          assert.deepEqual(await beforeState(), committed, "Repeated recovery GETs must never mutate sharing");
          assert.equal(database.totalCount - database.idleCount, 0);
          if (loss === "commit-ack") {
            await writeSharing(!enabled);
          }
        });
      }
    }
    room = await call(host, path);
  });
  await t.test("database failure ends SSE, clears polling, and permits a fresh subscription", async () => {
    const response = await open(host, `${path}/events`);
    streams.push(response);
    assert.equal(response.statusCode, 200);
    response.setEncoding("utf8");
    let data = "";
    response.on("data", chunk => { data += chunk; });
    const closed = once(response, "end");
    armed = { point: "sse-query" };
    await Promise.race([closed, delay(3500).then(() => { throw new Error("SSE did not end"); })]);
    assert.equal(armed, null);
    assert.ok(!data.includes("event: expired"), "Storage failure is not room expiry");
    // A new connection must read the authoritative revision after recovery.
    const recovered = await open(host, `${path}/events`);
    streams.push(recovered);
    recovered.setEncoding("utf8");
    const [frame] = await once(recovered, "data");
    assert.equal(frame, `data: ${JSON.stringify({ version: room.version })}\n\n`);
    recovered.destroy();
    await delay(50);
    let polls = 0;
    const original = faultPool.query;
    faultPool.query = async (...args) => { if (args[0].includes("AS version")) polls++; return original(...args); };
    await delay(1100);
    faultPool.query = original;
    assert.equal(polls, 0, "Closed streams must clear their polling intervals");
    assert.equal(database.totalCount - database.idleCount, 0);
  });
  await t.test("expiry removes only expired rooms/counters and keeps persisted submissions intact", async () => {
    const before = await beforeState();
    await database.query(`INSERT INTO judging_rooms VALUES ('expired-test', '{}', NOW() - INTERVAL '1 second');
      INSERT INTO judging_rate_limits VALUES ('expired-test', 1, NOW() - INTERVAL '1 second'),
        ('active-test', 1, NOW() + INTERVAL '1 hour')`);
    await cleanExpiredRecords();
    assert.equal((await database.query("SELECT 1 FROM judging_rooms WHERE id='expired-test'")).rowCount, 0);
    assert.equal((await database.query("SELECT 1 FROM judging_rate_limits WHERE key='expired-test'")).rowCount, 0);
    assert.equal((await database.query("SELECT 1 FROM judging_rate_limits WHERE key='active-test'")).rowCount, 1);
    assert.deepEqual(await beforeState(), before, "Active room and submitted scores/votes must survive cleanup");
    assert.equal((await call(host, path)).version, room.version);
  });
  await t.test("expiry of either table still runs when the other table is unavailable", async () => {
    for (const missing of ["judging_rooms", "judging_rate_limits"]) {
      const other = missing === "judging_rooms" ? "judging_rate_limits" : "judging_rooms";
      const insert = other === "judging_rooms"
        ? "INSERT INTO judging_rooms VALUES ('expired-independent', '{}', NOW() - INTERVAL '1 second')"
        : "INSERT INTO judging_rate_limits VALUES ('expired-independent', 1, NOW() - INTERVAL '1 second')";
      const key = other === "judging_rooms" ? "id" : "key";
      await database.query(insert);
      await database.query(`ALTER TABLE ${missing} RENAME TO hidden_table`);
      try {
        await cleanExpiredRecords();
        assert.equal((await database.query(`SELECT 1 FROM ${other} WHERE ${key}='expired-independent'`)).rowCount, 0);
      } finally {
        await database.query(`ALTER TABLE hidden_table RENAME TO ${missing}`);
      }
    }
    await assertDatabaseReady();
  });
});
