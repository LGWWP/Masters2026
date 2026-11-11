// -----------------------------------------------------------------------------
// sources.ts — transport for the Sources domain
// -----------------------------------------------------------------------------
// This is the ONLY file that talks to the Crestron backend for the Sources
// domain — the Sources page just calls `setSource()` and stays blissfully
// unaware.
//
// This file owns NO reactive state. State lives in stores/sources.svelte.ts.
// This file owns NO connection lifecycle. That lives in signalr.svelte.ts.
//
// IMPORTANT — starting the system is the SERVER's job, not this file's:
//   If the system is off, tapping a source still just calls setSource(id).
//   The server is responsible for starting the system first (if needed) and
//   then confirming the new source. The client never infers or sets system
//   state locally; it only reacts to the server's own
//   "SelectedSourceChanged"/"SystemPowerStateChanged" broadcasts (see
//   transport/system.ts and stores/system.svelte.ts).
// -----------------------------------------------------------------------------

import { onHubReady, onHubConnected, getHub, resolveRoomHubRelativeUrl } from './signalr.svelte';
import {
  applyCurrentSource,
  applyDisplayPreviewUrl,
  applyStreamRunning,
  getCurrentSourceRevision
} from '../stores/sources.svelte';

let snapshotRequest = 0;

// -----------------------------------------------------------------------------
// Inbound registration
// -----------------------------------------------------------------------------
// onHubReady queues this callback so it runs the moment initSignalR() builds
// the HubConnection — BEFORE hub.start() is called. Registering handlers
// before start() means SignalR won't drop the very first inbound message
// while our .on() call is still pending.
onHubReady((hub) => {
  // Contract with the C# hub (RoomHub.SelectSource):
  //   Clients.All.SendAsync("SelectedSourceChanged", sourceId)
  //
  // Every panel receives this — including the one that just invoked
  // SelectSource. The UI does NOT update its selection on tap; it waits for
  // this echo, the same round-trip pattern used by every other domain here.
  hub.on('SelectedSourceChanged', (sourceId: unknown) => {
    console.log('[SignalR ←] SelectedSourceChanged', { sourceId });

    // The wire is untrusted — a future server bug could send garbage, and
    // silent NaN in the UI is worse than a warning.
    if (!isSourceSelection(sourceId)) {
      console.warn('SignalR: bad SelectedSourceChanged payload', sourceId);
      return;
    }

    applyCurrentSource(sourceId);
  });

  // NVX source routing and SetStreamRunning broadcast the receiver's stream
  // status separately from the selected source. Stopping the stream keeps
  // that source selected.
  hub.on('StreamRunningChanged', (isRunning: unknown) => {
    console.log('[SignalR ←] StreamRunningChanged', { isRunning });

    if (typeof isRunning !== 'boolean') {
      console.warn('SignalR: bad StreamRunningChanged payload', isRunning);
      return;
    }

    applyStreamRunning(isRunning);
  });
});

// -----------------------------------------------------------------------------
// Current source — restore confirmed selection on connect/reconnect
// -----------------------------------------------------------------------------
// GetRoomConfiguration supplies the source catalogue; GetRoomState supplies
// the selectedSourceId (null when none). A newer broadcast or power-off
// clear wins over a pending snapshot, and a reconnect supersedes older queries.
onHubConnected((hub) => {
  const requestedRevision = getCurrentSourceRevision();
  const request = ++snapshotRequest;
  hub
    .invoke('GetRoomState')
    .then((snapshot: unknown) => {
      if (request !== snapshotRequest) return;

      const sourceId =
        typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
          ? (snapshot as Record<string, unknown>).selectedSourceId
          : undefined;

      if (!isSourceSelection(sourceId)) {
        console.warn('SignalR: bad GetRoomState selectedSourceId payload', sourceId);
        return;
      }

      if (getCurrentSourceRevision() === requestedRevision) {
        applyCurrentSource(sourceId);
      }
    })
    .catch((err) => {
      console.warn('GetRoomState selectedSourceId invoke failed', err);
    });
});

function isSourceSelection(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim().length > 0);
}

// -----------------------------------------------------------------------------
// Display preview URL — request/response query, fired once per connect
// -----------------------------------------------------------------------------
// Contract with the C# hub (RoomHub.GetPreviewUrl): a plain invoke whose
// return value is the PATH of the preview image for the room's display
// output (for example "/nvx/preview"), or null/empty when the room has none.
// The path is appended to the SignalR host address (scheme/host/port of
// serial join 1's hubUrl, e.g. "http://172.16.17.15:6001" →
// "http://172.16.17.15:6001/nvx/preview"). The Sources page re-fetches the
// image itself (on source change and every 5 seconds) via a cache-busting
// query param — only the base URL lives here. Unlike the catalogues above it
// is NOT part of GetRoomConfiguration, so it is fetched here, once per
// successful connect/reconnect — onHubConnected fires on both. A missing or
// invalid URL clears the store so the UI cannot keep showing an old stream.
onHubConnected((hub) => {
  hub
    .invoke('GetPreviewUrl')
    .then((url: unknown) => {
      console.log('[SignalR ←] GetPreviewUrl', url);

      const normalized = normalizeDisplayPreviewUrl(url);
      applyDisplayPreviewUrl(normalized);

      // Warn only for genuinely malformed payloads — null/empty just means
      // "this room has no preview feed" and is applied silently above.
      if (normalized === null && url !== undefined && url !== null &&
        !(typeof url === 'string' && url.trim() === '')) {
        console.warn('SignalR: bad GetPreviewUrl payload', url);
      }
    })
    .catch((err) => {
      console.warn('GetPreviewUrl invoke failed', err);
    });
});

// The wire is untrusted — accept only a non-empty string, resolved against
// the room hub's host (an absolute http(s) URL passes through untouched);
// anything else becomes null (no preview).
function normalizeDisplayPreviewUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return resolveRoomHubRelativeUrl(value.trim());
}

// -----------------------------------------------------------------------------
// Outbound: setSource — the one function the Sources page calls
// -----------------------------------------------------------------------------
// Design notes:
//   * We do NOT update sourcesState directly here. State changes come back
//     from the server via the "SelectedSourceChanged" echo, the same honesty
//     principle used by setLight/setVolume/setSystemPower.
//   * No branching on system state: if the system is off, the server starts
//     it and then confirms the source. The overlay that shows "Starting
//     up…" already reacts to systemState.current on its own (see
//     SystemPowerOverlay.svelte) — nothing here needs to trigger it.
//   * If there is no live hub (not connected / not built yet), the command is
//     dropped and a warning is logged — there is nothing to invoke on.
export function setSource(sourceId: string): void {
  console.log('[Sources →] setSource', { sourceId });

  const hub = getHub();

  if (!hub) {
    console.warn('setSource: no hub connection, command dropped', { sourceId });
    return;
  }

  hub.invoke('SelectSource', sourceId).catch((err) => {
    console.warn('setSource invoke failed', err);
  });
}
