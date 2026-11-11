import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/crestron/crestron.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
});

function loadBridge(window) {
  const subscriptions = new Map();
  const received = [];
  const diagnostics = [];
  const CrComLib = {
    subscribeState(type, join, callback) {
      subscriptions.set(`${type}:${join}`, callback);
      return `${type}:${join}`;
    },
    unsubscribeState(type, join, id) {
      assert.equal(id, `${type}:${join}`);
      subscriptions.delete(id);
    }
  };
  for (const [name, type] of [
    ['bridgeReceiveIntegerFromNative', 'n'],
    ['bridgeReceiveBooleanFromNative', 'b'],
    ['bridgeReceiveStringFromNative', 's'],
    ['bridgeReceiveObjectFromNative', 'o']
  ]) {
    CrComLib[name] = (join, value) => {
      received.push([type, join, value]);
      subscriptions.get(`${type}:${join}`)?.(value);
    };
  }
  const exports = {};
  runInNewContext(outputText, {
    window,
    exports,
    require(name) {
      if (name === '@crestron/ch5-crcomlib/build_bundles/cjs/cr-com-lib.js') {
        return { CrComLib };
      }
      if (name === '../stores/diagnostics.svelte') {
        return { logDiagnostic: (...args) => diagnostics.push(args) };
      }
      throw new Error(`Unexpected import: ${name}`);
    }
  });
  return { exports, CrComLib, received, diagnostics };
}

test('native panel callbacks deliver feedback to the same CrComLib subscriptions', () => {
  const window = { nativeContainerMarker: true };
  const { exports, CrComLib, received } = loadBridge(window);
  assert.equal(window.CrComLib, CrComLib);
  assert.equal(window.nativeContainerMarker, true);

  const urls = [];
  const connections = [];
  const unsubscribeUrl = exports.onUrlChange((value) => urls.push(value));
  const unsubscribeCip = exports.onCipConnectionChange((value) => connections.push(value));
  const url = '{"hubUrl":"http://192.0.2.1:5001/hubs/room"}';
  const object = { rcb: { value: 42, time: 0 } };

  for (const name of [
    'bridgeReceiveIntegerFromNative',
    'bridgeReceiveBooleanFromNative',
    'bridgeReceiveStringFromNative',
    'bridgeReceiveObjectFromNative'
  ]) {
    assert.equal(window[name], CrComLib[name], `${name} must be exposed globally`);
  }
  window.bridgeReceiveStringFromNative('1', url);
  window.bridgeReceiveBooleanFromNative('Csig.All_Control_Systems_Online_fb', true);
  window.bridgeReceiveBooleanFromNative('Csig.All_Control_Systems_Online_fb', false);
  window.bridgeReceiveIntegerFromNative('2', 42);
  window.bridgeReceiveObjectFromNative('2', object);
  assert.deepEqual(urls, [url]);
  assert.deepEqual(connections, [true, false]);
  assert.deepEqual(received.slice(-2), [['n', '2', 42], ['o', '2', object]]);

  unsubscribeUrl();
  unsubscribeCip();
  window.bridgeReceiveStringFromNative('1', 'ignored after unsubscribe');
  window.bridgeReceiveBooleanFromNative('Csig.All_Control_Systems_Online_fb', true);
  assert.deepEqual(urls, [url]);
  assert.deepEqual(connections, [true, false]);
});

test('bridge import remains safe without a window', () => {
  assert.doesNotThrow(() => loadBridge(undefined));
});
