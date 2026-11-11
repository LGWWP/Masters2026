// -----------------------------------------------------------------------------
// signalr.svelte.ts — connection infrastructure for the C# SignalR backend
// -----------------------------------------------------------------------------
// This module wraps the @microsoft/signalr client so the rest of the app never
// has to know about hub construction, reconnect policy, or the raw wire. It
// exposes:
//
//   initSignalR(url)      — start the connection (call once from App.svelte)
//   onHubReady(cb)        — domain modules register their inbound handlers
//   getHub()              — domain modules grab the hub for outbound invokes
//   syncPage(key)         — navigation echo (kept here because nav is app-wide)
//   appStatus.isConnected — reactive flag the UI can show as a badge
//
// WHAT LIVES HERE VS. IN A DOMAIN TRANSPORT (transport/lights.ts, ...)
//   * Here:   things every domain needs — connection, retry, appStatus.
//   * There:  domain-specific hub.on() handlers and command functions.
//   Split this way, adding a new page (Shades, Sources, Climate…) does NOT
//   grow this file. You add one `transport/<domain>.ts` and one line in
//   App.svelte to import it. Nothing else in this file changes.
//
// DESIGN PRINCIPLE — "offline-first":
//   Every function here is fire-and-forget. If SignalR is down, the local UI
//   still updates immediately for navigation, and the wire calls just swallow
//   the error. Domain commands that require a server echo (lights, system
//   power, volume) are simply dropped while disconnected — the user
//   experience does not depend on the network being up for navigation.
//
// DESIGN PRINCIPLE — "server may push, but user always wins":
//   The Crestron backend can broadcast a "CurrentPageChanged" event to force
//   all panels onto the same page. But if the user just tapped a button, we
//   should NOT yank them off it because a stale echo arrives 200ms later.
//   That's the "user-intent lock" — see the inbound handler below.
// -----------------------------------------------------------------------------

import * as signalR from '@microsoft/signalr';
import { nav, goTo, isPageKey, type PageKey } from '../stores/navigation.svelte';
import {
  applyLightPresets,
  applyLoads,
  type LightLoad,
  type LightLoadPosition,
  type LightPreset
} from '../stores/lights.svelte';
import { applyRoomName } from '../stores/room.svelte';
import {
  applyShades,
  applyShadePresets,
  isShadePosition,
  type Shade,
  type ShadePreset
} from '../stores/shades.svelte';
import { applySources, type Source, type SourceType } from '../stores/sources.svelte';
import { setMcpHub } from './diagnostics';
import { applyConciergeConfig } from '../stores/concierge.svelte';

// -----------------------------------------------------------------------------
// Connection status — a tiny reactive store the UI can read
// -----------------------------------------------------------------------------
// Kept as its own module-level `$state` (rather than folded into `nav`) so
// components that only care about "am I online?" don't have to import the
// whole navigation store. Small, single-purpose stores compose better.
export const appStatus = $state<{ isConnected: boolean }>({
  isConnected: false
});

// -----------------------------------------------------------------------------
// Module-level state (deliberately private — not exported)
// -----------------------------------------------------------------------------
// `hub` is the SignalR connection. It is `null` until initSignalR() runs.
// Domain modules access it through getHub() so they can guard on null the
// same way our own outbound helpers do.
let hub: signalR.HubConnection | null = null;

// The room hub URL initSignalR() was called with. Kept so the optional MCP
// hub address can be resolved against the same scheme/host/port — the room
// config only publishes a path (`mcpHubPath`), never a full URL.
let roomHubUrl = '';

// Domain transports (transport/lights.ts, etc.) register their inbound
// handlers via onHubReady(). Their callbacks are queued here until the hub
// is built, then invoked once. Keeping this queue avoids any coupling from
// signalr.svelte.ts back to individual domain modules — this file never has
// to know that a "Lights" domain exists.
const hubReadyCallbacks: Array<(hub: signalR.HubConnection) => void> = [];
const hubConnectedCallbacks: Array<(hub: signalR.HubConnection) => void> = [];

// How long after a local tap should we ignore a server "CurrentPageChanged"
// echo? 500ms is comfortable: long enough to cover round-trip latency plus
// render, short enough that a real server-driven page change still feels
// responsive.
const USER_INTENT_LOCK_MS = 500;

