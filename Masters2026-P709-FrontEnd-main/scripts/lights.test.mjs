import assert from 'node:assert/strict';
import { atob, Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clearTimeout, setImmediate, setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { TextDecoder } from 'node:util';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const warnings = [];
  const handlers = new Map();
  const requests = [];
  const calls = [];
  function load(path, imports) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const exports = {};
    runInNewContext(outputText, {
      exports, $state: (value) => value,
      atob, URL, TextDecoder, Uint8Array, setTimeout, clearTimeout,
      console: { log() {}, error() {}, warn: (...args) => warnings.push(args) },
      require(name) {
        assert.ok(name in imports, `Unexpected import: ${name}`);
        return imports[name];
      },
    });
    return exports;
  }

  const config = {
    roomName: 'Test room',
    roomSvg: Buffer.from('<svg></svg>').toString('base64'),
    lights: [
      { id: 'wall', name: 'Wall lights', type: 'dimmer', positions: [] },
      { id: 'ceiling', name: 'Ceiling lights', type: 'dimmer', positions: [] },
    ],
    lightingPresets: [], sources: [],
  };
  let reconnect;
  const hub = {
    on(name, callback) { handlers.set(name, callback); },
    onclose() {}, onreconnecting() {},
    onreconnected(callback) { reconnect = callback; },
    async start() {
      assert.ok(handlers.has('LightLevelChanged'), 'register light feedback before connecting');
    },
    invoke(method, ...args) {
      calls.push([method, ...args]);
      if (method === 'GetRoomConfiguration') return Promise.resolve(config);
      assert.equal(method, 'GetRoomState');
      return new Promise((resolve, reject) => requests.push({ resolve, reject }));
    },
  };
  class HubConnectionBuilder {
    withUrl() { return this; }
    configureLogging() { return this; }
    withAutomaticReconnect() { return this; }
    build() { return hub; }
  }

  const store = load('../src/lib/stores/lights.svelte.ts', {});
  const signalr = load('../src/lib/transport/signalr.svelte.ts', {
    '@microsoft/signalr': { HubConnectionBuilder, LogLevel: { Information: 1 } },
    '../stores/navigation.svelte': { nav: { lastLocalNavAt: 0 }, isPageKey: () => false },
    '../stores/lights.svelte': store,
    '../stores/room.svelte': { applyRoomName() {}, applyRoomSvg() {} },
    '../stores/shades.svelte': { applyShades() {}, applyShadePresets() {} },
    '../stores/sources.svelte': { applySources() {} },
    './diagnostics': { setMcpHub() {} },
    '../stores/concierge.svelte': { applyConciergeConfig() {} },
  });
  load('../src/lib/transport/lights.ts', {
    './signalr.svelte': signalr,
    '../stores/lights.svelte': store,
  });
  return { store, signalr, handlers, requests, calls, warnings, reconnect: () => reconnect() };
}

test('lighting levels load on connect and refresh on reconnect', async () => {
  const app = setup();
  app.signalr.initSignalR('http://localhost/hubs/room');
  await flush();
  assert.equal(app.requests.length, 1, 'request room state after connecting');
  app.requests[0].resolve({ lightLevels: [
    { lightId: 'wall', levelPercent: 65 },
    { lightId: 'ceiling', levelPercent: 100 },
  ] });
  await flush();
  assert.equal(app.store.lightsState.levels.wall, 65);
  assert.equal(app.store.lightsState.levels.ceiling, 100);

  app.reconnect();
  assert.equal(app.requests.length, 2, 'request fresh levels after reconnecting');
  app.requests[1].resolve({ lightLevels: [
    { lightId: 'wall', levelPercent: 0 },
    { lightId: 'ceiling', levelPercent: 25 },
  ] });
  await flush();
  assert.equal(app.store.lightsState.levels.wall, 0);
  assert.equal(app.store.lightsState.levels.ceiling, 25);
  assert.deepEqual(app.calls.map(([method]) => method), [
    'GetRoomConfiguration', 'GetRoomState', 'GetRoomConfiguration', 'GetRoomState',
  ]);
  assert.deepEqual(app.warnings, []);
});

