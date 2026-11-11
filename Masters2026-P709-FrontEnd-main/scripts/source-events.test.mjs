import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { HubConnection, JsonHubProtocol, LogLevel } from '@microsoft/signalr';
import ts from 'typescript';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const warnings = [];
  const ready = [];
  const connected = [];
  const requests = [];
  const calls = [];
  function load(path, imports) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const exports = {};
    runInNewContext(outputText, {
      exports,
      $state: (value) => value,
      console: { log() {}, warn: (...args) => warnings.push(args) },
      require(name) {
        assert.ok(name in imports, `Unexpected import: ${name}`);
        return imports[name];
      },
    });
    return exports;
  }

  const store = load('../src/lib/stores/sources.svelte.ts', {});
  const signalr = {
    onHubReady: (callback) => ready.push(callback),
    onHubConnected: (callback) => connected.push(callback),
    getHub: () => hub,
    resolveRoomHubRelativeUrl: (path) => new URL(path, 'http://localhost/hubs/room').href,
  };
  load('../src/lib/transport/sources.ts', {
    './signalr.svelte': signalr,
    '../stores/sources.svelte': store,
  });
  load('../src/lib/transport/system.ts', {
    './signalr.svelte': signalr,
    '../stores/system.svelte': load('../src/lib/stores/system.svelte.ts', {}),
    '../stores/sources.svelte': store,
  });

  // Use the real SignalR dispatcher with an in-memory connection. Deliver
  // an event with the handshake to cover messages arriving during start().
  const connection = {
    features: {},
    baseUrl: 'http://localhost/hubs/room',
    async start() {},
    async send(data) {
      const message = JSON.parse(data.slice(0, -1));
      if (message.protocol) {
        connection.onreceive('{}\u001e' + JSON.stringify({
          type: 1, target: 'StreamRunningChanged', arguments: [true],
        }) + '\u001e');
      } else if (message.type === 1) {
        calls.push(message.target);
        const complete = (payload) => connection.onreceive(JSON.stringify({
          type: 3, invocationId: message.invocationId, ...payload,
        }) + '\u001e');
        if (message.target === 'GetPreviewUrl') {
          complete({ result: '/nvx/preview' });
        } else {
          assert.equal(message.target, 'GetRoomState');
          requests.push({
            resolve: (result) => complete({ result }),
            reject: (error) => complete({ error }),
          });
        }
      }
    },
    async stop(error) { connection.onclose(error); },
  };
  const hub = HubConnection.create(connection, {
    log(level, message) {
      if (level >= LogLevel.Warning) warnings.push([message]);
    },
  }, new JsonHubProtocol());
  for (const register of ready) register(hub);

  return {
    hub, store, warnings, requests, calls,
    async connect() {
      await hub.start();
      for (const callback of connected) callback(hub);
    },
    reconnect() {
      for (const callback of connected) callback(hub);
    },
    receive(target, ...args) {
      connection.onreceive(JSON.stringify({ type: 1, target, arguments: args }) + '\u001e');
    },
  };
}

test('stream broadcasts arriving on connect and later update state without missing-handler warnings', async () => {
  const app = setup();
  assert.equal(app.store.sourcesState.isStreamRunning, null);
  try {
    await app.hub.start();
    assert.equal(app.store.sourcesState.isStreamRunning, true);

    app.receive('SelectedSourceChanged', 'nvx-1');
    app.receive('streamrunningchanged', false);
    assert.equal(app.store.sourcesState.isStreamRunning, false);
    assert.equal(app.store.sourcesState.current, 'nvx-1');

    app.receive('StreamRunningChanged', true);
    assert.equal(app.store.sourcesState.isStreamRunning, true);
    assert.deepEqual(app.warnings, []);
  } finally {
    await app.hub.stop();
  }
});

test('malformed stream broadcasts preserve the last confirmed status', async () => {
  const app = setup();
  try {
    await app.hub.start();
    for (const value of ['false', 0, null, {}, [], undefined]) {
      app.receive('StreamRunningChanged', value);
      assert.equal(app.store.sourcesState.isStreamRunning, true);
    }
    assert.equal(app.warnings.length, 6);
    assert.ok(app.warnings.every(([message]) => message === 'SignalR: bad StreamRunningChanged payload'));
  } finally {
    await app.hub.stop();
  }
});

