// -----------------------------------------------------------------------------
// system.ts — transport for the system power domain
// -----------------------------------------------------------------------------
// Follows the same two-part pattern as transport/lights.ts:
//   1. Register the inbound hub handler (server -> UI).
//   2. Expose the outbound command the UI calls (setSystemPower).
//
// This file owns no state (see stores/system.svelte.ts) and no connection
// logic (see signalr.svelte.ts). It is imported once, for its side effects,
// from App.svelte so the handler is registered before the hub is built.
// -----------------------------------------------------------------------------

import { onHubReady, getHub } from './signalr.svelte';
import { applySystemState, isSystemState } from '../stores/system.svelte';
import { clearCurrentSource } from '../stores/sources.svelte';

// TODO: UI Lab 1.5b - Hook up system power changes 
// Hint: We need to react to 'SystemPowerStateChanged' messages from the hub.
// UI Lab 1.5b - End
// REF UI Lab 1.5b
// Inbound. Contract with the C# hub (RoomHub):
//   Clients.All.SendAsync("SystemPowerStateChanged", "off" | "starting" | "on" | "stopping")
// The server also sends this once when a panel connects, so the UI starts in
// the correct state.
onHubReady((hub) => {
  hub.on('SystemPowerStateChanged', (state: unknown) => {
    console.log('[SignalR ←] SystemPowerStateChanged', state);

    // The wire is untrusted: ignore anything that is not a known state.
    if (!isSystemState(state)) {
      console.warn('SignalR: bad SystemPowerStateChanged payload', state);
      return;
    }

    applySystemState(state);

    // When the system goes fully off, the previously selected source is no
    // longer meaningful (the server will send a fresh "SelectedSourceChanged"
    // once a source is chosen again) — clear it so the Sources page doesn't
    // show a stale selection.
    if (state === 'off') {
      clearCurrentSource();
    }
  });
});
// REF UI Lab 1.5b - End

// Outbound. As with setLight(), the UI does NOT change its state here. It
// waits for the "SystemPowerStateChanged" echo from the server.
export function setSystemPower(isOn: boolean): void {
  console.log('[System →] setSystemPower', { isOn });

  const hub = getHub();

  if (!hub) {
    console.warn('setSystemPower: no hub connection, command dropped', { isOn });
    return;
  }

  hub.invoke('SetSystemPower', isOn).catch((err) => {
    console.warn('setSystemPower invoke failed', err);
  });
}
