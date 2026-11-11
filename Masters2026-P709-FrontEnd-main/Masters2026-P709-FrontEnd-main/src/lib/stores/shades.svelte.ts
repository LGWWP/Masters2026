// -----------------------------------------------------------------------------
// shades.svelte.ts — reactive state for the Shades/Blinds page
// -----------------------------------------------------------------------------
// This file is the "model" for shades. It knows nothing about SignalR or the
// Crestron backend. It just holds configuration and runtime values that any
// Shades UI wants to display.
//
// WHY IT LIVES IN /stores AND NOT /transport
//   Transport code owns hub methods, broadcasts, and snapshot ordering.
//   Page components own layout, slider drafts, and command feedback.
//   This store is the stable middle layer that BOTH sides import — the
//   transport applies confirmed values here, and the page reacts to them.
//
// WHY `.svelte.ts` (not `.ts`)
//   `$state(...)` is a Svelte 5 rune. The Svelte compiler processes runes in
//   `.svelte`, `.svelte.ts`, and `.svelte.js` files. This extension lets the
//   catalogues and runtime values stay reactive outside a page component.
//
// SAME PATTERN AS stores/lights.svelte.ts
//   Configuration describes what exists; runtime state records feedback.
//   Exported apply...() functions centralise writes from the transport.
//   Sending a command does NOT change confirmed state here — updates arrive
//   through transport/shades.ts's broadcasts or GetRoomState snapshot.
// -----------------------------------------------------------------------------

// ── Shade configuration ────────────────────────────────────────────────────
// `id` is the string resource identifier sent as shadeId on the wire. `name`
// is the display label, and `type` lets the UI choose shade/curtain labels
// and preview artwork. Tilt is offered only when supportsTilt is true; the
// type alone does not enable it (see components/pages/Shades.svelte).
export type ShadeType = "roller" | "curtain" | "venetian";

export type Shade = {
  id: string;
  name: string;
  type: ShadeType;
  supportsTilt?: boolean;
};

// ── Position feedback / target shape ───────────────────────────────────────
// Shared by runtime snapshots, preset targets, and validation of commands
// and broadcasts. positionPercent is an integer from 0 (closed) to 100
// (open); shadeId identifies the individual resource, not a group of shades.
export type ShadePosition = {
  shadeId: string;
  positionPercent: number;
};

// ── Preset / scene configuration ───────────────────────────────────────────
// Optional server extensions; not part of the base Blinds contract.
// The catalogue arrives as GetRoomConfiguration.shadePresets. `id` is sent
// to SelectShadePreset; `targets` describes the scene's position targets and
// optional tilt values (which may be absent or null).
//
// The processor owns scene execution. The UI sends the preset id instead
// of looping over these targets and issuing its own movement commands.
export type ShadePresetTarget = ShadePosition & { tiltPercent?: number | null };
export type ShadePreset = {
  id: string;
  name: string;
  targets: ShadePresetTarget[];
};

// Like lights' LOADS and lightPresets, these catalogues are NOT hardcoded
// client-side config. Both start empty and are populated by
// applyRoomConfiguration() in transport/signalr.svelte.ts after each
// successful connect/reconnect. Omitted shades/shadePresets fields clear
// the corresponding catalogue through applyShades()/applyShadePresets().
export const SHADES = $state<Shade[]>([]);
export const shadePresets = $state<ShadePreset[]>([]);

// ── Per-shade runtime state ────────────────────────────────────────────────
// `positions` and `tilts` hold confirmed percentages keyed by shadeId.
// Missing entries mean feedback has not arrived yet — they are NOT seeded
// with zero when configuration loads. The page can distinguish unknown
// feedback from a confirmed zero and owns any temporary slider drafts.
//
// Tilt stays on the server's scale here. Shades.svelte converts it to/from
// the UI's 0 = Closed / 100 = Open scale at the presentation/command boundary.
//
// `selectedShadeId` is local UI selection, remembered across page mounts in
// this store and written by the page. null means no individual selection;
// it is not a server-confirmed value or persisted browser setting.
//
// `activePresetId` mirrors server feedback, rather than being inferred by
// comparing current positions with preset targets. null clears selection.
// `lastUpdatedShadeId` records the most recent POSITION update, handy for
// diagnostics or future animations; tilt updates do not change it.
export const shadesState = $state<{
  positions: Record<string, number>;
  tilts: Record<string, number>;
  selectedShadeId: string | null;
  activePresetId: string | null;
  lastUpdatedShadeId: string | null;
}>({
  positions: {},
  tilts: {},
  selectedShadeId: null,
  activePresetId: null,
  lastUpdatedShadeId: null,
});

