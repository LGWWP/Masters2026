import assert from 'node:assert/strict';
import { atob, btoa } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { URL } from 'node:url';
import { TextDecoder } from 'node:util';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const warnings = [];
  function load(path, imports) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const exports = {};
    runInNewContext(outputText, {
      exports,
      $state: (value) => value,
      URL, atob, TextDecoder, Uint8Array,
      console: { log() {}, warn: (...args) => warnings.push(args) },
      require(name) {
        assert.ok(name in imports, `Unexpected import: ${name}`);
        return imports[name];
      },
    });
    return exports;
  }

  const config = {
    roomName: 'Test room',
    roomSvg: btoa('<svg></svg>'),
    sources: [], lights: [], lightingPresets: [],
  };
  let reconnect;
  const hub = {
    on() {}, onclose() {}, onreconnecting() {},
    onreconnected(callback) { reconnect = callback; },
    start: async () => {},
    invoke(method) {
      assert.equal(method, 'GetRoomConfiguration');
      return Promise.resolve(config);
    },
  };
  class HubConnectionBuilder {
    withUrl() { return this; }
    configureLogging() { return this; }
    withAutomaticReconnect() { return this; }
    build() { return hub; }
  }
  const store = load('../src/lib/stores/sources.svelte.ts', {});
  const signalr = load('../src/lib/transport/signalr.svelte.ts', {
    '@microsoft/signalr': { HubConnectionBuilder, LogLevel: { Information: 1 } },
    '../stores/navigation.svelte': { nav: { lastLocalNavAt: 0 }, isPageKey: () => false },
    '../stores/lights.svelte': { applyLightPresets() {}, applyLoads() {} },
    '../stores/room.svelte': { applyRoomName() {}, applyRoomSvg() {} },
    '../stores/shades.svelte': { applyShades() {}, applyShadePresets() {} },
    '../stores/sources.svelte': store,
    '../stores/diagnostics.svelte': { applyAgentConfig() {} },
    '../stores/concierge.svelte': { applyConciergeConfig() {} },
  });
  return { store, signalr, config, warnings, reconnect: () => reconnect() };
}

test('display preview loads from processor configuration and changes on reconnect', async () => {
  const app = setup();
  app.config.displayPreviewUrl = ' http://192.0.2.10/stream.mjpg ';
  app.signalr.initSignalR('http://localhost/hubs/room');
  await flush();
  assert.equal(app.store.displayPreviewState.url, 'http://192.0.2.10/stream.mjpg');

  app.config.displayPreviewUrl = 'https://display.example/live?stream=output';
  app.reconnect();
  await flush();
  assert.equal(app.store.displayPreviewState.url, app.config.displayPreviewUrl);
  assert.equal(app.warnings.length, 0);
});

test('missing or disabled preview configuration clears an existing stream', async () => {
  const app = setup();
  app.signalr.initSignalR('http://localhost/hubs/room');
  await flush();
  assert.equal(app.store.displayPreviewState.url, null);

  for (const value of [undefined, null, '', '   ']) {
    app.store.applyDisplayPreviewUrl('https://display.example/live');
    app.config.displayPreviewUrl = value;
    app.reconnect();
    await flush();
    assert.equal(app.store.displayPreviewState.url, null);
  }
  assert.equal(app.warnings.length, 0);
});

test('invalid preview configuration clears an existing stream and reports the field', async () => {
  const app = setup();
  app.signalr.initSignalR('http://localhost/hubs/room');
  await flush();

  for (const value of [42, {}, [], '/stream.mjpg', 'http://', 'javascript:alert(1)', 'file:///stream.mjpg']) {
    app.store.applyDisplayPreviewUrl('https://display.example/live');
    app.config.displayPreviewUrl = value;
    app.reconnect();
    await flush();
    assert.equal(app.store.displayPreviewState.url, null);
    assert.deepEqual(app.warnings.at(-1), ['SignalR: bad GetRoomConfiguration displayPreviewUrl payload']);
  }
  assert.equal(app.warnings.length, 7);
});