// How long to wait between "cold start" retry attempts when the hub is not
// yet reachable (e.g., backend hasn't booted yet). This retry loop only runs
// BEFORE the first successful connect. Once connected, SignalR's built-in
// withAutomaticReconnect takes over.
const COLD_RETRY_MS = 5000;

// Tracks the pending retry so we never schedule two in parallel (which would
// happen if initSignalR were somehow called twice).
let coldRetryTimer: ReturnType<typeof setTimeout> | null = null;

// -----------------------------------------------------------------------------
// initSignalR — call once from App.svelte's onMount
// -----------------------------------------------------------------------------
// Steps:
//   1. Build the connection ONCE with automatic reconnect (tuned for Crestron
//      hardware — aggressive retries early, then back off).
//   2. Register inbound handlers BEFORE calling start(). SignalR queues
//      incoming messages until handlers exist, but registering after start
//      would cause a race on the very first message.
//   3. Wire the lifecycle callbacks to keep `appStatus.isConnected` accurate.
//   4. Kick off tryStart(). Fire-and-forget; if it fails we stay in "offline
//      mode" and tryStart schedules its own retry on the SAME connection.
//      We do not rebuild the connection on every retry — that's wasteful and
//      leaks event handlers.
export function initSignalR(url: string): void {
  // Guard against double-init (e.g., HMR during dev, or accidental double
  // call from onMount). If we already have a connection, do nothing.
  if (hub) return;

  roomHubUrl = url;

  // TODO: UI Lab 1.1 - Assign a SignalR hub connection to the `hub` variable
  // Hint: We need to pass in the url and specify any additional options required for the connection.
  //       These options are for logging level and automatic reconnect behavior.
  // UI Lab 1.1 - End

  // REF UI Lab 1.1
  hub = new signalR.HubConnectionBuilder()
    .withUrl(url)
    // SignalR's built-in logger. LogLevel.Information prints connection
    // lifecycle events (connecting / connected / reconnecting) to the
    // browser console. Bump to LogLevel.Debug or Trace when you want to see
    // negotiation / transport / keep-alive detail. LogLevel.None suppresses
    // everything — useful in production, noisy during learning.
    .configureLogging(signalR.LogLevel.Information)
    .withAutomaticReconnect({
      // Retry every 1s for the first 10 attempts, then every 5s forever.
      // This is a good default for a control panel that must "eventually
      // heal" without any user action.
      nextRetryDelayInMilliseconds: (ctx) =>
        ctx.previousRetryCount < 10 ? 1000 : 5000
    })
    .build();
  // REF UI Lab 1.1 – End

  // ---------------------------------------------------------------------------
  // Inbound: server pushed a page change
  // ---------------------------------------------------------------------------
  // Contract with the C# hub: it invokes
  // `Clients.Others.SendAsync("CurrentPageChanged", "lights")` (or similar)
  // whenever the "current page" changes on the Crestron system. We
  // defensively:
  //   - runtime-check the string is a valid PageKey (server bugs happen),
  //   - honor the user-intent lock so a fresh local tap isn't overwritten,
  //   - skip if we're already on that page (avoids a needless re-render).
  hub.on('CurrentPageChanged', (serverPageKey: string) => {
    // Trace every inbound page-sync so you can watch multi-panel navigation.
    console.log('[SignalR ←] CurrentPageChanged', serverPageKey);

    if (!isPageKey(serverPageKey)) {
      console.warn(`SignalR: received unknown page key "${serverPageKey}"`);
      return;
    }

    const sinceLastLocalTap = performance.now() - nav.lastLocalNavAt;
    if (sinceLastLocalTap < USER_INTENT_LOCK_MS) {
      // User just tapped locally. Ignore the server echo so we don't fight
      // the user. If the server insists, it will send CurrentPageChanged
      // again after the lock expires and we'll pick it up then.
      return;
    }

    if (nav.current !== serverPageKey) {
      goTo(serverPageKey);
    }
  });

  // ---------------------------------------------------------------------------
  // Hand the freshly-built hub off to every domain transport that registered
  // via onHubReady() before we booted. This is where transport/lights.ts (and
  // future transport/shades.ts, transport/sources.ts, …) install their
  // hub.on() handlers.
  //
  // Runs BEFORE tryStart(url) so handlers are wired before the first inbound
  // message can arrive. SignalR does queue inbound messages briefly, but
  // wiring up-front removes any race entirely.
  // ---------------------------------------------------------------------------
  for (const register of hubReadyCallbacks) register(hub);
  hubReadyCallbacks.length = 0;

  // ---------------------------------------------------------------------------
  // Connection lifecycle — keep appStatus.isConnected in sync
  // ---------------------------------------------------------------------------
  hub.onclose((err) => {
    appStatus.isConnected = false;
    console.error('SignalR connection closed.', err ?? '(no error reported)');
    // If the connection dies AFTER a successful start (e.g., backend
    // restarted and exhausted its automatic reconnect retries), fall back
    // to the cold-retry loop so we still eventually recover.
    scheduleColdRetry(url);
  });
  hub.onreconnecting((err) => {
    appStatus.isConnected = false;
    console.warn('SignalR reconnecting…', err ?? '(no error reported)');
  });
  hub.onreconnected(() => {
    appStatus.isConnected = true;
    console.log('SignalR reconnected.');
    fetchRoomConfiguration();
    if (hub) {
      for (const callback of hubConnectedCallbacks) callback(hub);
    }
  });

  // Kick off the first connection attempt.
  tryStart(url);
}