test('live feedback wins over a pending snapshot for that light only', async () => {
  const app = setup();
  app.signalr.initSignalR('http://localhost/hubs/room');
  await flush();
  app.handlers.get('LightLevelChanged')('wall', 90);
  app.requests[0].resolve({ lightLevels: [
    { lightId: 'wall', levelPercent: 10 },
    { lightId: 'ceiling', levelPercent: 40 },
  ] });
  await flush();
  assert.equal(app.store.lightsState.levels.wall, 90);
  assert.equal(app.store.lightsState.levels.ceiling, 40);
  assert.deepEqual(app.warnings, []);
});

test('an earlier connection snapshot cannot overwrite a later snapshot', async () => {
  const app = setup();
  app.signalr.initSignalR('http://localhost/hubs/room');
  await flush();
  app.reconnect();
  app.requests[1].resolve({ lightLevels: [{ lightId: 'wall', levelPercent: 80 }] });
  await flush();
  app.requests[0].resolve({ lightLevels: [{ lightId: 'wall', levelPercent: 10 }] });
  await flush();
  assert.equal(app.store.lightsState.levels.wall, 80);
});

test('malformed snapshots do not partially overwrite confirmed levels', async () => {
  const app = setup();
  app.signalr.initSignalR('http://localhost/hubs/room');
  await flush();
  app.handlers.get('LightLevelChanged')('wall', 75);
  const invalidLevels = [
    undefined, null, {},
    [{ lightId: 'wall', levelPercent: 10 }, { lightId: 'wall', levelPercent: 20 }],
    ...[-1, 101, 1.5, NaN, Infinity, '50'].map((levelPercent) => [
      { lightId: 'wall', levelPercent: 10 }, { lightId: 'ceiling', levelPercent },
    ]),
    [{ lightId: '', levelPercent: 10 }],
    [{ lightId: '   ', levelPercent: 10 }],
    [null],
  ];
  for (const lightLevels of invalidLevels) {
    app.reconnect();
    app.requests.at(-1).resolve({ lightLevels });
    await flush();
    assert.equal(app.store.lightsState.levels.wall, 75);
    assert.equal(app.store.lightsState.levels.ceiling, 0);
  }
  assert.equal(app.warnings.length, invalidLevels.length);
  assert.ok(app.warnings.every(([message]) => message === 'SignalR: bad GetRoomState lightLevels payload'));
});

test('invalid live feedback cannot block a valid snapshot', async () => {
  const app = setup();
  app.signalr.initSignalR('http://localhost/hubs/room');
  await flush();
  for (const value of [-1, 101, 1.5, NaN, Infinity, '50']) {
    app.handlers.get('LightLevelChanged')('wall', value);
  }
  app.requests[0].resolve({ lightLevels: [{ lightId: 'wall', levelPercent: 35 }] });
  await flush();
  assert.equal(app.store.lightsState.levels.wall, 35);
  assert.equal(app.warnings.length, 6);
});

test('a failed query preserves levels and a reconnect retries it', async () => {
  const app = setup();
  app.signalr.initSignalR('http://localhost/hubs/room');
  await flush();
  app.handlers.get('LightLevelChanged')('wall', 60);
  app.requests[0].reject(new Error('Hub unavailable'));
  await flush();
  assert.equal(app.store.lightsState.levels.wall, 60);
  assert.equal(app.warnings[0][0], 'GetRoomState lightLevels invoke failed');
  app.reconnect();
  app.requests[1].resolve({ lightLevels: [{ lightId: 'wall', levelPercent: 45 }] });
  await flush();
  assert.equal(app.store.lightsState.levels.wall, 45);
});
