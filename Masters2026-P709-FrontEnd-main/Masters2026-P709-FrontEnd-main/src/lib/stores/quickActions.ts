// -----------------------------------------------------------------------------
// quickActions.ts — one-tap shortcuts shown in the footer, per page
// -----------------------------------------------------------------------------
// The footer asks this map "what actions does the current page have?" and
// draws them, so Footer.svelte never needs to know anything about individual
// pages. It is the same idea as the PAGES list in navigation.svelte.ts.
//
// TO ADD AN ACTION: add an entry to the page's array below.
//   { id: 'unique-id', label: 'Button text', run: () => { ...do the thing... } }
// The footer shows the first MAX_INLINE actions as buttons and puts any extra
// ones in a "More" flyout.
// -----------------------------------------------------------------------------

import type { PageKey } from './navigation.svelte';
import { LOADS } from './lights.svelte';
import { setLight } from '../transport/lights';

export type QuickAction = {
  id: string;
  label: string;
  run: () => void;
};

// How many actions are shown directly in the footer; the rest go under "More".
export const MAX_INLINE = 2;

export const QUICK_ACTIONS: Partial<Record<PageKey, readonly QuickAction[]>> = {
  lights: [
    {
      id: 'lights-all-off',
      label: 'All Off',
      // One setLight() per light; each answer comes back from the server.
      run: () => {
        for (const load of LOADS) setLight(load.id, 0);
      }
    }
  ]
};