// -----------------------------------------------------------------------------
// fetchRoomConfiguration — request/response call (not a push), fired once
// per successful connect/reconnect
// -----------------------------------------------------------------------------
// Unlike every other hub interaction here, "GetRoomConfiguration" is a plain
// request/response invoke: the server's return value IS the room config, so
// we read it straight off the resolved Promise instead of waiting for a
// separate broadcast event.
function fetchRoomConfiguration(): void {
  if (!hub) return;

  // TODO: UI Lab 1.2 - Get the configuration from the server after connecting
  // Hint: Invoke the 'GetRoomConfiguration' method on the hub
  //       Log the config to console
  //       Apply the configuration to the appropriate stores
  // UI Lab 2 - End

  // REF UI Lab 1.2
  hub
    .invoke('GetRoomConfiguration')
    .then((config: unknown) => {
      console.log('[SignalR ←] GetRoomConfiguration', config);
      applyRoomConfiguration(config);
    })
    .catch((err) => {
      console.warn('GetRoomConfiguration invoke failed', err);
    });
  // END REF UI Lab 1.2
}

// -----------------------------------------------------------------------------
// applyRoomConfiguration — hands pieces of the room config to domain stores
// -----------------------------------------------------------------------------
// The response describes the whole room (sources, lights, lightingPresets, SVG
// floor plan, …), but each domain owns only the slice it cares about — same
// boundary as everywhere else in this file. Today the room name, the room's
// floor-plan SVG, the source catalogue, the lighting load/preset catalogues,
// and the shades/blinds catalogue are consumed; add more `apply...()`
// calls here as more of the UI moves off hardcoded local config.
// (The display preview URL is NOT part of this payload — it comes from the
// hub's dedicated GetPreviewUrl query, fetched by transport/sources.ts.)
function applyRoomConfiguration(config: unknown): void {
  const roomName = (config as { roomName?: unknown } | null)?.roomName;

  // The wire is untrusted — validate shape before handing it to the store.
  if (typeof roomName === 'string' && roomName.length > 0) {
    applyRoomName(roomName);
  } else {
    console.warn('SignalR: bad GetRoomConfiguration roomName payload', roomName);
  }

  const sources = (config as { sources?: unknown } | null)?.sources;

  if (!isSourceArray(sources)) {
    console.warn('SignalR: bad GetRoomConfiguration sources payload', sources);
  } else {
    applySources(sources.map(normalizeSource));
  }

  const lights = (config as { lights?: unknown } | null)?.lights;

  if (!isLightLoadArray(lights)) {
    console.warn('SignalR: bad GetRoomConfiguration lights payload', lights);
  } else {
    applyLoads(lights.map(normalizeLightLoad));
  }

  const shades = (config as { shades?: unknown } | null)?.shades;

  if (shades === undefined) {
    applyShades([]);
  } else if (!isShadeArray(shades)) {
    console.warn('SignalR: bad GetRoomConfiguration shades payload', shades);
  } else {
    applyShades(shades.map(normalizeShade));
  }
  const shadePresets = (config as { shadePresets?: unknown } | null)?.shadePresets;
  if (shadePresets === undefined) {
    applyShadePresets([]);
  } else if (isShadePresetArray(shadePresets)) {
    applyShadePresets(shadePresets);
  } else {
    console.warn('SignalR: bad GetRoomConfiguration shadePresets payload', shadePresets);
  }

  // AI room diagnostics live on their OWN SignalR hub (see
  // transport/diagnostics.ts). The room config publishes only its PATH
  // (`mcpHubPath`, e.g. "/hubs/mcp") — and only when MCP/troubleshooting is
  // configured for this program. The full URL is resolved against the room
  // hub's host (same scheme/host/port). When the path is absent or null, the
  // Support page shows no diagnostics UI at all.
  const mcpHubPath = (config as { mcpHubPath?: unknown } | null)?.mcpHubPath;

  if (typeof mcpHubPath === 'string' && mcpHubPath.trim().length > 0) {
    const mcpHubUrl = resolveMcpHubUrl(mcpHubPath.trim());
    if (mcpHubUrl) {
      setMcpHub(mcpHubUrl);
    } else {
      console.warn('SignalR: could not resolve mcpHubPath against room hub URL', mcpHubPath);
      setMcpHub(null);
    }
  } else {
    setMcpHub(null);
    if (mcpHubPath !== undefined && mcpHubPath !== null) {
      console.warn('SignalR: bad GetRoomConfiguration mcpHubPath payload', mcpHubPath);
    }
  }

  const concierge = (config as { concierge?: unknown } | null)?.concierge;
  if (isConciergeConfig(concierge)) {
    applyConciergeConfig({
      apiUrl: concierge.baseUrl.trim(),
      roomId: concierge.roomId.trim(),
      authToken: concierge.token.trim()
    });
  } else {
    applyConciergeConfig(null);
    if (concierge !== undefined && concierge !== null) {
      console.warn('SignalR: bad GetRoomConfiguration concierge payload');
    }
  }

  const lightingPresets = (config as { lightingPresets?: unknown } | null)?.lightingPresets;

  if (!isLightPresetArray(lightingPresets)) {
    console.warn('SignalR: bad GetRoomConfiguration lightingPresets payload', lightingPresets);
  } else {
    applyLightPresets(lightingPresets);
  }

}

