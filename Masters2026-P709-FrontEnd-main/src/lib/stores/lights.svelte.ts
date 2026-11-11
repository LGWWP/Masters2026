// -----------------------------------------------------------------------------
// lights.svelte.ts — reactive state for the Lights page
// -----------------------------------------------------------------------------
// This file is the "model" for lighting. It knows nothing about SignalR or
// the Crestron backend. It just holds the numbers that any Lights UI wants
// to display.
//
// WHY IT LIVES IN /stores AND NOT /transport
//   Transport code (SignalR) changes when the backend changes.
//   Page components change when the design changes.
//   State is the stable middle layer that BOTH sides talk to — so it belongs
//   in its own file, imported by both sides but coupled to neither.
//
// WHY `.svelte.ts` (not `.ts`)
//   `$state(...)` is a Svelte 5 rune. The Svelte compiler only processes
//   `.svelte`, `.svelte.ts`, and `.svelte.js` files. A plain `.ts` file would
//   leave the rune unhandled and reactivity would silently break.
//
// PATTERN FOR ADDING A NEW DOMAIN (e.g. Shades)
//   1. Copy this file to `stores/shades.svelte.ts`.
//   2. Rename the exported `$state` object and update the shape.
//   3. Add a matching `transport/shades.ts` (see transport/lights.ts).
//   4. Import the new store in the new page component.
//   The existing signalr.svelte.ts and App.svelte need only ONE new line each.
// -----------------------------------------------------------------------------

// ── Load configuration ─────────────────────────────────────────────────────
// `id` is the resource identifier used on the wire (string), matching the
// unified API's lightId. `type` controls whether the card renders a dimmer
// slider or just a binary on/off toggle (relay / switched load). `positions`
// is where the server places this load's physical fixtures on the floor
// plan (percent coordinates, one entry per fixture) — see
// LightsInteractive.svelte, which renders one button per position instead of
// a hardcoded fixture layout.
export type LightLoadPosition = {
  xPercent: number;
  yPercent: number;
};

export type LightLoad = {
  id: string;
  name: string;
  type: 'dimmer' | 'switch';
  iconSvg?: string | null;
  positions: LightLoadPosition[];
};

// Like `lightPresets` and sources' `SOURCES` (see stores/sources.svelte.ts),
// the load catalogue is NOT hardcoded client-side config — it comes from the
// Crestron program's "GetRoomConfiguration" response. Empty until the first
// response arrives — see applyRoomConfiguration() in
// transport/signalr.svelte.ts, which calls applyLoads() below once per
// successful connect/reconnect.
export const LOADS = $state<LightLoad[]>([]);

// -----------------------------------------------------------------------------
// applyLoads — the ONE way the transport writes the load catalogue
// -----------------------------------------------------------------------------
// Called once per successful connect/reconnect, after "GetRoomConfiguration"
// resolves. Replaces the whole catalogue in place so the $state array stays
// reactive to anything iterating over it. Also seeds `lightsState.levels`
// with 0 for any newly-seen load so confirmedLevel()/displayLevel() lookups
// elsewhere have a value before the initial GetRoomState snapshot or the
// first "LightLevelChanged" echo arrives —
// without clobbering levels already known for loads that survive a
// reconnect.
export function applyLoads(loads: LightLoad[]): void {
  LOADS.splice(0, LOADS.length, ...loads);
  for (const load of loads) {
    if (!(load.id in lightsState.levels)) {
      lightsState.levels[load.id] = 0;
    }
  }
}

// ── Preset / scene configuration ───────────────────────────────────────────
// Unlike LOADS above, presets are NOT hardcoded client-side config. The
// catalogue of scenes (and their real ids) is owned by the Crestron program
// and comes back in the "GetRoomConfiguration" response — see
// applyRoomConfiguration() in transport/signalr.svelte.ts, which calls
// applyLightPresets() below once per successful connect/reconnect.
//
// `id` is the string scene identifier sent to the processor via
// "SelectPreset" — the processor fires its own preset macro and echoes back
// which preset won via "PresetSelected" (see transport/lights.ts). `levels`
// mirrors the server's own per-light targets for display only; it does not
// drive what the server actually sets.
export type LightPresetLevel = {
  lightId: string;
  levelPercent: number;
};

export type LightPreset = {
  id: string;
  name: string;
  levels: LightPresetLevel[];
};

// Empty until the first "GetRoomConfiguration" response arrives.
export const lightPresets = $state<LightPreset[]>([]);

// ── Per-light runtime state ─────────────────────────────────────────────────
// One entry per lighting resource, keyed by lightId. The C# backend
// broadcasts confirmed levels back to every panel; the transport layer
// writes them here. Pages then re-render automatically because they read
// from `lightsState`.
//
// `lastUpdatedLightId` is optional but handy for debugging and for pulse /
// flash animations that want to know "which light just changed?".
//
// `activePresetId` mirrors the server's own notion of which preset (if any)
// is currently selected — it is NOT derived from comparing light levels on
// the client. The processor fires its own preset macro and echoes back which
// preset id won, via "PresetSelected" (see transport/lights.ts).
export const lightsState = $state<{
  levels: Record<string, number>;
  lastUpdatedLightId: string | null;
  activePresetId: string | null;
}>({
  levels: {},
  lastUpdatedLightId: null,
  activePresetId: null
});

// -----------------------------------------------------------------------------
// applyLightLevel — the ONE way the transport writes into lightsState
// -----------------------------------------------------------------------------
// The SignalR handler calls this. Centralising the write keeps validation in
// one place and makes it trivial to add features later (e.g. persist to
// localStorage, emit an animation trigger, log to a diagnostics buffer).
//
// Unlike the old hardcoded LOADS, the known-ids catalogue now arrives from
// the server itself and may not have loaded yet when the very first
// "LightLevelChanged" echo comes in (e.g. a reconnect race). So this only
// *warns* about an id missing from LOADS instead of dropping the update —
// once LOADS has loaded, an id it doesn't recognize is a real server bug
// worth flagging; before that, it's just normal startup ordering.
export function applyLightLevel(lightId: string, levelPercent: number): void {
  if (LOADS.length > 0 && !LOADS.some((load) => load.id === lightId)) {
    console.warn(`lightsState: unknown lightId ${lightId}`);
  }
  lightsState.levels[lightId] = levelPercent;
  lightsState.lastUpdatedLightId = lightId;
}

// -----------------------------------------------------------------------------
// applyPresetSelected — the ONE way the transport writes the active preset
// -----------------------------------------------------------------------------
// Called from the "PresetSelected" echo (see transport/lights.ts).
export function applyPresetSelected(presetId: string): void {
  lightsState.activePresetId = presetId;
}

// -----------------------------------------------------------------------------
// applyLightPresets — the ONE way the transport writes the preset catalogue
// -----------------------------------------------------------------------------
// Called once per successful connect/reconnect, after "GetRoomConfiguration"
// resolves (see transport/signalr.svelte.ts). Replaces the whole catalogue in
// place so the $state array stays reactive to anything iterating over it.
export function applyLightPresets(presets: LightPreset[]): void {
  lightPresets.splice(0, lightPresets.length, ...presets);
}
