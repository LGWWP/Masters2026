// -----------------------------------------------------------------------------
// lights.ts — transport for the Lights domain
// -----------------------------------------------------------------------------
// This is the ONLY file that talks to the Crestron backend for the Lights
// domain — every page just calls `setLight()` and stays blissfully unaware.
//
// PATTERN — copy this file when you add Shades, Sources, Climate, etc.
// This module has three responsibilities:
//   1. Register inbound hub handlers when the SignalR connection is built.
//   2. Request current load levels after every connect/reconnect.
//   3. Expose outbound command functions the UI calls (`setLight`, `selectPreset`).
//
// This file owns NO reactive state. State lives in stores/lights.svelte.ts.
// This file owns NO connection lifecycle. That lives in signalr.svelte.ts.
// Keep those boundaries and each new domain becomes a straight copy-paste.
// -----------------------------------------------------------------------------

import { onHubReady, onHubConnected, getHub } from './signalr.svelte';
import { applyLightLevel, applyPresetSelected } from '../stores/lights.svelte';

// A broadcast received while GetRoomState is pending takes precedence over
// that light's snapshot value. A later connection also supersedes any
// snapshot still pending from an earlier connection.
const revisions = new Map<string, number>();
let snapshotRequest = 0;

// -----------------------------------------------------------------------------
// Inbound registration
// -----------------------------------------------------------------------------
// onHubReady queues this callback so it runs the moment initSignalR() builds
// the HubConnection — BEFORE hub.start() is called. Registering handlers
// before start() means SignalR won't drop the very first inbound message
// while our .on() call is still pending.
//
// If initSignalR has ALREADY run by the time this module loads (e.g. we
// dynamically import a page after boot), onHubReady invokes the callback
// immediately with the existing hub. Either way, the handler ends up wired.
onHubReady((hub) => {
  // Contract with the C# hub (RoomHub.SetLightLevel):
  //   Clients.All.SendAsync("LightLevelChanged", lightId, levelPercent)
  // where lightId is a string resource identifier and levelPercent is 0..100.
  //
  // Every panel receives this — including the one that just invoked
  // SetLightLevel. That is the point: the UI does NOT update its readout on
  // click; it waits for this echo. If the server never confirms, the number
  // never moves and you know something is broken end-to-end.
  hub.on('LightLevelChanged', (lightId: unknown, levelPercent: unknown) => {
    console.log('[SignalR ←] LightLevelChanged', { lightId, levelPercent });

    // The wire is untrusted — a future server bug could send garbage, and
    // silent NaN in the UI is worse than a warning.
    const level = { lightId, levelPercent };
    if (!isLightLevel(level)) {
      console.warn('SignalR: bad LightLevelChanged payload', lightId, levelPercent);
      return;
    }

    // Delegate the actual write to the store, through the same
    // applyLightLevel() every inbound handler uses, so any validation or
    // animation trigger added later applies consistently.
    revisions.set(level.lightId, (revisions.get(level.lightId) ?? 0) + 1);
    applyLightLevel(level.lightId, level.levelPercent);
  });

  // Contract with the C# hub (RoomHub.SelectPreset):
  //   Clients.All.SendAsync("PresetSelected", presetId)
  //
  // Same round-trip pattern as "LightLevelChanged": the UI does not mark a
  // preset button active on click, it waits for this echo. The processor
  // fires its own preset macro (which in turn drives the individual
  // LightLevelChanged broadcasts for each load).
  hub.on('PresetSelected', (presetId: string) => {
    console.log('[SignalR ←] PresetSelected', { presetId });

    if (typeof presetId !== 'string') {
      console.warn('SignalR: bad PresetSelected payload', presetId);
      return;
    }

    applyPresetSelected(presetId);
  });
});

// -----------------------------------------------------------------------------
// Initial levels — GetRoomConfiguration describes loads, not their state
// -----------------------------------------------------------------------------
// Request confirmed levels on connect/reconnect instead of waiting for the
// next LightLevelChanged broadcast. The catalogue can arrive before or
// after this snapshot: applyLoads preserves any levels already received.
onHubConnected((hub) => {
  const requestedRevisions = new Map(revisions);
  const request = ++snapshotRequest;
  hub
    .invoke('GetRoomState')
    .then((snapshot: unknown) => {
      if (request !== snapshotRequest) return;

      const levels =
        typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
          ? (snapshot as Record<string, unknown>).lightLevels
          : undefined;

      // Validate every entry and reject duplicate ids before writing any
      // levels, so a malformed snapshot cannot partially update the UI.
      if (
        !Array.isArray(levels) ||
        !levels.every(isLightLevel) ||
        new Set(levels.map((level) => level.lightId)).size !== levels.length
      ) {
        console.warn('SignalR: bad GetRoomState lightLevels payload', levels);
        return;
      }

      for (const level of levels) {
        if (revisions.get(level.lightId) === requestedRevisions.get(level.lightId)) {
          applyLightLevel(level.lightId, level.levelPercent);
        }
      }
    })
    .catch((err) => {
      console.warn('GetRoomState lightLevels invoke failed', err);
    });
});

function isLightLevel(value: unknown): value is { lightId: string; levelPercent: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const level = value as Record<string, unknown>;
  return (
    typeof level.lightId === 'string' &&
    level.lightId.trim().length > 0 &&
    typeof level.levelPercent === 'number' &&
    Number.isInteger(level.levelPercent) &&
    level.levelPercent >= 0 &&
    level.levelPercent <= 100
  );
}

// -----------------------------------------------------------------------------
// Outbound: setLight — the one function pages call
// -----------------------------------------------------------------------------
// Params: lightId (string resource identifier), levelPercent 0..100.
//
// Design notes:
//   * We do NOT update lightsState directly here. The whole point of the
//     round-trip pattern is that state changes come back from the server via
//     the "LightLevelChanged" echo. That keeps the UI honest about what it's
//     showing.
//   * If there is no live hub (not connected / not built yet), the command is
//     dropped and a warning is logged — there is nothing to invoke on.
export function setLight(lightId: string, levelPercent: number): void {
  console.log('[Lights →] setLight', { lightId, levelPercent });

  const hub = getHub();

  if (!hub) {
    console.warn('setLight: no hub connection, command dropped', { lightId, levelPercent });
    return;
  }

  hub.invoke('SetLightLevel', lightId, levelPercent).catch((err) => {
    console.warn('setLight invoke failed', err);
  });
}

// -----------------------------------------------------------------------------
// Outbound: selectPreset — the one function pages call to fire a lighting scene
// -----------------------------------------------------------------------------
// Params: presetId (string scene identifier, see stores/lights.svelte lightPresets).
//
// Design notes:
//   * The hub method takes a single request object, not a positional string:
//       invoke("SelectPreset", { presetId: "on" })
//   * We do NOT update lightsState.activePresetId directly here. The
//     processor runs its own preset macro and echoes back which preset won
//     via "PresetSelected" — the same honesty principle as setLight().
//   * If there is no live hub (not connected / not built yet), the command is
//     dropped and a warning is logged — there is nothing to invoke on.
export function selectPreset(presetId: string): void {
  console.log('[Lights →] selectPreset', { presetId });

  const hub = getHub();

  if (!hub) {
    console.warn('selectPreset: no hub connection, command dropped', { presetId });
    return;
  }

  hub.invoke('SelectPreset', { presetId }).catch((err) => {
    console.warn('selectPreset invoke failed', err);
  });
}