// -----------------------------------------------------------------------------
// decodeBase64Svg — the processor now sends every *Svg field (roomSvg, and
// each source's/light's iconSvg) base64-encoded rather than raw markup.
// Decodes via TextDecoder (not a plain atob() string) so multi-byte/UTF-8
// characters in the SVG survive intact. Returns null (rather than garbage)
// for anything that isn't valid base64 or doesn't decode to SVG markup, so
// callers can fall back the same way they already do for a missing field.
// -----------------------------------------------------------------------------
function decodeBase64Svg(value: string): string | null {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const decoded = new TextDecoder('utf-8').decode(bytes);
    return decoded.includes('<svg') ? decoded : null;
  } catch {
    return null;
  }
}

// Every type the UI knows a dedicated icon for. Anything else coming off the
// wire (a server bug, or a future type this build predates) is coerced to
// "other" in normalizeSource() below, which falls back to iconSvg (or a
// generic default icon) rather than rendering nothing.
const KNOWN_SOURCE_TYPES: readonly SourceType[] = [
  'tv',
  'ohp',
  'wirelessPresenter',
  'laptopHdmi',
  'laptopUsbC',
  'other'
];

function isConciergeConfig(value: unknown): value is { baseUrl: string; roomId: string; token: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const cfg = value as Record<string, unknown>;
  return typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim().length > 0 &&
    typeof cfg.roomId === 'string' && cfg.roomId.trim().length > 0 &&
    typeof cfg.token === 'string' && cfg.token.trim().length > 0;
}

// Resolves the MCP hub path from the room config against the room hub's
// scheme/host/port (serial join 1's hubUrl). Returns null when either side
// is malformed, so the caller can log and disable diagnostics instead of
// connecting somewhere bogus.
function resolveMcpHubUrl(path: string): string | null {
  return resolveRoomHubRelativeUrl(path);
}

