// -----------------------------------------------------------------------------
// flyout.svelte.ts — which flyout panel is open (only one at a time)
// -----------------------------------------------------------------------------
// Several things can open a flyout (volume, "More" quick actions, ...). Keeping
// the open one in a single shared value means opening one automatically closes
// the other, and the triggers never need to know about each other.
// -----------------------------------------------------------------------------

export const flyouts = $state<{ openId: string | null }>({
  openId: null
});

export function toggleFlyout(id: string): void {
  flyouts.openId = flyouts.openId === id ? null : id;
}

export function closeFlyout(): void {
  flyouts.openId = null;
}
