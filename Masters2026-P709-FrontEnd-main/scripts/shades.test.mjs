import assert from "node:assert/strict";
import { atob, Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clearTimeout, setImmediate, setTimeout } from "node:timers";
import { URL } from "node:url";
import { TextDecoder } from "node:util";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { compile, compileModule } from "svelte/compiler";
import { render } from "svelte/server";

function loadModule(path, imports, warnings, logs = []) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exports = {};
  runInNewContext(outputText, {
    exports,
    $state: (value) => value,
    console: {
      log: (...args) => logs.push(args),
      warn: (...args) => warnings.push(args),
      error() {},
    },
    atob,
    TextDecoder,
    Uint8Array,
    setTimeout,
    clearTimeout,
    require(name) {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

function setup() {
  const warnings = [];
  const logs = [];
  const handlers = new Map();
  const calls = [];
  const appliedLightingPresets = [];
  const config = {
    roomName: "Test room",
    roomSvg: Buffer.from('<svg viewBox="0 0 1 1"></svg>').toString("base64"),
    sources: [],
    lights: [],
    lightingPresets: [],
    shades: [
      { id: "1", name: "Window Blinds", type: "roller" },
      { id: "2", name: "Curtains", type: "curtain" },
      { id: "3", name: "Rear Venetian", type: "venetian" },
    ],
  };
  const requests = [];
  let reconnect;
  let failCommands = false;
  const hub = {
    on(name, handler) {
      handlers.set(name, handler);
    },
    onclose() {},
    onreconnecting() {},
    onreconnected(handler) {
      reconnect = handler;
    },
    start: async () => {},
    invoke(method, ...args) {
      calls.push([method, ...args]);
      if (method === "GetRoomConfiguration") return Promise.resolve(config);
      if (method === "GetRoomState") {
        return new Promise((resolve) => requests.push(resolve));
      }
      return failCommands
        ? Promise.reject(new Error("HubException: rejected command"))
        : Promise.resolve();
    },
  };
  class HubConnectionBuilder {
    withUrl() {
      return this;
    }
    configureLogging() {
      return this;
    }
    withAutomaticReconnect() {
      return this;
    }
    build() {
      return hub;
    }
  }
  const store = loadModule("../src/lib/stores/shades.svelte.ts", {}, warnings);
  const signalr = loadModule(
    "../src/lib/transport/signalr.svelte.ts",
    {
      "@microsoft/signalr": {
        HubConnectionBuilder,
        LogLevel: { Information: 1 },
      },
      "../stores/navigation.svelte": {
        nav: { lastLocalNavAt: 0 },
        isPageKey: () => false,
      },
      "../stores/lights.svelte": {
        applyLightPresets(presets) {
          appliedLightingPresets.push(presets);
        },
        applyLoads() {},
      },
      "../stores/room.svelte": { applyRoomName() {}, applyRoomSvg() {} },
      "../stores/shades.svelte": store,
      "../stores/sources.svelte": { applySources() {}, applyDisplayPreviewUrl() {} },
      "../stores/diagnostics.svelte": { applyAgentConfig() {} },
      "../stores/concierge.svelte": { applyConciergeConfig() {} },
    },
    warnings,
  );
  const transport = loadModule(
    "../src/lib/transport/shades.ts",
    {
      "./signalr.svelte": signalr,
      "../stores/shades.svelte": store,
    },
    warnings,
    logs,
  );
  return {
    store,
    transport,
    signalr,
    config,
    handlers,
    calls,
    requests,
    warnings,
    logs,
    appliedLightingPresets,
    reconnect: () => reconnect(),
    rejectCommands: () => {
      failCommands = true;
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("lightingPresets config loads on connect and refreshes on reconnect", async () => {
  const app = setup();
  const meeting = { id: "meeting", name: "Meeting", levels: [] };
  app.config.lightingPresets = [meeting];
  app.signalr.initSignalR("http://localhost/hubs/room");
  await flush();
  assert.deepEqual(app.appliedLightingPresets, [[meeting]]);
  app.config.lightingPresets = [];
  app.reconnect();
  await flush();
  assert.deepEqual(app.appliedLightingPresets, [[meeting], []]);
  assert.equal(app.warnings.length, 0);
});

test("documented config and state load on connect and refresh on reconnect", async () => {
  const app = setup();
  app.signalr.initSignalR("http://localhost/hubs/room");
  await flush();
  assert.deepEqual(
    Array.from(app.store.SHADES, (shade) => shade.type),
    ["roller", "curtain", "venetian"],
  );
  assert.equal(app.store.shadesState.positions["1"], undefined);
  app.requests[0]({ shadePositions: [{ shadeId: "1", positionPercent: 65 }] });
  await flush();
  assert.equal(app.store.shadesState.positions["1"], 65);
  app.reconnect();
  app.requests[1]({ shadePositions: [{ shadeId: "1", positionPercent: 100 }] });
  await flush();
  assert.equal(app.store.shadesState.positions["1"], 100);
  assert.equal(app.warnings.length, 0);
});

test("shade config ignores the removed iconSvg field", async () => {
  const app = setup();
  app.config.shades[0].iconSvg = "no longer a supported shade config field";
  app.signalr.initSignalR("http://localhost/hubs/room");
  await flush();
  assert.equal(app.store.SHADES.length, 3);
  assert.equal("iconSvg" in app.store.SHADES[0], false);
  assert.equal(app.warnings.length, 0);
});

test("live position feedback wins over an in-flight snapshot", async () => {
  const app = setup();
  app.signalr.initSignalR("http://localhost/hubs/room");
  await flush();
  app.handlers.get("ShadePositionChanged")("1", 90);
  app.requests[0]({ shadePositions: [{ shadeId: "1", positionPercent: 20 }] });
  await flush();
  assert.equal(app.store.shadesState.positions["1"], 90);
});

test("invalid positions and commands are rejected, and server failures propagate", async () => {
  const app = setup();
  app.signalr.initSignalR("http://localhost/hubs/room");
  await flush();
  for (const value of [-1, 101, 1.5, NaN, Infinity, "50"]) {
    app.handlers.get("ShadePositionChanged")("1", value);
    await assert.rejects(app.transport.setShadePosition("1", value));
  }
  assert.equal(app.store.shadesState.positions["1"], undefined);
  await app.transport.setShadePosition("1", 50);
  assert.deepEqual(app.calls.at(-1), ["SetShadePosition", "1", 50]);
  assert.equal(
    app.store.shadesState.positions["1"],
    undefined,
    "commands must not fake feedback",
  );
  app.rejectCommands();
  await assert.rejects(app.transport.setShadePosition("1", 50), /HubException/);
});

test("tilt and presets remain wired as optional server extensions", async () => {
  const app = setup();
  app.config.shades[2].supportsTilt = true;
  app.config.shadePresets = [
    {
      id: "meeting",
      name: "Meeting",
      targets: [{ shadeId: "3", positionPercent: 65, tiltPercent: 40 }],
    },
  ];
  app.signalr.initSignalR("http://localhost/hubs/room");
  await flush();
  assert.equal(app.store.SHADES[2].supportsTilt, true);
  assert.equal(app.store.shadePresets[0].id, "meeting");
  app.requests[0]({
    shadePositions: [{ shadeId: "3", positionPercent: 65 }],
    shadeTilts: [{ shadeId: "3", tiltPercent: 40 }],
    activeShadePresetId: "meeting",
  });
  await flush();
  assert.equal(app.store.shadesState.tilts["3"], 40);
  assert.equal(app.store.shadesState.activePresetId, "meeting");
  await app.transport.setShadeTilt("3", 70);
  assert.deepEqual(app.calls.at(-1), ["SetShadeTilt", "3", 70]);
  await app.transport.selectShadePreset("meeting");
  assert.equal(app.calls.at(-1)[0], "SelectShadePreset");
  assert.equal(app.calls.at(-1)[1].presetId, "meeting");
  app.handlers.get("ShadeTiltChanged")("3", 70);
  app.handlers.get("ShadePresetSelected")(null);
  assert.equal(app.store.shadesState.tilts["3"], 70);
  assert.equal(app.store.shadesState.activePresetId, null);
});

test("position, tilt, and preset feedback logs incoming events and updates state", async () => {
  const app = setup();
  app.signalr.initSignalR("http://localhost/hubs/room");
  await flush();
  app.handlers.get("ShadePositionChanged")("1", 39);
  app.handlers.get("ShadeTiltChanged")("3", 40);
  app.handlers.get("ShadePresetSelected")("meeting");
  app.handlers.get("ShadePresetSelected")(null);
  const incoming = app.logs.filter(([label]) =>
    label.startsWith("[SignalR ←]"),
  );
  assert.deepEqual(
    incoming.map(([label]) => label),
    [
      "[SignalR ←] ShadePositionChanged",
      "[SignalR ←] ShadeTiltChanged",
      "[SignalR ←] ShadePresetSelected",
      "[SignalR ←] ShadePresetSelected",
    ],
  );
  assert.equal(incoming[0][1].shadeId, "1");
  assert.equal(incoming[0][1].positionPercent, 39);
  assert.equal(incoming[1][1].tiltPercent, 40);
  assert.equal(incoming[2][1].presetId, "meeting");
  assert.equal(incoming[3][1].presetId, null);
  assert.equal(app.store.shadesState.positions["1"], 39);
  assert.equal(app.store.shadesState.tilts["3"], 40);
  assert.equal(app.store.shadesState.activePresetId, null);
});

test("position, tilt, and preset commands log their exact outgoing hub calls", async () => {
  const app = setup();
  app.signalr.initSignalR("http://localhost/hubs/room");
  await flush();
  await app.transport.setShadePosition("1", 65);
  await app.transport.setShadeTilt("3", 40);
  await app.transport.selectShadePreset("meeting");
  const outgoing = app.logs.filter(([label]) => label === "[SignalR →]");
  assert.deepEqual(
    outgoing.map(([, method]) => method),
    ["SetShadePosition", "SetShadeTilt", "SelectShadePreset"],
  );
  assert.equal(outgoing[0][2][0], "1");
  assert.equal(outgoing[0][2][1], 65);
  assert.equal(outgoing[1][2][0], "3");
  assert.equal(outgoing[1][2][1], 40);
  assert.equal(outgoing[2][2][0].presetId, "meeting");
  assert.deepEqual(
    app.calls.slice(-3).map(([method]) => method),
    ["SetShadePosition", "SetShadeTilt", "SelectShadePreset"],
  );
});

test("real Svelte effects refresh when confirmed position and tilt change", async () => {
  const source = readFileSync(
    new URL("../src/lib/stores/shades.svelte.ts", import.meta.url),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const compiled = compileModule(
    `${outputText}
    export function watch(callback) {
      return $effect.root(() => {
        $effect(() => {
          callback([shadesState.positions["1"], shadesState.tilts["1"]]);
        });
      });
    }
  `,
    { generate: "client", dev: false },
  );
  const code = compiled.js.code.replace(
    /(['"])svelte\/internal\/client\1/g,
    JSON.stringify(import.meta.resolve("svelte/internal/client")),
  );
  const store = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
  const observed = [];
  const cleanup = store.watch((values) => observed.push(values));
  try {
    await flush();
    store.applyShadePosition("1", 10);
    store.applyShadeTilt("1", 20);
    await flush();
    assert.deepEqual(observed.at(-1), [10, 20]);
    store.applyShadePosition("1", 39);
    store.applyShadeTilt("1", 40);
    await flush();
    assert.deepEqual(observed.at(-1), [39, 40]);
  } finally {
    cleanup();
  }
});

test("blinds page holds the target through partial feedback and clears it on confirmation or failure", async () => {
  const pageSource = readFileSync(
    new URL("../src/lib/components/pages/Shades.svelte", import.meta.url),
    "utf8",
  );
  const script = pageSource
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+["'][^"']+["'];/g, "");
  const { outputText } = ts.transpileModule(
    `
    export let controls;
    export const cleanup = $effect.root(() => {
      const SHADES = $state([
        { id: "1", name: "One", supportsTilt: true },
        { id: "2", name: "Two", supportsTilt: true }
      ]);
      const shadesState = $state({positions: {"1": 10, "2": 10}, tilts: {"1": 20, "2": 20}});
      let rejectCommands = false;
      let deferCommands = false;
      const pendingCommands = [];
      const tiltCommands = [];
      async function setShadePosition() {
        if (deferCommands) return new Promise((resolve, reject) => pendingCommands.push({ resolve, reject }));
        if (rejectCommands) throw new Error("Test failure");
      }
      async function setShadeTilt(id, value) {
        tiltCommands.push([id, value]);
        if (deferCommands) return new Promise((resolve, reject) => pendingCommands.push({ resolve, reject }));
        if (rejectCommands) throw new Error("Test failure");
      }
      const selectShadePreset = setShadePosition;
      ${script}
      controls = {
        sendPosition,
        sendTiltValue,
        applyPreset,
        setScope,
        pendingCommands,
        defer() { deferCommands = true; },
        resume() { deferCommands = false; },
        position: () => positionPercent,
        tilt: () => tiltPercent,
        tiltCommands,
        error: () => commandError,
        feedback(id, value) { shadesState.positions[id] = value; },
        tiltFeedback(id, value) { shadesState.tilts[id] = value; },
        reject() { rejectCommands = true; }
      };
    });
  `,
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  );
  const compiled = compileModule(outputText, {
    generate: "client",
    dev: false,
  });
  const code = compiled.js.code.replace(
    /(['"])svelte\/internal\/client\1/g,
    JSON.stringify(import.meta.resolve("svelte/internal/client")),
  );
  const { controls, cleanup } = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
  try {
    await flush();
    await controls.sendPosition(39);
    await flush();
    assert.equal(controls.position(), 39);
    controls.feedback("1", 39);
    await flush();
    assert.equal(
      controls.position(),
      39,
      "partial feedback must not show the average",
    );
    controls.feedback("2", 39);
    await flush();
    assert.equal(controls.position(), 39);
    controls.feedback("1", 41);
    controls.feedback("2", 41);
    await flush();
    assert.equal(
      controls.position(),
      41,
      "confirmed target must release the draft",
    );
    await controls.sendTiltValue(60);
    assert.deepEqual(
      controls.tiltCommands,
      [["1", 40]],
      "open/closed commands must use the reversed controller scale",
    );
    controls.tiltFeedback("1", 40);
    await flush();
    assert.equal(controls.tilt(), 60);
    controls.tiltFeedback("2", 40);
    await flush();
    controls.tiltFeedback("1", 30);
    controls.tiltFeedback("2", 30);
    await flush();
    assert.equal(controls.tilt(), 70);
    controls.reject();
    await controls.sendPosition(80);
    await flush();
    assert.equal(
      controls.position(),
      41,
      "failure must restore confirmed feedback",
    );
    assert.match(controls.error(), /Could not set/);
    controls.defer();
    const earlier = controls.sendPosition(20);
    const latest = controls.sendPosition(70);
    assert.equal(controls.pendingCommands.length, 2);
    controls.pendingCommands[0].reject(new Error("Earlier command failed"));
    await earlier;
    assert.equal(controls.position(), 70, "an earlier failure must preserve the latest target");
    assert.equal(controls.error(), null);
    controls.pendingCommands[1].resolve();
    await latest;
    const earlierTilt = controls.sendTiltValue(20);
    const latestTilt = controls.sendTiltValue(80);
    controls.pendingCommands[2].reject(new Error("Earlier tilt failed"));
    await earlierTilt;
    assert.equal(controls.tilt(), 80);
    assert.equal(controls.error(), null);
    controls.pendingCommands[3].resolve();
    await latestTilt;
    const preset = controls.applyPreset("meeting");
    const afterPreset = controls.sendPosition(90);
    controls.pendingCommands[4].reject(new Error("Earlier preset failed"));
    await preset;
    assert.equal(controls.position(), 90);
    assert.equal(controls.error(), null);
    controls.pendingCommands[5].resolve();
    await afterPreset;
  } finally {
    cleanup();
  }
});

test("shade level controls show drafts, highlight confirmed values, and respect connection state", async () => {
  const source = readFileSync(
    new URL("../src/lib/components/pages/ShadeLevelControl.svelte", import.meta.url),
    "utf8",
  );
  const compiled = compile(source, { generate: "server" });
  const code = compiled.js.code.replace(
    /(['"])svelte\/internal\/server\1/g,
    JSON.stringify(import.meta.resolve("svelte/internal/server")),
  );
  const { default: ShadeLevelControl } = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );

  for (const kind of ["position", "tilt"]) {
    for (const disabled of [false, true]) {
      for (const confirmedValue of [null, 0, 100]) {
        const value = confirmedValue === null ? null : 75;
        const { body } = render(ShadeLevelControl, {
          props: {
            kind,
            label: kind === "tilt" ? "Slat Tilt" : "Shade Position",
            value,
            confirmedValue,
            disabled,
            oninput() {},
            oncommit() {},
          },
        });
        const controls = [...body.matchAll(/<(?:input|button)\b[^>]*>/g)]
          .map(([tag]) => tag);
        assert.equal(controls.length, 3);
        assert.ok(controls.every((tag) => /\sdisabled(?:\s|>|=)/.test(tag) === disabled));
        assert.match(controls[0], new RegExp(`value="${value ?? 0}"`));
        assert.match(body, value === null ? />--<\/span>/ : />75%<\/span>/);
        assert.equal(/\bactive\b/.test(controls[1]), confirmedValue === 0);
        assert.equal(/\bactive\b/.test(controls[2]), confirmedValue === 100);
        assert.match(body, kind === "tilt"
          ? /aria-label="Slat tilt quick actions"/
          : /aria-label="Position quick actions"/);
      }
    }
  }
});

test("shade presets accept null, omitted, and numeric tilt targets", async () => {
  const app = setup();
  app.config.shadePresets = [
    {
      id: "meeting",
      name: "Meeting",
      targets: [
        { shadeId: "1", positionPercent: 40, tiltPercent: null },
        { shadeId: "2", positionPercent: 40 },
        { shadeId: "3", positionPercent: 65, tiltPercent: 40 },
      ],
    },
    {
      id: "open",
      name: "Open",
      targets: [
        { shadeId: "1", positionPercent: 100, tiltPercent: null },
        { shadeId: "2", positionPercent: 100 },
        { shadeId: "3", positionPercent: 100, tiltPercent: 0 },
      ],
    },
  ];
  app.signalr.initSignalR("http://localhost/hubs/room");
  await flush();
  assert.deepEqual(Array.from(app.store.shadePresets), app.config.shadePresets);
  assert.equal(app.warnings.length, 0);
});

test("shade presets still reject invalid non-null tilt values", async () => {
  for (const tiltPercent of [-1, 101, 1.5, NaN, Infinity, "40", false]) {
    const app = setup();
    app.config.shadePresets = [
      {
        id: "meeting",
        name: "Meeting",
        targets: [{ shadeId: "3", positionPercent: 65, tiltPercent }],
      },
    ];
    app.signalr.initSignalR("http://localhost/hubs/room");
    await flush();
    assert.equal(app.store.shadePresets.length, 0);
    assert.equal(app.warnings.length, 1);
    assert.match(
      app.warnings[0][0],
      /bad GetRoomConfiguration shadePresets payload/,
    );
  }
});

test("invalid config and malformed snapshots log errors without overwriting state", async () => {
  const app = setup();
  app.config.shades.push({ id: "1", name: "Duplicate", type: "roller" });
  app.signalr.initSignalR("http://localhost/hubs/room");
  await flush();
  assert.equal(app.store.SHADES.length, 0);
  app.requests[0]({ shadePositions: [{ shadeId: "1", positionPercent: 101 }] });
  await flush();
  assert.equal(app.store.shadesState.positions["1"], undefined);
  assert.equal(app.warnings.length, 2);
});
