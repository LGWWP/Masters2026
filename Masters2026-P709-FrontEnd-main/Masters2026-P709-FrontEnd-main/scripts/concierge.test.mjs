import assert from "node:assert/strict";
import { atob, Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers";
import { URL } from "node:url";
import { TextDecoder } from "node:util";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { compileModule } from "svelte/compiler";

const config = { apiUrl: "http://processor:5002/", roomId: "room & 1", authToken: "test-token" };
const service = { uid: "reception", name: "Reception", description: "Help", icon: "PHN2Zy8+" };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function setup(fetch) {
  const timers = new Map();
  const warnings = [];
  const logs = [];
  let nextTimer = 0;
  const load = (path, imports) => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const exports = {};
    runInNewContext(outputText, {
      exports, $state: (value) => value, fetch, URL, AbortController: globalThis.AbortController,
      atob, TextDecoder, Uint8Array,
      console: {
        warn: (...args) => warnings.push(args),
        log: (...args) => logs.push(args),
      },
      setTimeout: (callback, delay) => {
        const id = ++nextTimer;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      require: (name) => {
        if (name in imports) return imports[name];
        throw new Error(`Unexpected import: ${name}`);
      },
    });
    return exports;
  };
  const store = load("../src/lib/stores/concierge.svelte.ts", {});
  const transport = load("../src/lib/transport/concierge.ts", {
    "../stores/concierge.svelte": store,
  });
  return {
    state: store.conciergeState, store, load, transport, warnings, logs,
    runTimer(delay) {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `No ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

test("concierge room config loads on connect, updates on reconnect, and clears invalid settings", async () => {
  const app = setup();
  const roomConfig = {
    roomName: "Test room",
    roomSvg: Buffer.from("<svg></svg>").toString("base64"),
    sources: [],
    lights: [],
    lightingPresets: [],
    concierge: { baseUrl: "http://processor:5002", roomId: "meeting-room-1", token: "test-token" },
  };
  let reconnect;
  const hub = {
    on() {},
    onclose() {},
    onreconnecting() {},
    onreconnected(callback) { reconnect = callback; },
    start: async () => {},
    invoke(method) {
      assert.equal(method, "GetRoomConfiguration");
      return Promise.resolve(roomConfig);
    },
  };
  class HubConnectionBuilder {
    withUrl() { return this; }
    configureLogging() { return this; }
    withAutomaticReconnect() { return this; }
    build() { return hub; }
  }
  const signalr = app.load("../src/lib/transport/signalr.svelte.ts", {
    "@microsoft/signalr": { HubConnectionBuilder, LogLevel: { Information: 1 } },
    "../stores/navigation.svelte": { nav: { lastLocalNavAt: 0 }, isPageKey: () => false },
    "../stores/lights.svelte": { applyLightPresets() {}, applyLoads() {} },
    "../stores/room.svelte": { applyRoomName() {}, applyRoomSvg() {} },
    "../stores/shades.svelte": { applyShades() {}, applyShadePresets() {} },
    "../stores/sources.svelte": { applySources() {}, applyDisplayPreviewUrl() {} },
    "../stores/diagnostics.svelte": { applyAgentConfig() {} },
    "../stores/concierge.svelte": app.store,
  });
  signalr.initSignalR("http://localhost/hubs/room");
  await flush();
  const first = app.store.conciergeConfigState.current;
  assert.equal(first.apiUrl, "http://processor:5002");
  assert.equal(first.roomId, "meeting-room-1");
  assert.equal(first.authToken, "test-token");
  reconnect();
  await flush();
  assert.equal(app.store.conciergeConfigState.current, first);
  roomConfig.concierge = { ...roomConfig.concierge, token: "new-test-token" };
  reconnect();
  await flush();
  assert.equal(app.store.conciergeConfigState.current.authToken, "new-test-token");
  roomConfig.concierge = { baseUrl: "http://processor:5002", roomId: "meeting-room-1", token: 123 };
  reconnect();
  await flush();
  assert.equal(app.store.conciergeConfigState.current, null);
  assert.ok(app.warnings.some(([message]) => message.includes("concierge payload")));
  roomConfig.concierge = { baseUrl: "http://processor:5002", roomId: "meeting-room-1", token: "test-token" };
  reconnect();
  await flush();
  delete roomConfig.concierge;
  reconnect();
  await flush();
  assert.equal(app.store.conciergeConfigState.current, null);
});

test("loads authenticated room services and sends the selected UID", async () => {
  const calls = [];
  const app = setup(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/health")) return response({ status: "online" });
    if (url.includes("/services?")) return response({ roomId: config.roomId, offlineMessage: "Offline", services: [service] });
    return response({ roomId: config.roomId, serviceUid: service.uid, status: "sent", success: true, message: "Notified." });
  });
  const stop = app.transport.startConcierge(config);
  await flush();
  assert.equal(app.state.status, "online");
  assert.equal(app.state.requests[0].name, "Reception");
  assert.equal(calls[0].url, "http://processor:5002/health");
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[1].url, "http://processor:5002/services?roomId=room%20%26%201");
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-token");
  await app.transport.sendConciergeRequest(app.state.requests[0]);
  assert.equal(calls[2].url, "http://processor:5002/callService");
  assert.equal(calls[2].options.headers.Authorization, "Bearer test-token");
  assert.equal(calls[2].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[2].options.body), { roomId: config.roomId, serviceUid: service.uid });
  assert.equal(app.state.requests[0].status, "confirmed");
  assert.equal(app.state.requests[0].message, "Notified.");
  assert.equal(app.logs.length, 6);
  for (const [index, endpoint] of ["/health", "/services?", "/callService"].entries()) {
    const outgoing = app.logs[index * 2];
    const incoming = app.logs[index * 2 + 1];
    assert.equal(outgoing[0], "[Concierge →]");
    assert.equal(incoming[0], "[Concierge ←]");
    assert.equal(outgoing[1], index === 2 ? "POST" : "GET");
    assert.ok(outgoing[2].includes(endpoint));
    assert.equal(incoming[3].status, 200);
  }
  assert.deepEqual(JSON.parse(app.logs[4][3]), { roomId: config.roomId, serviceUid: service.uid });
  assert.equal(app.logs[5][3].body.message, "Notified.");
  assert.ok(!JSON.stringify(app.logs).includes(config.authToken));
  app.runTimer(3000);
  assert.equal(app.state.requests[0].status, "idle");
  stop();
});

test("server-declared failure and non-2xx errors are not confirmed", async () => {
  let result = response({ roomId: config.roomId, serviceUid: service.uid, status: "failed", success: false, message: "Busy" });
  const app = setup(async (url) => {
    if (url.endsWith("/health")) return response({ status: "online" });
    if (url.includes("/services?")) return response({ roomId: config.roomId, offlineMessage: "Offline", services: [service] });
    return result;
  });
  const stop = app.transport.startConcierge(config);
  await flush();
  const request = app.state.requests[0];
  await app.transport.sendConciergeRequest(request);
  assert.equal(request.status, "failed");
  assert.equal(request.message, "Busy");
  app.runTimer(3000);
  result = response({ error: "unauthorized", message: "Bad token" }, 401);
  await app.transport.sendConciergeRequest(request);
  assert.equal(request.status, "failed");
  assert.equal(request.message, "Bad token");
  assert.equal(app.logs.at(-1)[3].status, 401);
  assert.equal(app.logs.at(-1)[3].body.error, "unauthorized");
  stop();
});

test("offline health retries and reloads services after recovery", async () => {
  let online = false;
  const app = setup(async (url) => {
    if (url.endsWith("/health")) {
      if (!online) throw new Error("offline");
      return response({ status: "online" });
    }
    return response({ roomId: config.roomId, offlineMessage: "Offline", services: [service] });
  });
  const stop = app.transport.startConcierge(config);
  await flush();
  assert.equal(app.state.status, "offline");
  online = true;
  app.runTimer(10000);
  await flush();
  assert.equal(app.state.status, "online");
  assert.equal(app.state.requests.length, 1);
  stop();
});

test("disabled service is refreshed and its error remains visible", async () => {
  let loads = 0;
  const app = setup(async (url) => {
    if (url.endsWith("/health")) return response({ status: "online" });
    if (url.includes("/services?")) {
      loads++;
      return response({ roomId: config.roomId, offlineMessage: "Offline", services: loads === 1 ? [service] : [] });
    }
    return response({ error: "ServiceDisabledForRoom", message: "Service disabled" }, 403);
  });
  const stop = app.transport.startConcierge(config);
  await flush();
  await app.transport.sendConciergeRequest(app.state.requests[0]);
  await flush();
  assert.equal(loads, 2);
  assert.equal(app.state.requests.length, 0);
  assert.equal(app.state.notice, "Service disabled");
  stop();
});

test("missing configuration makes no simulated or HTTP requests", async () => {
  let calls = 0;
  const app = setup(async () => { calls++; });
  const stop = app.transport.startConcierge({ apiUrl: "", roomId: "", authToken: "" });
  assert.equal(app.state.status, "error");
  assert.match(app.state.message, /not configured/);
  assert.equal(calls, 0);
  stop();
});

test("pending calls are not duplicated and service state survives a refresh", async () => {
  let resolveCall;
  let callCount = 0;
  const app = setup(async (url) => {
    if (url.endsWith("/health")) return response({ status: "online" });
    if (url.includes("/services?")) return response({ roomId: config.roomId, offlineMessage: "Offline", services: [service] });
    callCount++;
    return new Promise((resolve) => { resolveCall = resolve; });
  });
  const stop = app.transport.startConcierge(config);
  await flush();
  const request = app.state.requests[0];
  const pending = app.transport.sendConciergeRequest(request);
  await app.transport.sendConciergeRequest(request);
  assert.equal(callCount, 1);
  stop();
  const stopAgain = app.transport.startConcierge(config);
  await flush();
  assert.equal(app.state.requests[0], request);
  assert.equal(request.status, "sending");
  resolveCall(response({ roomId: config.roomId, serviceUid: service.uid, status: "sent", success: true, message: "Done" }));
  await pending;
  assert.equal(request.status, "confirmed");
  stopAgain();
});

test("real Svelte state reacts to service and request updates", async () => {
  const source = readFileSync(new URL("../src/lib/stores/concierge.svelte.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const compiled = compileModule(`${outputText}
    export function watch(callback) {
      return $effect.root(() => {
        $effect(() => callback(conciergeState.requests.map(request => [request.name, request.status])));
      });
    }`, { generate: "client", dev: false });
  const code = compiled.js.code.replace(
    /(['"])svelte\/internal\/client\1/g,
    JSON.stringify(import.meta.resolve("svelte/internal/client")),
  );
  const store = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  const observed = [];
  const cleanup = store.watch((values) => observed.push(values));
  try {
    store.applyConciergeServices([service], "Offline");
    await flush();
    const request = store.conciergeState.requests[0];
    assert.ok(store.conciergeState.requests.includes(request));
    request.status = "sending";
    await flush();
    assert.deepEqual(observed.at(-1), [["Reception", "sending"]]);
    store.applyConciergeServices([{ ...service, name: "Front desk" }], "Offline");
    await flush();
    assert.equal(store.conciergeState.requests[0], request);
    assert.deepEqual(observed.at(-1), [["Front desk", "sending"]]);
  } finally {
    cleanup();
  }
});

test("late health responses cannot update an unmounted page", async () => {
  let resolveHealth;
  let calls = 0;
  const app = setup(() => {
    calls++;
    return new Promise((resolve) => { resolveHealth = resolve; });
  });
  const stop = app.transport.startConcierge(config);
  stop();
  resolveHealth(response({ status: "online" }));
  await flush();
  assert.equal(calls, 1);
  assert.equal(app.state.requests.length, 0);
});

test("concierge page reacts to late config and cleans up when settings change", async () => {
  const compile = (source) => {
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    const compiled = compileModule(outputText, { generate: "client", dev: false });
    const code = compiled.js.code.replace(
      /(['"])svelte\/internal\/client\1/g,
      JSON.stringify(import.meta.resolve("svelte/internal/client")),
    );
    return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  };
  const storeUrl = compile(readFileSync(new URL("../src/lib/stores/concierge.svelte.ts", import.meta.url), "utf8"));
  const store = await import(storeUrl);
  const pageSource = readFileSync(new URL("../src/lib/components/pages/Concierge.svelte", import.meta.url), "utf8");
  const script = pageSource.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, "");
  const page = await import(compile(`
    import { conciergeConfigState } from ${JSON.stringify(storeUrl)};
    import { untrack } from ${JSON.stringify(import.meta.resolve("svelte/internal/client"))};
    export const starts = [];
    export let stops = 0;
    function startConcierge(config) {
      starts.push(config);
      return () => { stops++; };
    }
    export function mount() { return $effect.root(() => { ${script} }); }
  `));
  store.applyConciergeConfig(null);
  const cleanup = page.mount();
  try {
    await flush();
    assert.equal(page.starts.at(-1).apiUrl, "");
    store.applyConciergeConfig(config);
    await flush();
    assert.deepEqual(page.starts.at(-1), config);
    assert.equal(page.stops, 1);
    store.applyConciergeConfig({ ...config });
    store.conciergeState.status = "online";
    await flush();
    assert.equal(page.starts.length, 2);
    store.applyConciergeConfig({ ...config, authToken: "updated-test-token" });
    await flush();
    assert.equal(page.starts.at(-1).authToken, "updated-test-token");
    assert.equal(page.stops, 2);
    store.applyConciergeConfig(null);
    await flush();
    assert.equal(page.starts.at(-1).apiUrl, "");
    assert.equal(page.stops, 3);
  } finally {
    cleanup();
    store.applyConciergeConfig(null);
  }
  assert.equal(page.stops, 4);
});
