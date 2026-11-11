// -----------------------------------------------------------------------------
// connection.svelte.ts — reactive state for the CIP/WS bridge transports
// -----------------------------------------------------------------------------
// Same role as stores/system.svelte.ts: this file only HOLDS state. It is
// written to by crestron/xpanel.ts (which owns the WebXPanel/CIP wiring) and
// read by Header.svelte to light up the status dot alongside
// transport/signalr.svelte.ts's `appStatus` (the SignalR link).
//
// `null` means "not applicable in this run mode" rather than "down" — e.g.
// WS is managed entirely by a Crestron touchscreen's native container app
// when embedded there, so xpanel.ts never tracks it in that environment.
// -----------------------------------------------------------------------------

export const bridgeStatus = $state<{ cip: boolean | null; ws: boolean | null }>({
  cip: null,
  ws: null
});

export function setCipConnected(connected: boolean): void {
  bridgeStatus.cip = connected;
}

export function setWsConnected(connected: boolean): void {
  bridgeStatus.ws = connected;
}