// -----------------------------------------------------------------------------
// resolveRoomHubRelativeUrl — resolve a server-supplied path against the hub
// -----------------------------------------------------------------------------
// Several hub responses carry a PATH, not a full URL (mcpHubPath,
// GetPreviewUrl's "/nvx/preview", …); the real address is that path appended
// to the SignalR host (serial join 1's hubUrl — scheme/host/port, e.g.
// "http://172.16.17.15:6001" → "http://172.16.17.15:6001/nvx/preview").
// An absolute http(s) URL is passed through untouched. Returns null when the
// hub URL isn't known yet, the result isn't http(s), or the input is
// malformed, so callers can log and fall back instead of using garbage.
export function resolveRoomHubRelativeUrl(pathOrUrl: string): string | null {
  if (!roomHubUrl) return null;
  try {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const url = new URL(pathOrUrl, roomHubUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function isSourceArray(value: unknown): value is Array<Record<string, unknown>> {
  return (
    Array.isArray(value) &&
    value.every((s) => {
      if (typeof s !== 'object' || s === null) return false;
      const source = s as Record<string, unknown>;
      return typeof source.id === 'string' && typeof source.name === 'string';
    })
  );
}

// The wire is untrusted — an unrecognized `type` is downgraded to "other"
// rather than thrown away, so a server-side typo or a brand-new source type
// still shows up (with a generic icon) instead of silently vanishing.
function normalizeSource(raw: Record<string, unknown>): Source {
  const type = KNOWN_SOURCE_TYPES.includes(raw.type as SourceType)
    ? (raw.type as SourceType)
    : 'other';

  return {
    id: raw.id as string,
    name: raw.name as string,
    type,
    iconSvg: typeof raw.iconSvg === 'string' ? decodeBase64Svg(raw.iconSvg) : null
  };
}

function isLightLoadArray(value: unknown): value is Array<Record<string, unknown>> {
  return (
    Array.isArray(value) &&
    value.every((l) => {
      if (typeof l !== 'object' || l === null) return false;
      const load = l as Record<string, unknown>;
      return typeof load.id === 'string' && typeof load.name === 'string';
    })
  );
}

// The wire is untrusted — an invalid/missing `type` is coerced to "switch"
// (on/off) per product decision, rather than guessing "dimmer" for a load
// that might only be a relay. `positions` places this load's fixtures on
// the floor plan (see LightsInteractive.svelte) — any entry missing a
// numeric xPercent/yPercent is dropped rather than rendered in a bogus spot.
function normalizeLightLoad(raw: Record<string, unknown>): LightLoad {
  const type = raw.type === 'dimmer' || raw.type === 'switch' ? raw.type : 'switch';
  const positions = isPositionArray(raw.positions) ? raw.positions : [];

  return {
    id: raw.id as string,
    name: raw.name as string,
    type,
    iconSvg: typeof raw.iconSvg === 'string' ? decodeBase64Svg(raw.iconSvg) : null,
    positions
  };
}

function isShadeArray(value: unknown): value is Shade[] {
  return (
    Array.isArray(value) &&
    value.every((s) => {
      if (typeof s !== 'object' || s === null) return false;
      const shade = s as Record<string, unknown>;
      return (
        typeof shade.id === 'string' && shade.id.trim().length > 0 &&
        typeof shade.name === 'string' &&
        (shade.type === 'roller' || shade.type === 'curtain' || shade.type === 'venetian') &&
        (shade.supportsTilt === undefined || typeof shade.supportsTilt === 'boolean')
      );
    }) &&
    new Set(value.map((shade) => shade.id)).size === value.length
  );
}

function normalizeShade(raw: Shade): Shade {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    supportsTilt: raw.supportsTilt
  };
}

function isShadePresetArray(value: unknown): value is ShadePreset[] {
  return Array.isArray(value) && value.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const preset = entry as Record<string, unknown>;
    return typeof preset.id === 'string' && preset.id.trim().length > 0 &&
      typeof preset.name === 'string' && Array.isArray(preset.targets) &&
      preset.targets.every((target: unknown) => {
        if (!isShadePosition(target)) return false;
        const tiltPercent = (target as { tiltPercent?: unknown }).tiltPercent;
        return tiltPercent === undefined || tiltPercent === null ||
          isShadePosition({ shadeId: target.shadeId, positionPercent: tiltPercent });
      });
  }) && new Set(value.map((preset) => preset.id)).size === value.length;
}

