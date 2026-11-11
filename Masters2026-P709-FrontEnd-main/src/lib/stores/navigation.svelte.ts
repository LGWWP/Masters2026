// -----------------------------------------------------------------------------
// navigation.svelte.ts
// -----------------------------------------------------------------------------
// This module is the "single source of truth" for which page is currently shown
// in the app. Any component (Header buttons, PageOutlet, even the SignalR
// transport) reads from and writes to the `nav` object exported below.
//
// Why the `.svelte.ts` extension?
//   Files that use Svelte 5 runes (`$state`, `$derived`, `$effect`) MUST end in
//   `.svelte.ts` (or `.svelte.js`). The Svelte compiler processes them; a plain
//   `.ts` file would leave the runes unhandled and reactivity would silently
//   not work.
//
// Why `$state(...)` on a plain object?
//   `$state` is Svelte 5's reactive primitive. Wrapping an object with it makes
//   every property reactive: when `nav.current` changes, every `.svelte`
//   component that reads `nav.current` re-renders automatically.
//
// IMPORTANT — do NOT destructure the store:
//   BAD:   const { current } = nav;   // <-- 'current' is now a plain string,
//                                     //     reactivity is LOST
//   GOOD:  nav.current                 // <-- always read the property directly
// -----------------------------------------------------------------------------

import type { Component } from 'svelte';
import HomeIcon from '../components/icons/HomeIcon.svelte';
import LightIcon from '../components/icons/LightIcon.svelte';
import ShadeIcon from '../components/icons/ShadeIcon.svelte';
import SourceIcon from '../components/icons/SourceIcon.svelte';
import ConciergeIcon from '../components/icons/ConciergeIcon.svelte';
import SupportIcon from '../components/icons/SupportIcon.svelte';

// -----------------------------------------------------------------------------
// 1. PageKey — the closed set of valid pages
// -----------------------------------------------------------------------------
// This is a TypeScript "union type." It restricts every page identifier in the
// app to exactly one of these strings. If someone typos `'lightss'`, the
// TypeScript compiler will refuse to build. That safety is why we bother
// declaring this instead of using plain `string` everywhere.
//
// To add a new page later:
//   1. Add its key to this union.
//   2. Add a loader entry in `loaders` below.
//   3. Add a metadata entry in `PAGES` below.
// TypeScript will then flag every place that needs updating.
export type PageKey = 'home' | 'lights' | 'shades' | 'sources' | 'concierge' | 'support';

// -----------------------------------------------------------------------------
// 2. Loaders — one dynamic `import()` per page
// -----------------------------------------------------------------------------
// Each entry is a FUNCTION that, when called, returns a Promise for the page
// component. This is important: because we use dynamic `import()`, Vite
// automatically code-splits each page into its own JS chunk. On boot, ONLY the
// initial page's chunk is downloaded — Lights.js, Shades.js, etc. arrive on
// demand the first time a user taps their button. This is what keeps the
// project scalable as pages are added later.
//
// The type signature: () => Promise<{ default: Component }>
//   - `() =>`  a function taking no arguments
//   - `Promise<...>`  because dynamic imports are asynchronous
//   - `{ default: Component }`  because `.svelte` files export the component
//                               as their DEFAULT export
const loaders: Record<PageKey, () => Promise<{ default: Component }>> = {
  home: () => import('../components/pages/Home.svelte'),
  lights: () => import('../components/pages/Lights.svelte'),
  shades: () => import('../components/pages/Shades.svelte'),
  sources: () => import('../components/pages/SourceSelection.svelte'),
  concierge: () => import('../components/pages/Concierge.svelte'),
  support: () => import('../components/pages/Support.svelte')
};

// -----------------------------------------------------------------------------
// 3. PAGES — display metadata for the Header buttons
// -----------------------------------------------------------------------------
// We keep the button list here (instead of hard-coding it in Header.svelte) so
// there is ONE place to look when adding, removing, or reordering pages. The
// Header just iterates over this array.
//
// Order in this array = order of the buttons in the header.
export const PAGES: ReadonlyArray<{ key: PageKey; label: string; icon: typeof HomeIcon; requiresConnection?: boolean }> = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'lights', label: 'Lights', icon: LightIcon, requiresConnection: true },
  { key: 'shades', label: 'Shades', icon: ShadeIcon, requiresConnection: true },
  { key: 'sources', label: 'Sources', icon: SourceIcon, requiresConnection: true },
  { key: 'concierge', label: 'Concierge', icon: ConciergeIcon },
  { key: 'support', label: 'Support', icon: SupportIcon, requiresConnection: true }
];

// -----------------------------------------------------------------------------
// 4. The reactive state
// -----------------------------------------------------------------------------
// Everything the UI needs to know about "which page is up" lives here.
//
//   current  — the page currently being shown (drives the UI).
//   previous — the page we came from; useful later for direction-aware
//              animations (slide left vs. right). Not required today but
//              cheap to track from the start.
//   lastLocalNavAt — timestamp (from performance.now()) of the most recent
//              LOCAL tap. The SignalR transport reads this to implement the
//              "user-intent lock" — see signalr.ts for details.
export const nav = $state<{
  current: PageKey;
  previous: PageKey | null;
  lastLocalNavAt: number;
}>({
  current: 'home',
  previous: null,
  lastLocalNavAt: 0
});

// -----------------------------------------------------------------------------
// 5. loadPage — used by <PageOutlet /> to fetch the current page's module
// -----------------------------------------------------------------------------
// The PageOutlet component uses `{#await loadPage(nav.current)}` to show the
// page. Because the promise returned by dynamic `import()` is cached by the
// browser, calling `loadPage('lights')` a second time is instant — no network
// round-trip and no re-parse.
export function loadPage(key: PageKey): Promise<Component> {
  return loaders[key]().then((mod) => mod.default);
}

// -----------------------------------------------------------------------------
// 6. goTo — the ONE way to change pages from a user tap
// -----------------------------------------------------------------------------
// Every button, keyboard shortcut, or programmatic navigation goes through
// this function. It:
//   (a) short-circuits if we're already on the target page (no work, no
//       flicker),
//   (b) updates the reactive state SYNCHRONOUSLY so the UI switches instantly
//       — this is the "offline-first" guarantee: the user sees the new page
//       before we've even attempted a network call,
//   (c) records `lastLocalNavAt` so the SignalR inbound handler can ignore a
//       server "CurrentPageChanged" echo that arrives right after our local
//       tap (see transport/signalr.svelte.ts).
//
// Notice that this function does NOT talk to SignalR itself. Keeping the
// navigation store free of transport code makes it easy to test and easy to
// reuse — the transport imports the store, not the other way around.
export function goTo(key: PageKey): void {
  if (nav.current === key) return;

  nav.previous = nav.current;
  nav.current = key;
  nav.lastLocalNavAt = performance.now();
}

// -----------------------------------------------------------------------------
// 7. isPageKey — runtime type guard
// -----------------------------------------------------------------------------
// The SignalR transport receives page keys as plain strings from the server.
// This function verifies at runtime that a string is a valid PageKey before we
// trust it. TypeScript's `k is PageKey` return-type annotation teaches the
// compiler that inside an `if (isPageKey(x))` block, `x` may be treated as a
// PageKey with full type safety.
export function isPageKey(k: string): k is PageKey {
  return PAGES.some((p) => p.key === k);
}
