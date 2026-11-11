// -----------------------------------------------------------------------------
// shades.ts — transport for the Shades/Blinds domain
// -----------------------------------------------------------------------------
// This is the ONLY file that sends shade commands to the Crestron backend.
// Pages call setShadePosition(), setShadeTilt(), or selectShadePreset() and
// leave the SignalR contract here — the same boundary as transport/lights.ts.
//
// This module has three responsibilities:
//   1. Register inbound handlers before the hub starts.
//   2. Fetch confirmed state on each connect/reconnect, without overwriting
//      newer broadcasts that arrive while the snapshot is in flight.
//   3. Expose outbound commands whose failures can be handled by the UI.
//
// This file owns NO reactive state. State lives in stores/shades.svelte.ts.
// This file owns NO connection lifecycle. That lives in signalr.svelte.ts,
// which also loads the shade/preset catalogues from GetRoomConfiguration.
// Tilt and preset methods/events are optional server extensions; position
// control is the base Blinds contract.
// -----------------------------------------------------------------------------

import { onHubReady, onHubConnected, getHub } from "./signalr.svelte";
import {
  applyShadePosition,
  isShadePosition,
  applyShadeTilt,
  applyShadePresetSelected,
} from "../stores/shades.svelte";

// -----------------------------------------------------------------------------
// Snapshot ordering — private counters, not UI state
// -----------------------------------------------------------------------------
// A broadcast received during GetRoomState is newer than the snapshot.
// Keep separate revision counters for each shade's position and tilt, plus
// one for the active preset. A snapshot may write a value only if that
// value's counter has not changed since the request began.
//
// snapshotRequest also makes the latest snapshot request win if another
// connection triggers GetRoomState before the previous call has settled.
const revisions = new Map<string, number>();
const tiltRevisions = new Map<string, number>();
let presetRevision = 0;
let snapshotRequest = 0;

// -----------------------------------------------------------------------------
// Inbound registration
// -----------------------------------------------------------------------------
// onHubReady runs when initSignalR() builds the hub, BEFORE hub.start(), or
// immediately if the hub already exists. Either way, these handlers do not
// need to be registered again on reconnect.
onHubReady((hub) => {
  // Optional server extension:
  //   "ShadeTiltChanged", shadeId, tiltPercent
  // Reuse the position validator because both values require a non-empty
  // resource id and an integer percentage in 0..100. Only the wire field
  // name differs; the store still receives this as tilt, not position.
  hub.on("ShadeTiltChanged", (shadeId: unknown, tiltPercent: unknown) => {
    console.log("[SignalR ←] ShadeTiltChanged", { shadeId, tiltPercent });
    const tilt = { shadeId, positionPercent: tiltPercent };
    if (!isShadePosition(tilt)) {
      console.warn("SignalR: bad ShadeTiltChanged payload", {
        shadeId,
        tiltPercent,
      });
      return;
    }
    tiltRevisions.set(tilt.shadeId, (tiltRevisions.get(tilt.shadeId) ?? 0) + 1);
    applyShadeTilt(tilt.shadeId, tilt.positionPercent);
  });
  // Optional server extension:
  //   "ShadePresetSelected", presetId
  // A non-empty string selects a preset; null clears the selection. Like
  // lighting presets, the UI waits for server feedback rather than marking
  // the button active as soon as the command is sent.
  hub.on("ShadePresetSelected", (presetId: unknown) => {
    console.log("[SignalR ←] ShadePresetSelected", { presetId });
    if (
      presetId !== null &&
      (typeof presetId !== "string" || presetId.trim().length === 0)
    ) {
      console.warn("SignalR: bad ShadePresetSelected payload", presetId);
      return;
    }
    presetRevision += 1;
    applyShadePresetSelected(presetId);
  });
  // Base Blinds contract:
  //   "ShadePositionChanged", shadeId, positionPercent
  // The wire is untrusted — reject invalid ids, fractions, and values
  // outside 0..100 before advancing the revision or touching the store.
  hub.on(
    "ShadePositionChanged",
    (shadeId: unknown, positionPercent: unknown) => {
      console.log("[SignalR ←] ShadePositionChanged", { shadeId, positionPercent });
      const position = { shadeId, positionPercent };
      if (!isShadePosition(position)) {
        console.warn("SignalR: bad ShadePositionChanged payload", position);
        return;
      }
      revisions.set(
        position.shadeId,
        (revisions.get(position.shadeId) ?? 0) + 1,
      );
      applyShadePosition(position.shadeId, position.positionPercent);
    },
  );
});

