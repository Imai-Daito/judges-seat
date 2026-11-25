import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("result-link failures never claim an unconfirmed public state or replay writes", async t => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://judging.test/" });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    location: dom.window.location, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const requests = [], pending = [];
  values.fetch = (url, options) => {
    requests.push({ url, options });
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  };
  const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let confirmations = 0, allowStop = true;
  dom.window.confirm = () => { confirmations++; return allowStop; };
  const { createElement: h, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  // Exercise the actual Results -> ShareResults -> generated HTTP client path.
  const { Results } = await import("../src/Results.tsx");
  const room = {
    id: "room-sharing", title: "共有障害検証", me: "host", hostId: "host",
    members: [{ id: "host", name: "幹事" }], performers: [], rounds: [],
    final: { published: false, candidates: [], votes: {} },
    runoff: { published: false, candidates: [], votes: {} },
  };
  const expiresAt = "2030-01-01T00:00:00.000Z";
  const disabled = { enabled: false, token: null, expiresAt };
  const enabled = { enabled: true, token: "a".repeat(48), expiresAt };
  const reenabled = { enabled: true, token: "b".repeat(48), expiresAt };
  const element = id => document.querySelector(`[data-testid="${id}"]`);
  const posts = () => requests.filter(r => r.options.method === "POST");
  const status = () => element("status-link")?.textContent;
  let root;
  async function click(id) {
    assert.ok(element(id), `Expected ${id}`);
    await act(async () => element(id).click());
  }
  async function respond(data, code = 200) {
    const request = pending.shift();
    assert.ok(request, "Expected an HTTP request");
    await act(async () => request.resolve(new Response(JSON.stringify(data), {
      status: code, headers: { "Content-Type": "application/json" },
    })));
  }
  async function mount(initial, currentRoom = room) {
    root = createRoot(document.getElementById("root"));
    await act(async () => root.render(h(Results, { room: currentRoom, replay() {} })));
    await click("button-choose-link");
    if (initial) await respond(initial);
  }
  async function cleanup() {
    if (root) await act(async () => root.unmount());
    root = null;
    assert.equal(pending.length, 0, "No queued retry may survive the flow");
    requests.length = 0; confirmations = 0; allowStop = true;
  }
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  for (const [label, initial, changed] of [
    ["enable", disabled, enabled], ["disable", enabled, disabled], ["re-enable", disabled, reenabled],
  ]) {
    for (const outcome of ["rolled-back", "committed"]) {
      for (const failure of ["database", "network", "timeout"]) {
        await t.test(`${label}: ${failure}, ${outcome}; only GET confirms state`, async () => {
          await mount(initial);
          assert.match(status(), initial.enabled ? /公開中/ : /停止中/);
          await click("button-toggle-link");
          assert.equal(element("button-toggle-link").disabled, true);
          assert.equal(posts().length, 1);
          assert.deepEqual(JSON.parse(posts()[0].options.body), { enabled: changed.enabled });
          assert.equal(new Headers(posts()[0].options.headers).get("X-Judges-Client"), "1");
          if (failure === "database") {
            await respond({ error: "保存できませんでした。通信を確認してもう一度お試しください" }, 500);
          } else {
            const request = pending.shift();
            await act(async () => request.reject(failure === "timeout"
              ? new DOMException("The operation timed out", "TimeoutError")
              : new TypeError("Failed to fetch")));
          }
          assert.ok(document.querySelector('[role="alert"]')?.textContent);
          assert.equal(status(), undefined, "Neither public nor stopped may be claimed after an uncertain write");
          assert.equal(element("input-share-url"), null, "Do not offer a potentially revoked/stale link");
          assert.equal(element("button-toggle-link"), null, "Require a read before another write");
          assert.equal(pending.length, 0, "No automatic retry");
          await act(async () => {
            window.dispatchEvent(new window.Event("online"));
            document.dispatchEvent(new window.Event("visibilitychange"));
            root.render(h(Results, { room: { ...room }, replay() {} }));
          });
          assert.equal(pending.length, 0, "Reconnect and render must not replay a toggle");
          await click("button-retry-sharing");
          assert.equal(requests.at(-1).options.method, "GET");
          await respond({ error: "まだ接続できません" }, 500);
          assert.equal(status(), undefined);
          await click("button-retry-sharing");
          const confirmed = outcome === "committed" ? changed : initial;
          await respond(confirmed);
          assert.match(status(), confirmed.enabled ? /公開中/ : /停止中/);
          assert.equal(document.querySelector('[role="alert"]'), null);
          assert.equal(element("input-share-url")?.value ?? "", confirmed.enabled
            ? `https://judging.test/#results=${confirmed.token}` : "");
          assert.equal(posts().length, 1, "Recovery must never re-send stop or re-enable");
          assert.equal(confirmations, initial.enabled ? 1 : 0);
          for (const request of requests) {
            assert.match(request.url, /\/rooms\/room-sharing\/sharing$/);
            assert.equal(request.options.cache, "no-store");
            assert.equal(request.options.credentials, "same-origin");
          }
          // Another write requires an explicit, fresh click after recovery.
          await click("button-toggle-link");
          assert.equal(posts().length, 2);
          assert.deepEqual(JSON.parse(posts()[1].options.body), { enabled: !confirmed.enabled });
          await respond(confirmed.enabled ? disabled : reenabled);
          await cleanup();
        });
      }
    }
  }
  await t.test("initial read failure is unknown, not stopped, and retry is read-only", async () => {
    await mount();
    await respond({ error: "取得できませんでした" }, 500);
    assert.equal(status(), undefined);
    assert.equal(element("button-toggle-link"), null);
    await click("button-retry-sharing");
    await respond(enabled);
    assert.match(status(), /公開中/);
    assert.equal(posts().length, 0);
    await cleanup();
  });
  await t.test("cancelling stop sends no request and preserves the confirmed link", async () => {
    await mount(enabled);
    allowStop = false;
    await click("button-toggle-link");
    assert.equal(confirmations, 1);
    assert.equal(posts().length, 0);
    assert.match(status(), /公開中/);
    assert.ok(element("input-share-url").value.endsWith(enabled.token));
    await cleanup();
  });
  await t.test("guests have no sharing management requests or controls", async () => {
    await mount(undefined, { ...room, me: "guest" });
    assert.ok(element("text-host-only"));
    assert.equal(element("button-toggle-link"), null);
    assert.equal(element("button-retry-sharing"), null);
    assert.equal(requests.length, 0);
    await cleanup();
  });
});
