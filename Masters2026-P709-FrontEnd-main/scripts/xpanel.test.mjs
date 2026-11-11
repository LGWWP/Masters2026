import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers";
import { URL, URLSearchParams } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/lib/crestron/xpanel.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
const response = (projectInfo) => ({ ok: true, json: async () => projectInfo });

function loadPanel({
  href = "https://panel.example/projects/p709/index.html",
  baseURI = href,
  fetchResponse = async () => response({}),
  isActive = true,
  container = false,
} = {}) {
  const requests = [];
  const initialized = [];
  const listeners = new Map();
  const cipSubscriptions = [];
  const imports = {
    "@crestron/ch5-webxpanel": {
      runsInContainerApp: () => container,
      getWebXPanel: () => ({
        isActive,
        WebXPanelConfigParams: {},
        WebXPanelEvents: new Proxy({}, { get: (_, event) => event }),
        WebXPanel: {
          addEventListener: (event, callback) => listeners.set(event, callback),
          initialize(config) {
            assert.ok(listeners.has("CONNECT_CIP"));
            assert.ok(listeners.has("CONNECT_WS"));
            initialized.push({ ...config });
          },
        },
      }),
    },
    "./crestron": {
      onUrlChange: () => () => {},
      onCipConnectionChange: (callback) => cipSubscriptions.push(callback),
    },
    "../stores/connection.svelte": {
      setCipConnected() {},
      setWsConnected() {},
    },
  };
  runInNewContext(outputText, {
    exports: {},
    window: { location: new URL(href) },
    document: { baseURI },
    URL,
    URLSearchParams,
    fetch(url, options) {
      requests.push([new URL(url, baseURI).href, options]);
      return fetchResponse();
    },
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
  });
  return { requests, initialized, cipSubscriptions };
}

test("Virtual Panel waits for project-config.json and uses it with token-only parameters", async () => {
  let resolveInfo;
  const projectInfo = new Promise((resolve) => {
    resolveInfo = resolve;
  });
  const panel = loadPanel({
    href: "https://panel.example/projects/p709/index.html?authToken=launch-token&tokenSource=Fusion",
    fetchResponse: async () => ({ ok: true, json: () => projectInfo }),
  });
  await flush();
  assert.equal(panel.initialized.length, 0);

  resolveInfo({
    config: {
      controlSystem: {
        host: "172.16.17.15",
        ipId: "0x03",
        roomId: "MASTER2026P709",
      },
    },
  });
  await flush();
  assert.equal(
    panel.requests[0][0],
    "https://panel.example/projects/p709/assets/data/project-config.json",
  );
  assert.equal(panel.requests[0][1].cache, "no-store");
  assert.deepEqual(panel.initialized, [
    {
      host: "172.16.17.15",
      ipId: "0x03",
      port: 49200,
      roomId: "MASTER2026P709",
      tokenSource: "Fusion",
      authToken: "launch-token",
      tokenUrl:
        "https://172.16.17.15/VirtualControl/Rooms/MASTER2026P709/cws/websocket/getWebSocketToken",
    },
  ]);
});

test("project config is resolved in assets/data using the HTML document's base URL", async () => {
  const panel = loadPanel({
    href: "https://panel.example/",
    baseURI: "https://panel.example/projects/p709/index.html",
  });
  await flush();
  assert.equal(
    panel.requests[0][0],
    "https://panel.example/projects/p709/assets/data/project-config.json",
  );
});

test("file connection settings take precedence over URL settings", async () => {
  const panel = loadPanel({
    href: "https://panel.example/?host=url-host&ipid=0x05&roomid=url-room",
    fetchResponse: async () =>
      response({
        config: {
          controlSystem: {
            host: " file-host ",
            ipId: " 0X04 ",
            roomId: " file-room ",
          },
        },
      }),
  });
  await flush();
  const config = panel.initialized[0];
  assert.equal(config.host, "file-host");
  assert.equal(config.ipId, "0x04");
  assert.equal(config.roomId, "file-room");
  assert.equal(
    config.tokenUrl,
    "https://file-host/VirtualControl/Rooms/file-room/cws/websocket/getWebSocketToken",
  );
});

test("partial project info falls back per field and keeps URL authentication", async () => {
  const panel = loadPanel({
    href: "https://panel.example/?host=url-host&ipid=0X06&authToken=launch-token&tokenSource=Fusion&tokenUrl=https%3A%2F%2Fauth.example%2Ftoken",
    fetchResponse: async () =>
      response({
        config: { controlSystem: { host: "file-host", ipId: 3, roomId: " " } },
      }),
  });
  await flush();
  assert.deepEqual(panel.initialized, [
    {
      host: "file-host",
      ipId: "0x06",
      port: 49200,
      roomId: "",
      tokenSource: "Fusion",
      authToken: "launch-token",
      tokenUrl: "https://auth.example/token",
    },
  ]);
});

test("missing project info preserves browser connection parameters", async () => {
  const panel = loadPanel({
    href: "https://panel.example/?host=url-host&ipid=0X05&roomid=url-room",
    fetchResponse: async () => ({ ok: false, status: 404 }),
  });
  await flush();
  assert.equal(panel.initialized[0].host, "url-host");
  assert.equal(panel.initialized[0].ipId, "0x05");
  assert.equal(panel.initialized[0].roomId, "url-room");
});

for (const [name, fetchResponse] of [
  ["missing fields", async () => response({})],
  ["null payload", async () => response(null)],
  ["null config", async () => response({ config: null })],
  [
    "null control system",
    async () => response({ config: { controlSystem: null } }),
  ],
  [
    "invalid values",
    async () =>
      response({
        config: { controlSystem: { host: {}, ipId: false, roomId: [] } },
      }),
  ],
  [
    "invalid JSON",
    async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Invalid JSON");
      },
    }),
  ],
  [
    "network failure",
    async () => {
      throw new Error("Network failure");
    },
  ],
]) {
  test(`${name} falls back to existing defaults`, async () => {
    const panel = loadPanel({ fetchResponse });
    await flush();
    assert.deepEqual(panel.initialized, [
      {
        host: "panel.example",
        ipId: "0x03",
        port: 49200,
        roomId: "",
        tokenSource: "CSSelf",
        authToken: "",
        tokenUrl: "https://panel.example/cws/websocket/getWebSocketToken",
      },
    ]);
  });
}

test("native containers and inactive panels do not fetch project info or initialize WebXPanel", () => {
  for (const container of [true, false]) {
    const panel = loadPanel({ isActive: false, container });
    assert.equal(panel.requests.length, 0);
    assert.equal(panel.initialized.length, 0);
    assert.equal(panel.cipSubscriptions.length, container ? 1 : 0);
  }
});
