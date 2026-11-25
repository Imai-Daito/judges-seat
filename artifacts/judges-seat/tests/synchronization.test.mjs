import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("room recovery and shared reveal timeline", async t => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://judging.test/" });
  const keys = ["window", "document", "navigator", "EventSource", "IS_REACT_ACT_ENVIRONMENT", "fetch"];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const intervals = new Map();
  let timerId = 0;
  dom.window.setInterval = fn => { intervals.set(++timerId, fn); return timerId; };
  dom.window.clearInterval = id => intervals.delete(id);
  dom.window.matchMedia = () => ({
    matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  });
  Object.defineProperty(dom.window.document, "visibilityState", { configurable: true, value: "visible" });
  class FakeStream {
    static all = [];
    listeners = new Map();
    closed = false;
    constructor(url) { this.url = url; FakeStream.all.push(this); }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    emit(name) {
      if (this.closed) return;
      this[`on${name}`]?.({ data: '{"version":99}' });
      this.listeners.get(name)?.({});
    }
    close() { this.closed = true; }
  }
  const pending = [];
  const requests = [];
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    EventSource: FakeStream, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: (url, options) => {
      requests.push({ url, options });
      return new Promise((resolve, reject) => pending.push({ url, options, resolve, reject }));
    },
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createElement: h, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useRoom } = await import("../src/room-client.ts");
  const { Reveal } = await import("../src/Reveal.tsx");
  let root, client;
  const members = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, name: `審査員${i + 1}` }));
  const snapshot = (version, extra = {}) => ({
    id: "room-a", title: "同期検証", version, me: "m0", hostId: "m0", members,
    performers: [{ id: "p1", name: "組A" }, { id: "p2", name: "組B" }],
    started: true, activeId: "p1", submitted: [], ownScore: null, rounds: [],
    final: { candidates: [], submitted: [], votes: {}, published: false, ownVote: null },
    runoff: { candidates: [], submitted: [], votes: {}, published: false, ownVote: null },
    expiresAt: "2030-01-01T00:00:00.000Z", serverTime: Date.now(), ...extra,
  });
  function Probe({ id }) {
    client = useRoom(id);
    return h("div", null,
      client.error ? h("div", { role: "alert" }, client.error) : null,
      h("output", null, JSON.stringify({
        ownScore: client.room?.ownScore, rounds: client.room?.rounds,
        final: client.room?.final, runoff: client.room?.runoff, busy: client.busy,
      })));
  }
  async function mount(id = "room-a") {
    root = createRoot(document.getElementById("root"));
    await act(async () => root.render(h(Probe, { id })));
  }
  async function respond(data, status = 200, index = 0) {
    const request = pending.splice(index, 1)[0];
    assert.ok(request, "Expected a pending request");
    await act(async () => request.resolve({ ok: status < 400, status, json: async () => data }));
    return request;
  }
  async function cleanup() {
    if (root) await act(async () => root.unmount());
    root = null;
    assert.equal(intervals.size, 0, "Unmount clears mobile fallback and reveal timers");
    assert.ok(FakeStream.all.every(stream => stream.closed), "Unmount closes every SSE connection");
    pending.length = 0; requests.length = 0; FakeStream.all.length = 0;
  }
  t.after(async () => {
    await cleanup();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  await t.test("out-of-order refreshes never regress; reconnect/online/visibility/fallback rehydrate", async () => {
    await mount();
    await respond(snapshot(10));
    const stream = FakeStream.all[0];
    await act(async () => { stream.emit("open"); stream.emit("message"); });
    assert.equal(pending.length, 2);
    await respond(snapshot(12), 200, 1);
    await respond(snapshot(11));
    assert.equal(client.room.version, 12);
    await act(async () => stream.emit("error"));
    assert.match(client.connection, /再接続中/);
    const round = { performerId: "p1", scores: Object.fromEntries(members.map(m => [m.id, 90])), publishedAt: Date.now() - 5000 };
    await act(async () => stream.emit("open"));
    await respond(snapshot(13, { rounds: [round], activeId: "p2" }));
    assert.equal(client.room.me, "m0");
    assert.deepEqual(client.room.rounds, [round]);
    assert.equal(FakeStream.all.length, 1, "Refresh must not open duplicate SSE streams");
    for (const trigger of [
      () => window.dispatchEvent(new window.Event("online")),
      () => document.dispatchEvent(new window.Event("visibilitychange")),
      () => [...intervals.values()].forEach(fn => fn()),
    ]) {
      await act(async () => trigger());
      assert.equal(pending.length, 1);
      await respond(snapshot(13, { rounds: [round] }));
    }
    await cleanup();
  });

  await t.test("conflicting publication is not retried; same-tick double taps send only once", async () => {
    await mount(); await respond(snapshot(20));
    let first, second;
    await act(async () => {
      first = client.act({ type: "publishScore", performerId: "p1" });
      second = client.act({ type: "publishScore", performerId: "p1" });
    });
    assert.equal(pending.length, 1);
    assert.equal(JSON.parse(pending[0].options.body).version, 20);
    await respond({ error: "ルームが更新されました" }, 409);
    assert.equal(await first, null);
    assert.equal(await second, null);
    assert.equal(pending.length, 1, "Conflict triggers a read, never an automatic publication retry");
    assert.equal(pending[0].options.method, undefined);
    await respond(snapshot(21));
    assert.equal(requests.filter(req => req.options.method === "POST").length, 1);
    assert.equal(client.room.version, 21);
    assert.equal(client.busy, false);
    await cleanup();
  });

  for (const action of [
    { type: "score", performerId: "p1", score: 95 },
    { type: "publishScore", performerId: "p1" },
    { type: "vote", performerId: "p1" },
    { type: "publishVote" },
    { type: "vote", performerId: "p1", runoff: true },
    { type: "publishVote", runoff: true },
  ]) {
    for (const failure of ["database", "network", "timeout"]) {
      await t.test(`${action.type}${action.runoff ? " runoff" : ""}: ${failure} shows failure, recovers by GET only`, async () => {
        await mount(); await respond(snapshot(22));
        const before = JSON.parse(document.querySelector("output").textContent);
        let mutation;
        await act(async () => { mutation = client.act(action); });
        assert.equal(client.busy, true);
        assert.equal(pending.length, 1);
        if (failure === "database") {
          await respond({ error: "保存できませんでした。通信を確認してもう一度お試しください" }, 500);
        } else {
          const request = pending.shift();
          await act(async () => request.reject(failure === "timeout"
            ? new DOMException("The operation timed out", "TimeoutError") : new TypeError("Failed to fetch")));
        }
        assert.equal(await mutation, null, "Caller must not display success or clear the draft");
        assert.ok(document.querySelector('[role="alert"]').textContent);
        assert.equal(client.busy, false);
        assert.deepEqual(JSON.parse(document.querySelector("output").textContent), before);
        assert.equal(pending.length, 0, "Failure never queues a write");
        const stream = FakeStream.all[0];
        for (const trigger of [
          () => { stream.emit("error"); stream.emit("open"); },
          () => window.dispatchEvent(new window.Event("online")),
          () => document.dispatchEvent(new window.Event("visibilitychange")),
          () => [...intervals.values()].forEach(fn => fn()),
          () => { void client.refresh(); },
        ]) {
          await act(async () => trigger());
          assert.equal(pending.length, 1);
          assert.equal(pending[0].options.method, undefined, "Recovery must only read");
          await respond(snapshot(22));
          assert.equal(client.room.ownScore, null);
          assert.deepEqual(client.room.rounds, []);
          assert.equal(client.room.final.published, false);
          assert.equal(client.room.runoff.published, false);
        }
        assert.equal(requests.filter(req => req.options.method === "POST").length, 1);
        assert.equal(document.querySelector('[role="alert"]'), null);
        // Only a fresh, explicit user action may send the operation again.
        await act(async () => { mutation = client.act(action); });
        assert.equal(JSON.parse(pending[0].options.body).version, 22);
        await respond(snapshot(23));
        assert.equal((await mutation).version, 23);
        assert.equal(requests.filter(req => req.options.method === "POST").length, 2);
        await cleanup();
      });
    }
  }

  await t.test("lost publication acknowledgement is not success; recovery discovers committed state without replay", async () => {
    await mount(); await respond(snapshot(24));
    let mutation;
    await act(async () => { mutation = client.act({ type: "publishScore", performerId: "p1" }); });
    await act(async () => pending.shift().reject(new TypeError("Failed to fetch")));
    assert.equal(await mutation, null);
    assert.deepEqual(client.room.rounds, []);
    const round = { performerId: "p1", scores: { m0: 95 }, publishedAt: Date.now() };
    await act(async () => FakeStream.all[0].emit("open"));
    await respond(snapshot(25, { rounds: [round], activeId: "p2" }));
    assert.deepEqual(client.room.rounds, [round]);
    assert.equal(requests.filter(req => req.options.method === "POST").length, 1);
    assert.equal(client.busy, false);
    await cleanup();
  });

  await t.test("failed recovery read preserves the last confirmed room until the database returns", async () => {
    await mount(); await respond(snapshot(26));
    await act(async () => { void client.refresh(); });
    await respond({ error: "保存できませんでした" }, 500);
    assert.equal(client.room.version, 26);
    assert.ok(document.querySelector('[role="alert"]'));
    await act(async () => { void client.refresh(); });
    await respond(snapshot(27));
    assert.equal(client.room.version, 27);
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.equal(requests.filter(req => req.options.method === "POST").length, 0);
    await cleanup();
  });

  await t.test("terminal SSE expiry rejects stale reads and writes already in flight", async () => {
    await mount(); await respond(snapshot(30));
    let mutation;
    await act(async () => {
      void client.refresh();
      mutation = client.act({ type: "score", performerId: "p1", score: 95 });
    });
    const stream = FakeStream.all[0];
    await act(async () => stream.emit("expired"));
    assert.equal(client.room, null);
    assert.equal(client.connection, "期限切れ");
    assert.equal(client.busy, false);
    assert.ok(stream.closed);
    await respond(snapshot(31));
    await respond(snapshot(32));
    assert.equal(await mutation, null);
    assert.equal(client.room, null, "Late responses cannot resurrect expired data");
    await act(async () => { void client.refresh(); });
    assert.equal(pending.length, 0);
    await cleanup();
  });

  await t.test("missed terminal event still expires through HTTP 404", async () => {
    await mount(); await respond(snapshot(40));
    await act(async () => { void client.refresh(); });
    await respond({ error: "保存期限が切れています" }, 404);
    assert.equal(client.room, null);
    assert.equal(client.connection, "期限切れ");
    assert.ok(FakeStream.all[0].closed);
    await cleanup();
  });

  await t.test("late action from a previous room cannot overwrite the new room", async () => {
    await mount(); await respond(snapshot(50));
    let mutation;
    await act(async () => { mutation = client.act({ type: "score", performerId: "p1", score: 91 }); });
    await act(async () => root.render(h(Probe, { id: "room-b" })));
    await respond(snapshot(2, { id: "room-b" }), 200, 1);
    await respond(snapshot(51));
    assert.equal(await mutation, null);
    assert.equal(client.room.id, "room-b");
    assert.equal(client.room.version, 2);
    assert.equal(client.busy, false);
    await cleanup();
  });

  await t.test("missing room during a write expires the view without retrying", async () => {
    await mount(); await respond(snapshot(55));
    let mutation;
    await act(async () => { mutation = client.act({ type: "publishVote" }); });
    await respond({ error: "部屋が存在しません" }, 404);
    assert.equal(await mutation, null);
    assert.equal(client.room, null);
    assert.equal(client.busy, false);
    assert.equal(client.connection, "期限切れ");
    assert.equal(pending.length, 0);
    await cleanup();
  });

  await t.test("20-person reveal resumes at shared position despite clock skew, then reaches one total", async () => {
    const originalNow = Date.now;
    const serverTime = 1800000000000;
    let localNow = serverTime + 3600000; // Phone is one hour ahead.
    Date.now = () => localNow;
    const round = {
      performerId: "p1", publishedAt: serverTime - 5 * 1600 - 400,
      scores: Object.fromEntries(members.map((m, i) => [m.id, 71 + i])),
    };
    const room = snapshot(60, { serverTime, rounds: [round] });
    const render = async replay => {
      root = createRoot(document.getElementById("root"));
      await act(async () => root.render(h(Reveal, { room, round, replay, close() {} })));
    };
    const slotScores = () => [...document.querySelectorAll(".js-slot-score")].map(el => el.textContent);
    try {
      await render(false);
      assert.deepEqual(slotScores(), members.map((_, i) => i < 5 ? String(71 + i) : "—"));
      assert.equal(document.querySelector(".js-big-score").textContent, "76");
      assert.equal(document.querySelector(".js-total-num"), null);
      // Another refresh of the same publication must not restart the animation.
      await act(async () => root.render(h(Reveal, {
        room: { ...room, serverTime: serverTime + 100 }, round, replay: false, close() {},
      })));
      assert.equal(document.querySelector(".js-big-score").textContent, "76");
      localNow += 40000;
      await act(async () => [...intervals.values()].forEach(fn => fn()));
      assert.deepEqual(slotScores(), members.map((_, i) => String(71 + i)));
      assert.equal(document.querySelectorAll(".js-total-num").length, 1);
      assert.equal(document.querySelector(".js-total-num").textContent, "1610");
      assert.equal(document.querySelector(".js-flying-card"), null);
      await cleanup();
      // Reopening after a longer outage shows the completed reveal immediately,
      // not the first judge or another 32-second presentation.
      room.serverTime += 40000;
      await render(false);
      assert.equal(document.querySelector(".js-total-num").textContent, "1610");
      await cleanup();
      await render(true);
      assert.equal(document.querySelector(".js-total-num"), null, "Only explicit replay starts over");
      assert.equal(document.querySelector(".js-big-score").textContent, "71");
      await cleanup();
    } finally { Date.now = originalNow; }
  });
});