function isPositionArray(value: unknown): value is LightLoadPosition[] {
  return (
    Array.isArray(value) &&
    value.every((p) => {
      if (typeof p !== 'object' || p === null) return false;
      const pos = p as Record<string, unknown>;
      return typeof pos.xPercent === 'number' && typeof pos.yPercent === 'number';
    })
  );
}

function isLightPresetArray(value: unknown): value is LightPreset[] {
  return (
    Array.isArray(value) &&
    value.every((p) => {
      if (typeof p !== 'object' || p === null) return false;
      const preset = p as Record<string, unknown>;
      return (
        typeof preset.id === 'string' &&
        typeof preset.name === 'string' &&
        Array.isArray(preset.levels)
      );
    })
  );
}

// -----------------------------------------------------------------------------
// tryStart — one attempt to call hub.start(), with retry on failure
// -----------------------------------------------------------------------------
// Reuses the same HubConnection instance every retry. This is important:
//   - avoids reallocating a WebSocket + event handlers each attempt,
//   - avoids double-firing lifecycle callbacks,
//   - lets withAutomaticReconnect take over cleanly the moment we succeed.
function tryStart(url: string): void {
  if (!hub) return;
  hub
    .start()
    .then(() => {
      appStatus.isConnected = true;
      console.log(`SignalR connected to ${url}.`);
      fetchRoomConfiguration();
      if (hub) {
        for (const callback of hubConnectedCallbacks) callback(hub);
      }
    })
    .catch((err) => {
      appStatus.isConnected = false;
      console.error(`SignalR connection to ${url} failed:`, err);
      scheduleColdRetry(url);
    });
}

function scheduleColdRetry(url: string): void {
  if (coldRetryTimer !== null) return; // already scheduled
  coldRetryTimer = setTimeout(() => {
    coldRetryTimer = null;
    tryStart(url);
  }, COLD_RETRY_MS);
}

// -----------------------------------------------------------------------------
// syncPage — outbound: tell the server the user picked a page
// -----------------------------------------------------------------------------
// Called by App / Header AFTER goTo() has already updated the local UI. The
// order matters: local first (instant response), network second (fire and
// forget). If the network call fails, we don't care — the local state is
// already correct and the next successful message will re-sync.
export function syncPage(key: PageKey): void {
  // Trace every outbound page-sync.
  console.log('[SignalR →] SetCurrentPage', key);

  // Optional-chaining: if `hub` is null (initSignalR hasn't run yet) this is
  // a no-op. That's exactly what we want in offline mode.
  hub?.invoke('SetCurrentPage', key).catch(() => {
    // Swallow. Reasons this can fail:
    //   - not yet connected  → automatic reconnect will heal it
    //   - hub method missing → wrong contract, dev-time issue
    // In either case, the local UI is already correct, so silence is safe.
  });
}

// -----------------------------------------------------------------------------
// onHubReady — domain transports register inbound handlers through this
// -----------------------------------------------------------------------------
// Usage from transport/lights.ts:
//
//   onHubReady((hub) => {
//   hub.on('LightLevelChanged', (lightId, levelPercent) => { ... });
//   });
//
// If initSignalR() has not run yet, the callback is queued and invoked as
// soon as the hub is built. If initSignalR() has ALREADY run (e.g., a page
// module was code-split and loaded later), the callback fires immediately
// with the live hub. Either way, the handler ends up wired exactly once.
export function onHubReady(register: (hub: signalR.HubConnection) => void): void {
  if (hub) {
    register(hub);
  } else {
    hubReadyCallbacks.push(register);
  }
}

export function onHubConnected(callback: (hub: signalR.HubConnection) => void): void {
  hubConnectedCallbacks.push(callback);
  if (hub && appStatus.isConnected) callback(hub);
}

// -----------------------------------------------------------------------------
// getHub — domain transports grab the live hub for outbound invokes
// -----------------------------------------------------------------------------
// Returns null when the connection has not been built yet, or has been torn
// down. Callers should treat null as "offline" and drop the command.
export function getHub(): signalR.HubConnection | null {
  return hub;
}
