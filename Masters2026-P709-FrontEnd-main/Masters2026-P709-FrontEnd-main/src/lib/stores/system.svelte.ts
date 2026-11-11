// -----------------------------------------------------------------------------
// system.svelte.ts — reactive state for system power
// -----------------------------------------------------------------------------
// Same role as stores/lights.svelte.ts: it only HOLDS state. It knows nothing
// about SignalR. The transport layer writes to it through
// applySystemState(); components read from `systemState` and re-render
// automatically (this file is `.svelte.ts` so the `$state` rune works).
//
// The four states mirror the SystemPowerState wire type:
//
//   off ──▶ starting ──▶ on ──▶ stopping ──▶ off
//
// "starting" and "stopping" are the in-between states. While they are active
// the UI shows a progress overlay and disables the power button.
//
// The UI starts in "off" (the Home page, normal shell). It only reports "on"
// when the server (which reflects the control system) confirms it, or shows
// progress while "starting"/"stopping" (see SystemPowerOverlay.svelte).
// -----------------------------------------------------------------------------

export type SystemState = 'off' | 'starting' | 'on' | 'stopping';

// Runtime check for text that arrives over the network. TypeScript types
// disappear at runtime, so we verify the value ourselves before trusting it.
export function isSystemState(value: unknown): value is SystemState {
  return (
    value === 'off' || value === 'starting' || value === 'on' || value === 'stopping'
  );
}

// Reactive state. Read it as `systemState.current` (do not destructure it, or
// the reactivity is lost; see the note in navigation.svelte.ts).
export const systemState = $state<{ current: SystemState }>({
  current: 'off'
});

// UI-only flag for the "Shut down?" confirmation dialog. It lives here so the
// power button (header) and the dialog (overlay) can share it without knowing
// about each other.
export const powerUi = $state<{ confirmOpen: boolean }>({
  confirmOpen: false
});

// True while the system is warming up or cooling down.
export function isTransitioning(): boolean {
  return systemState.current === 'starting' || systemState.current === 'stopping';
}

// The ONE way the transport writes into the store, the same idea as
// applyLightLevel() in lights.svelte.ts.
export function applySystemState(next: SystemState): void {
  systemState.current = next;
}