// -----------------------------------------------------------------------------
// Inbound snapshot — restore confirmed state on connect/reconnect
// -----------------------------------------------------------------------------
// onHubConnected runs after every successful connection, and immediately
// if this module loads while already connected. GetRoomState returns its
// snapshot directly from invoke(); it is not a separate broadcast event.
//
// Capture revisions BEFORE invoking so a broadcast received during the
// request always takes precedence over the corresponding snapshot value.
onHubConnected((hub) => {
  const requestedRevisions = new Map(revisions);
  const requestedTiltRevisions = new Map(tiltRevisions);
  const requestedPresetRevision = presetRevision;
  const request = ++snapshotRequest;
  hub
    .invoke("GetRoomState")
    .then((snapshot: unknown) => {
      // A later connect/reconnect has already requested a newer snapshot.
      if (request !== snapshotRequest) return;
      const positions =
        typeof snapshot === "object" && snapshot !== null
          ? (snapshot as Record<string, unknown>).shadePositions
          : undefined;
      // shadePositions is required. Validate the whole array, including
      // unique ids, before applying any part of this snapshot.
      if (
        !Array.isArray(positions) ||
        !positions.every(isShadePosition) ||
        new Set(positions.map((position) => position.shadeId)).size !==
          positions.length
      ) {
        console.warn(
          "SignalR: bad GetRoomState shadePositions payload",
          positions,
        );
        return;
      }
      // One changed shade does not invalidate the others: compare counters
      // per id and keep any position already updated by a newer broadcast.
      for (const position of positions) {
        if (
          revisions.get(position.shadeId) ===
          requestedRevisions.get(position.shadeId)
        ) {
          applyShadePosition(position.shadeId, position.positionPercent);
        }
      }
      // Older servers may omit these optional extensions. Missing fields
      // leave existing values alone; invalid extensions are warned about
      // independently, after the required positions have been applied.
      const extensions = snapshot as Record<string, unknown>;
      if (extensions.shadeTilts !== undefined) {
        const tilts = extensions.shadeTilts;
        if (!Array.isArray(tilts) || !tilts.every(isShadeTilt)) {
          console.warn("SignalR: bad GetRoomState shadeTilts payload", tilts);
        } else {
          for (const tilt of tilts) {
            if (
              tiltRevisions.get(tilt.shadeId) ===
              requestedTiltRevisions.get(tilt.shadeId)
            ) {
              applyShadeTilt(tilt.shadeId, tilt.tiltPercent);
            }
          }
        }
      }
      // undefined means the server did not provide preset state. null is
      // an explicit instruction to clear it, subject to the same revision
      // check that protects positions and tilts from stale snapshots.
      const presetId = extensions.activeShadePresetId;
      if (presetId !== undefined) {
        if (
          presetId !== null &&
          (typeof presetId !== "string" || !presetId.trim())
        ) {
          console.warn(
            "SignalR: bad GetRoomState activeShadePresetId payload",
            presetId,
          );
        } else if (presetRevision === requestedPresetRevision) {
          applyShadePresetSelected(presetId);
        }
      }
    })
    .catch((err) => {
      console.warn("GetRoomState invoke failed", err);
    });
});

// -----------------------------------------------------------------------------
// Validation — adapt the optional tilt shape to the shared percentage rules
// -----------------------------------------------------------------------------
// Used for GetRoomState.shadeTilts entries. Mapping tiltPercent to the
// validator's positionPercent field keeps inbound and outbound range/id
// checks consistent without changing the actual server payload.
function isShadeTilt(
  value: unknown,
): value is { shadeId: string; tiltPercent: number } {
  if (typeof value !== "object" || value === null) return false;
  const tilt = value as Record<string, unknown>;
  return isShadePosition({
    shadeId: tilt.shadeId,
    positionPercent: tilt.tiltPercent,
  });
}

