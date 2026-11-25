import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { randomBytes } from "node:crypto";

export async function eventually(predicate, label, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await delay(20);
  }
  assert.fail(`Timed out: ${label}`);
}

export async function servers() {
  // A fresh synthetic venue per suite, shared by its processes. Keep persistent
  // counters enabled without consuming another suite's or the preview's budget.
  const octets = randomBytes(3);
  const ip = `10.${[...octets].join(".")}`;
  const directory = await mkdtemp(join(tmpdir(), "judges-fault-"));
  const children = new Map();
  const streams = new Set();
  const socket = name => join(directory, `${name}.sock`);
  async function stop(name) {
    const child = children.get(name);
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL"); // Deliberate hard crash, not graceful shutdown.
      await exited;
    }
    children.delete(name);
    await rm(socket(name), { force: true });
  }
  async function start(name) {
    await stop(name);
    const child = fork(fileURLToPath(new URL("../fixtures/room-server.mjs", import.meta.url)), [socket(name)], {
      env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "silent" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.set(name, child);
    // Do not forward request logs or bind values to test output.
    child.stderr.resume();
    let ready = false;
    child.on("message", message => { if (message === "ready") ready = true; });
    await eventually(() => {
      assert.equal(child.exitCode, null, "Fault-test server exited before becoming ready");
      return ready;
    }, "fault-test server startup", 15000);
  }
  function open(name, actor, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = request({
        socketPath: socket(name), path: `/api/rooms${path}`, method: body ? "POST" : "GET",
        headers: {
          "X-Forwarded-For": actor.ip ?? ip,
          ...(actor.cookie ? { Cookie: actor.cookie } : {}),
          ...(body ? { "Content-Type": "application/json", "X-Judges-Client": "1" } : {}),
          ...headers,
        },
      }, res => { req.setTimeout(0); resolve(res); });
      req.setTimeout(10000, () => req.destroy(new Error("Fault-test HTTP timeout")));
      req.on("error", reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  async function call(name, actor, path, body, status = 200) {
    const res = await open(name, actor, path, body);
    res.setTimeout(10000, () => res.destroy(new Error("Fault-test response timeout")));
    if (res.headers["set-cookie"]) actor.cookie = res.headers["set-cookie"][0].split(";")[0];
    const chunks = [];
    for await (const chunk of res) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString());
    assert.ok((Array.isArray(status) ? status : [status]).includes(res.statusCode), `Fault-test HTTP status: ${res.statusCode}`);
    assert.match(res.headers["cache-control"], /no-store/);
    return data;
  }
  async function stream(name, actor, id) {
    const response = await open(name, actor, `/${id}/events`);
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /text\/event-stream/);
    const result = { frames: [], closed: false, close: () => response.destroy() };
    streams.add(result);
    let buffer = "";
    response.setEncoding("utf8");
    response.on("data", chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        result.frames.push(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    });
    // A crash must be observable as a closed stream, not an unhandled error.
    response.on("error", () => {});
    response.on("close", () => { result.closed = true; streams.delete(result); });
    await eventually(() => result.frames.length > 0, "initial SSE revision");
    return result;
  }
  return {
    start, stop, call, stream, open, ip,
    async close() {
      for (const stream of streams) stream.close();
      await Promise.all([...children.keys()].map(stop));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export function revisions(stream) {
  return stream.frames.filter(frame => frame.startsWith("data: ")).map(frame => {
    const data = JSON.parse(frame.slice(6));
    assert.deepEqual(Object.keys(data), ["version"], "SSE must never carry scores, votes or identity");
    assert.ok(Number.isInteger(data.version));
    return data.version;
  });
}