// -----------------------------------------------------------------------------
// isShadePosition — shared runtime validation for ids and percentages
// -----------------------------------------------------------------------------
// A TypeScript annotation alone cannot validate JSON from the wire. Require
// a non-blank string id and a whole-number percentage in 0..100, rejecting
// NaN, Infinity, fractions, and out-of-range values without rounding/clamping.
//
// This checks shape/range, not catalogue membership, so feedback can arrive
// before room configuration. Tilt reuses it by passing tiltPercent under
// the positionPercent key; neither ids nor values are modified here.
export function isShadePosition(value: unknown): value is ShadePosition {
  if (typeof value !== "object" || value === null) return false;
  const position = value as Record<string, unknown>;
  return (
    typeof position.shadeId === "string" &&
    position.shadeId.trim().length > 0 &&
    typeof position.positionPercent === "number" &&
    Number.isInteger(position.positionPercent) &&
    position.positionPercent >= 0 &&
    position.positionPercent <= 100
  );
}

// -----------------------------------------------------------------------------
// applyShadePresets — the ONE way the transport writes the preset catalogue
// -----------------------------------------------------------------------------
// Called after GetRoomConfiguration validates the optional shadePresets
// field. Replace the contents in place so consumers keep the same reactive
// array. This updates scene definitions only; activePresetId still waits
// for server feedback through applyShadePresetSelected().
export function applyShadePresets(presets: ShadePreset[]): void {
  shadePresets.splice(0, shadePresets.length, ...presets);
}

// -----------------------------------------------------------------------------
// applyShadeTilt — the ONE way the transport writes confirmed slat tilt
// -----------------------------------------------------------------------------
// Called from ShadeTiltChanged or GetRoomState.shadeTilts in
// transport/shades.ts. Validate again at the write boundary, then replace
// the record with a copy containing this shade's server-scale value. Other
// shades' feedback is retained; selection and lastUpdatedShadeId are unchanged.
export function applyShadeTilt(shadeId: string, tiltPercent: number): void {
  if (!isShadePosition({ shadeId, positionPercent: tiltPercent })) {
    console.warn("shadesState: invalid shade tilt", { shadeId, tiltPercent });
    return;
  }
  shadesState.tilts = { ...shadesState.tilts, [shadeId]: tiltPercent };
}

// -----------------------------------------------------------------------------
// applyShadePresetSelected — the ONE way the transport writes the active scene
// -----------------------------------------------------------------------------
// Called from ShadePresetSelected or GetRoomState.activeShadePresetId.
// The transport validates the payload: a non-blank string selects a scene,
// while null explicitly clears it. Applying a selection here does not move
// shades or infer their positions; those arrive as separate feedback.
export function applyShadePresetSelected(presetId: string | null): void {
  shadesState.activePresetId = presetId;
}

// -----------------------------------------------------------------------------
// applyShades — the ONE way the transport writes the shade catalogue
// -----------------------------------------------------------------------------
// Called after GetRoomConfiguration validates/normalises the shades field.
// Replaces the catalogue in place, preserving the reactive array's identity.
// This does not seed or clear position/tilt records or change the remembered
// selection. The page reconciles its selection against the new catalogue;
// confirmed percentages continue to come from transport/shades.ts.
export function applyShades(shades: Shade[]): void {
  SHADES.splice(0, SHADES.length, ...shades);
}

// -----------------------------------------------------------------------------
// applyShadePosition — the ONE way the transport writes confirmed position
// -----------------------------------------------------------------------------
// Called from ShadePositionChanged or GetRoomState.shadePositions. Keep
// range/id validation here as well as at the transport boundary so every
// caller follows the same rules. Invalid values are warned about and dropped.
//
// The catalogue may not have loaded when the first feedback arrives. As in
// lights' applyLightLevel(), a non-empty catalogue with an unknown id causes
// a warning, but the valid feedback is still stored. Configuration loading
// and runtime feedback are independent; do not discard one because the other
// has not caught up yet.
//
// Merge this shade's value into a new record, retaining the others, then
// record which shade most recently reported a position.
export function applyShadePosition(
  shadeId: string,
  positionPercent: number,
): void {
  if (!isShadePosition({ shadeId, positionPercent })) {
    console.warn("shadesState: invalid shade position", {
      shadeId,
      positionPercent,
    });
    return;
  }
  if (SHADES.length > 0 && !SHADES.some((shade) => shade.id === shadeId)) {
    console.warn(`shadesState: unknown shadeId ${shadeId}`);
  }
  shadesState.positions = {
    ...shadesState.positions,
    [shadeId]: positionPercent,
  };
  shadesState.lastUpdatedShadeId = shadeId;
}