// -----------------------------------------------------------------------------
// Outbound: setShadePosition — move one shade
// -----------------------------------------------------------------------------
// Params: shadeId (non-empty resource identifier), positionPercent (integer
// 0..100). The hub takes positional arguments:
//   invoke("SetShadePosition", shadeId, positionPercent)
//
// Design notes:
//   * Do NOT update shadesState here. Confirmed position comes back through
//     "ShadePositionChanged" or the next GetRoomState snapshot.
//   * Unlike lights.ts's fire-and-forget helpers, this returns a Promise.
//     Bad input, a missing hub, or a rejected invoke rejects the Promise so
//     the caller can show a failure. A built but disconnected hub fails
//     through invoke(), rather than the null guard.
export async function setShadePosition(
  shadeId: string,
  positionPercent: number,
): Promise<void> {
  console.log("[Shades →] setShadePosition", { shadeId, positionPercent });
  if (!isShadePosition({ shadeId, positionPercent })) {
    const error = new Error(
      "Shade position requires a non-empty id and an integer from 0 to 100.",
    );
    console.warn("setShadePosition: invalid command", {
      shadeId,
      positionPercent,
    });
    throw error;
  }

  const hub = getHub();
  if (!hub) {
    const error = new Error("Blinds are offline. Reconnect and try again.");
    console.warn("setShadePosition: no hub connection", {
      shadeId,
      positionPercent,
    });
    throw error;
  }
  try {
    console.log("[SignalR →]", "SetShadePosition", [shadeId, positionPercent]);
    await hub.invoke("SetShadePosition", shadeId, positionPercent);
  } catch (err) {
    console.warn("setShadePosition invoke failed", err);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Outbound: setShadeTilt — optional tilt control
// -----------------------------------------------------------------------------
// Params: shadeId (non-empty resource identifier), tiltPercent (integer
// 0..100). Uses positional arguments, just like SetShadePosition:
//   invoke("SetShadeTilt", shadeId, tiltPercent)
//
// The UI decides whether to offer tilt from the shade's configuration.
// This helper validates the id/percentage and lets the server accept or
// reject the extension. Confirmation arrives via "ShadeTiltChanged" or a
// snapshot; the command itself never writes a confirmed value to the store.
export async function setShadeTilt(
  shadeId: string,
  tiltPercent: number,
): Promise<void> {
  console.log("[Shades →] setShadeTilt", { shadeId, tiltPercent });
  if (!isShadePosition({ shadeId, positionPercent: tiltPercent })) {
    console.warn("setShadeTilt: invalid command", { shadeId, tiltPercent });
    throw new Error(
      "Shade tilt requires a non-empty id and an integer from 0 to 100.",
    );
  }
  await invokeExtension("SetShadeTilt", shadeId, tiltPercent);
}

// -----------------------------------------------------------------------------
// Outbound: selectShadePreset — optional server-owned scene
// -----------------------------------------------------------------------------
// Params: presetId (non-empty scene identifier).
// The hub takes a request object, not a positional string:
//   invoke("SelectShadePreset", { presetId })
//
// The processor owns the scene targets. We neither move shades locally nor
// select the active preset here; its broadcasts/snapshot supply that state.
// Validation and invoke failures reject the returned Promise for the UI.
export async function selectShadePreset(presetId: string): Promise<void> {
  console.log("[Shades →] selectShadePreset", { presetId });
  if (!presetId.trim()) {
    console.warn("selectShadePreset: invalid preset id", presetId);
    throw new Error("A preset id is required.");
  }
  await invokeExtension("SelectShadePreset", { presetId });
}

// -----------------------------------------------------------------------------
// Shared invoke — optional commands use the same logging and error path
// -----------------------------------------------------------------------------
// Keep args variadic so tilt can pass positional values while presets pass
// a single request object. Nothing is queued or retried here. Missing hubs
// throw, and invoke errors (including unsupported methods) are logged and
// rethrown so callers retain the original failure.
async function invokeExtension(
  method: string,
  ...args: unknown[]
): Promise<void> {
  const hub = getHub();
  if (!hub) {
    console.warn(`${method}: no hub connection`);
    throw new Error("Blinds are offline. Reconnect and try again.");
  }
  try {
    console.log("[SignalR →]", method, args);
    await hub.invoke(method, ...args);
  } catch (err) {
    console.warn(`${method} invoke failed`, err);
    throw err;
  }
}