test('the current source loads on connect and refreshes on reconnect', async () => {
  const app = setup();
  try {
    await app.connect();
    assert.equal(app.requests.length, 1, 'request current state on connect');
    app.requests[0].resolve({ selectedSourceId: 'nvx-1' });
    await flush();
    assert.equal(app.store.sourcesState.current, 'nvx-1');
    assert.equal(app.store.displayPreviewState.url, 'http://localhost/nvx/preview');

    app.reconnect();
    assert.equal(app.requests.length, 2, 'request current state on reconnect');
    app.requests[1].resolve({ selectedSourceId: 'laptop' });
    await flush();
    assert.equal(app.store.sourcesState.current, 'laptop');

    app.reconnect();
    app.requests[2].resolve({ selectedSourceId: null });
    await flush();
    assert.equal(app.store.sourcesState.current, null, 'clear stale selection when the server reports none');
    assert.deepEqual(app.calls, [
      'GetRoomState', 'GetPreviewUrl', 'GetRoomState', 'GetPreviewUrl', 'GetRoomState', 'GetPreviewUrl',
    ]);
    assert.deepEqual(app.warnings, []);
  } finally {
    await app.hub.stop();
  }
});

test('newer source feedback wins over a pending snapshot, including repeated ids and null', async () => {
  const app = setup();
  try {
    await app.connect();
    app.receive('SelectedSourceChanged', 'nvx-1');
    app.requests[0].resolve({ selectedSourceId: 'old-source' });
    await flush();
    assert.equal(app.store.sourcesState.current, 'nvx-1');

    app.reconnect();
    app.receive('SelectedSourceChanged', 'nvx-1');
    app.requests[1].resolve({ selectedSourceId: 'old-source' });
    await flush();
    assert.equal(app.store.sourcesState.current, 'nvx-1');

    app.reconnect();
    app.receive('SelectedSourceChanged', null);
    app.requests[2].resolve({ selectedSourceId: 'old-source' });
    await flush();
    assert.equal(app.store.sourcesState.current, null);
    assert.deepEqual(app.warnings, []);
  } finally {
    await app.hub.stop();
  }
});

test('power-off feedback prevents a delayed snapshot from restoring a cleared source', async () => {
  const app = setup();
  try {
    await app.connect();
    app.receive('SelectedSourceChanged', 'nvx-1');
    app.requests[0].resolve({ selectedSourceId: 'nvx-1' });
    await flush();

    app.reconnect();
    app.receive('SystemPowerStateChanged', 'off');
    app.requests[1].resolve({ selectedSourceId: 'nvx-1' });
    await flush();
    assert.equal(app.store.sourcesState.current, null);
    assert.deepEqual(app.warnings, []);
  } finally {
    await app.hub.stop();
  }
});

test('an older connection snapshot cannot replace a newer current source', async () => {
  const app = setup();
  try {
    await app.connect();
    app.reconnect();
    app.requests[1].resolve({ selectedSourceId: 'laptop' });
    await flush();
    app.requests[0].resolve({ selectedSourceId: 'old-source' });
    await flush();
    assert.equal(app.store.sourcesState.current, 'laptop');
    assert.deepEqual(app.warnings, []);
  } finally {
    await app.hub.stop();
  }
});

test('invalid source snapshots and live payloads preserve the confirmed selection', async () => {
  const app = setup();
  try {
    await app.connect();
    app.requests[0].resolve({ selectedSourceId: 'nvx-1' });
    await flush();
    const invalid = [undefined, '', '   ', 42, false, [], {}];
    for (const selectedSourceId of invalid) {
      app.reconnect();
      if (selectedSourceId === undefined) app.receive('SelectedSourceChanged');
      else app.receive('SelectedSourceChanged', selectedSourceId);
      app.requests.at(-1).resolve({ selectedSourceId });
      await flush();
      assert.equal(app.store.sourcesState.current, 'nvx-1');
    }
    assert.equal(app.warnings.length, invalid.length * 2);
    assert.equal(app.warnings.filter(([message]) => message === 'SignalR: bad GetRoomState selectedSourceId payload').length, invalid.length);
  } finally {
    await app.hub.stop();
  }
});

test('a failed source query retains the last selection and retries on reconnect', async () => {
  const app = setup();
  try {
    await app.connect();
    app.receive('SelectedSourceChanged', 'nvx-1');
    app.requests[0].reject('Hub unavailable');
    await flush();
    assert.equal(app.store.sourcesState.current, 'nvx-1');
    assert.equal(app.warnings[0][0], 'GetRoomState selectedSourceId invoke failed');

    app.reconnect();
    app.requests[1].resolve({ selectedSourceId: 'laptop' });
    await flush();
    assert.equal(app.store.sourcesState.current, 'laptop');
  } finally {
    await app.hub.stop();
  }
});
