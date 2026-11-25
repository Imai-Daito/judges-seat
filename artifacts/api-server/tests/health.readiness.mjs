// All database faults are confined to a disposable, Unix-socket-only cluster.
// This suite never reads DATABASE_URL or imports the shared database client.
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
import { performance } from "node:perf_hooks";
import { build } from "esbuild";

const exec = promisify(execFile);
const requireDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Pool } = requireDb("pg");

test("readiness reports runtime failures and recovery without leaking details", { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "readiness-pg-"));
  const cache = fileURLToPath(new URL("../node_modules/.cache/", import.meta.url));
  await mkdir(cache, { recursive: true });
  const output = await mkdtemp(join(cache, "readiness-"));
  let started = false, admin, database, server;
  const data = join(directory, "data");
  const startDb = async () => {
    await exec("pg_ctl", ["-D", data, "-l", join(directory, "postgres.log"),
      "-o", `-k ${directory} -c listen_addresses='' -c fsync=off`, "-w", "start"]);
    started = true;
  };
  t.after(async () => {
    if (server) {
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await closed;
    }
    await Promise.all([database?.end(), admin?.end()]);
    delete globalThis[Symbol.for("readiness.test.pool")];
    try {
      if (started) await exec("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    } finally {
      await Promise.all([rm(directory, { recursive: true, force: true }), rm(output, { recursive: true, force: true })]);
    }
  });
  await exec("initdb", ["-D", data, "-A", "trust", "-U", "readiness_admin", "--no-locale"]);
  await startDb();
  const config = { host: directory, port: 5432, database: "postgres", max: 1 };
  admin = new Pool({ ...config, user: "readiness_admin" });
  // The test-only administrator also holds idle clients across the deliberate
  // shutdown; production pool error handling is exercised separately below.
  admin.on("error", () => {});
  // The probe itself uses a role that cannot write, proving it is read-only.
  await admin.query(`CREATE ROLE readiness_reader LOGIN;
    CREATE TABLE judging_rooms (id text PRIMARY KEY, state jsonb, expires_at timestamptz);
    CREATE TABLE judging_rate_limits (key text PRIMARY KEY, hits integer, reset_at timestamptz);
    INSERT INTO judging_rooms VALUES ('sentinel', '{"untouched":true}', '2030-01-01');
    INSERT INTO judging_rate_limits VALUES ('sentinel', 7, '2030-01-01');
    GRANT SELECT ON judging_rooms, judging_rate_limits TO readiness_reader`);
  database = new Pool({ ...config, user: "readiness_reader" });
  globalThis[Symbol.for("readiness.test.pool")] = database;
  const bundle = await build({
    stdin: {
      contents: `export { default } from "./routes/health";`,
      resolveDir: fileURLToPath(new URL("../src/", import.meta.url)), loader: "ts",
    },
    outfile: join(output, "health.mjs"), bundle: true, platform: "node", format: "esm",
    packages: "external", write: false,
    alias: {
      "@workspace/api-zod": fileURLToPath(new URL("../../../lib/api-zod/src/index.ts", import.meta.url)),
      zod: fileURLToPath(new URL("../../../lib/api-zod/node_modules/zod", import.meta.url)),
    },
    plugins: [{
      name: "isolated-readiness-postgres",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "pool", namespace: "readiness-test" }));
        builder.onLoad({ filter: /.*/, namespace: "readiness-test" }, () => ({
          contents: 'export const pool = globalThis[Symbol.for("readiness.test.pool")];', loader: "js",
        }));
      },
    }],
  });
  await writeFile(join(output, "health.mjs"), bundle.outputFiles[0].text);
  const { default: router } = await import(pathToFileURL(join(output, "health.mjs")).href);
  const { default: express } = await import("express");
  const app = express();
  app.use("/api", router);
  server = app.listen(join(directory, "api.sock"));
  await once(server, "listening");

  async function check(path = "/readyz", status = 200) {
    const start = performance.now();
    const response = await new Promise((resolve, reject) => {
      const req = request({ socketPath: join(directory, "api.sock"), path: `/api${path}` }, resolve);
      req.setTimeout(2500, () => req.destroy(new Error("probe exceeded HTTP deadline")));
      req.on("error", reject);
      req.end();
    });
    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    assert.equal(response.statusCode, status);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {
      status: status === 200 ? "ok" : "unavailable",
    }, "Only an allowlisted status is exposed, never addresses, users, SQL or errors");
    if (path === "/readyz") assert.equal(response.headers["cache-control"], "no-store");
    assert.ok(performance.now() - start < 2000, "Includes pool acquisition and query time");
  }
  async function released() {
    // pg may finish destroying a timed-out socket on the next event-loop turn.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(database.totalCount - database.idleCount, 0, "No borrowed connections leaked");
    assert.equal(database.waitingCount, 0, "No abandoned acquisitions");
  }

  await t.test("healthy reads succeed with a read-only role and liveness stays compatible", async () => {
    await check("/healthz");
    await check();
    await assert.rejects(database.query("DELETE FROM judging_rooms"), { code: "42501" });
    await check();
    await released();
  });
  await t.test("missing tables, columns and SELECT access return 503 then recover", async () => {
    for (const table of ["judging_rooms", "judging_rate_limits"]) {
      await admin.query(`ALTER TABLE ${table} RENAME TO hidden_table`);
      try { await check("/readyz", 503); await check("/healthz"); }
      finally { await admin.query(`ALTER TABLE hidden_table RENAME TO ${table}`); }
      await check();
    }
    await admin.query("ALTER TABLE judging_rate_limits RENAME COLUMN hits TO hidden_column");
    try { await check("/readyz", 503); }
    finally { await admin.query("ALTER TABLE judging_rate_limits RENAME COLUMN hidden_column TO hits"); }
    await check();
    await admin.query("REVOKE SELECT ON judging_rooms FROM readiness_reader");
    try { await check("/readyz", 503); }
    finally { await admin.query("GRANT SELECT ON judging_rooms TO readiness_reader"); }
    await check();
    await released();
  });
  await t.test("locked schema times out, coalesces concurrent probes and discards the query", async () => {
    const lock = await admin.connect();
    try {
      await lock.query("BEGIN");
      await lock.query("LOCK TABLE judging_rooms IN ACCESS EXCLUSIVE MODE");
      await Promise.all(Array.from({ length: 12 }, () => check("/readyz", 503)));
      await check("/healthz");
      await released();
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }
    await check();
    const active = await admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE usename = 'readiness_reader' AND state = 'active'`);
    assert.equal(active.rows[0].n, 0, "Timed-out SQL must not continue in the background");
  });
  await t.test("pool exhaustion has a bounded deadline and only one pending acquisition", async () => {
    const held = await database.connect();
    try {
      await Promise.all(Array.from({ length: 12 }, () => check("/readyz", 503)));
      assert.equal(database.waitingCount, 1);
      await Promise.all(Array.from({ length: 12 }, () => check("/readyz", 503)));
      assert.equal(database.waitingCount, 1, "Repeated timeouts must not grow the queue");
      await check("/healthz");
    } finally { held.release(); }
    await new Promise(resolve => setImmediate(resolve));
    await check();
    await released();
  });
  await t.test("stopping PostgreSQL after startup returns 503, restart restores 200", async () => {
    await check(); // Establish an idle connection before the real shutdown.
    await exec("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
    started = false;
    await check("/healthz");
    await check("/readyz", 503);
    await check("/readyz", 503);
    await startDb();
    await check();
    await released();
  });
  await t.test("sentinel data is unchanged by checks and recovery", async () => {
    const rooms = await database.query("SELECT id, state FROM judging_rooms");
    const limits = await database.query("SELECT key, hits FROM judging_rate_limits");
    assert.deepEqual(rooms.rows, [{ id: "sentinel", state: { untouched: true } }]);
    assert.deepEqual(limits.rows, [{ key: "sentinel", hits: 7 }]);
  });
});
