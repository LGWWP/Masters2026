// -----------------------------------------------------------------------------
// volume.svelte.ts — reactive state for room volume and mute
// -----------------------------------------------------------------------------
// Same role as the other stores: it only HOLDS state. The transport layer
// writes to it (applyVolume / applyMute) and components read from it.
// Read the properties directly (`volumeState.level`); do not destructure.
// -----------------------------------------------------------------------------

export const volumeState = $state<{ level: number; muted: boolean }>({
  level: 50,
  muted: false
});

export function applyMute(muted: boolean): void {
  volumeState.muted = muted;
}

// TODO: UI Lab 1.4a - Store the volume level in the reactive state
// Hint: The volume level should be clamped between 0 and 100
//       and rounded to the nearest integer.
// UI Lab 1.4a - End
