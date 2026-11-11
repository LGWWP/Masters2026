<!--
  Footer.svelte
  =============================================================================
  The bottom bar of the app. From left to right:

    [ page navigation ]  ........  [ quick actions ] [ volume ]

  - Page navigation: one icon button per page, with a highlight "pill" that
    slides to the selected page.
  - Quick actions: one-tap shortcuts for the CURRENT page (for example "All Off"
    on Lighting). They come from stores/quickActions.ts, so this file knows
    nothing about individual pages.
  - Volume: mute button plus a flyout slider (VolumeControl.svelte).

  The connection status now lives only in the header (the dot next to the room name).

  Pages that require a connection are disabled while any applicable transport
  is down. For available pages, navigation updates locally before syncing:
    1. User taps a button -> `go(key)` runs.
    2. `go` calls `goTo(key)`, which updates the store SYNCHRONOUSLY so the UI
       switches immediately without waiting for the network.
    3. `go` then calls `syncPage(key)`, a fire-and-forget message to the
       SignalR hub. If it fails, the local UI is already correct.
-->
<svelte:options runes />

<script lang="ts">
  import { onMount } from "svelte";
  import {
    nav,
    goTo,
    PAGES,
    type PageKey,
  } from "../../stores/navigation.svelte";
  import { appStatus, syncPage } from "../../transport/signalr.svelte";
  import { bridgeStatus } from "../../stores/connection.svelte";
  import { QUICK_ACTIONS, MAX_INLINE } from "../../stores/quickActions";
  import { toggleFlyout, closeFlyout } from "../../stores/flyout.svelte";
  import Flyout from "../ui/Flyout.svelte";
  import VolumeControl from "./VolumeControl.svelte";

  // Match the connection status shown in the header.
  const connected = $derived(
    (bridgeStatus.cip ?? true) &&
      (bridgeStatus.ws ?? true) &&
      appStatus.isConnected,
  );

  function go(key: PageKey) {
    goTo(key);
    syncPage(key);
  }

  // ---------------------------------------------------------------------------
  // Sliding highlight pill
  // ---------------------------------------------------------------------------
  // The highlight is ONE element that moves behind the buttons, instead of each
  // button having its own background. To place it we measure the active
  // button's position and size, and CSS transitions animate between positions.
  let buttons = $state<HTMLButtonElement[]>([]); // filled in by bind:this below
  let pill = $state<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  let animate = $state(false); // false for the first placement so it doesn't slide in from 0
  let navEl = $state<HTMLElement | null>(null); // the .page-nav, for the ResizeObserver

  function placePill() {
    const index = PAGES.findIndex((p) => p.key === nav.current);
    const el = buttons[index];
    if (!el) return;
    pill = {
      x: el.offsetLeft,
      y: el.offsetTop,
      w: el.offsetWidth,
      h: el.offsetHeight,
    };
  }

  // $effect re-runs whenever `nav.current` (or the bound buttons) change.
  $effect(() => {
    placePill();
  });

  // Turn the slide animation on only after the pill has been placed once.
  onMount(() => {
    requestAnimationFrame(() => (animate = true));

    // Resizing the panel reflows the buttons but nothing reactive changes, so
    // the pill would be left at stale coordinates. Re-measure whenever the
    // nav's size changes — snapping (animation off) rather than sliding, since
    // the slide is for page changes, not window resizes.
    const ro = new ResizeObserver(() => {
      animate = false;
      placePill();
      // Two frames: one for the un-animated position to paint, one before
      // re-enabling transitions, so the snap can't turn into a slide.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => (animate = true)),
      );
    });
    if (navEl) ro.observe(navEl);
    return () => ro.disconnect();
  });

  // ---------------------------------------------------------------------------
  // Quick actions for the current page
  // ---------------------------------------------------------------------------
  const actions = $derived(QUICK_ACTIONS[nav.current] ?? []);
  const inlineActions = $derived(actions.slice(0, MAX_INLINE)); // shown as buttons
  const extraActions = $derived(actions.slice(MAX_INLINE)); // shown under "More"

  const MORE_ID = "more-actions";
</script>

<footer class="app-footer">
  <nav class="page-nav" aria-label="Primary" bind:this={navEl}>
    <!-- The sliding highlight. Sits behind the buttons (see z-index in the CSS). -->
    {#if pill}
      <span
        class="pill"
        class:animate
        style="transform: translate({pill.x}px, {pill.y}px); width: {pill.w}px; height: {pill.h}px;"
        aria-hidden="true"
      ></span>
    {/if}

    {#each PAGES as page, i (page.key)}
      <button
        type="button"
        class="nav-button"
        title={page.label}
        class:active={nav.current === page.key}
        disabled={page.requiresConnection && !connected}
        bind:this={buttons[i]}
        onclick={() => go(page.key)}
      >
        <page.icon size="2em" />
      </button>
    {/each}
  </nav>

  <div class="right">
    {#each inlineActions as action (action.id)}
      <button type="button" class="action-btn" onclick={action.run}
        >{action.label}</button
      >
    {/each}

    {#if extraActions.length > 0}
      <!-- position: relative anchors the flyout above the button. -->
      <div class="more">
        <button
          type="button"
          class="action-btn"
          data-flyout-trigger={MORE_ID}
          onclick={() => toggleFlyout(MORE_ID)}>More</button
        >

        <Flyout id={MORE_ID}>
          <div class="more-list">
            {#each extraActions as action (action.id)}
              <button
                type="button"
                class="action-btn"
                onclick={() => {
                  action.run();
                  closeFlyout();
                }}>{action.label}</button
              >
            {/each}
          </div>
        </Flyout>
      </div>
    {/if}
    <!-- TODO: UI Lab 1.4c - Add the volume component to the footer from 'src/lib/components/layout'
         Hint: The component doesn't need any props to be passed in.
         UI Lab 1.4c - End -->
    <!-- REF: UI Lab 1.4c -->
    <VolumeControl />
    <!-- REF: UI Lab 1.4c - End -->
  </div>
</footer>

<style>
  .app-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0 1.25rem;
    height: 65px;
    background-color: rgb(var(--panel) / 0.85);
    border-top: 1px solid rgb(var(--ink) / 0.08);
    color: rgb(var(--ink) / 0.6);
    font-size: 0.8rem;
  }

  /* position: relative so the pill can be positioned inside it. */
  .page-nav {
    position: relative;
    display: flex;
    gap: 0.5rem;
  }

  /* Small panels: the five nav buttons can't fit beside the volume cluster,
     so hide them — the edge menu still provides navigation. The quick
     actions + volume keep the bar, anchored to the right. */
  @media (max-width: 600px) {
    .page-nav {
      display: none;
    }

    .app-footer {
      justify-content: flex-end;
    }
  }

  .pill {
    position: absolute;
    top: 0;
    left: 0;
    border-radius: 8px;
    background-color: var(--nav-active-bg);
    border: 1px solid var(--nav-active-border);
    box-sizing: border-box;
    pointer-events: none;
  }
  /* Only animate once the first placement is done. */
  .pill.animate {
    transition:
      transform 300ms cubic-bezier(0.25, 1, 0.5, 1),
      width 300ms ease,
      height 300ms ease;
  }

  .nav-button {
    position: relative;
    z-index: 1; /* above the pill */
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    color: rgb(var(--ink) / 0.5);
    font: inherit;
    font-size: 0.95rem;
    padding: 0.08rem 1rem;
    border-radius: 8px;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .nav-button:hover:not(:disabled) {
    color: rgb(var(--ink) / 0.85);
    background-color: rgb(var(--ink) / 0.06);
  }

  /* The coloured background comes from the pill; the button only changes colour. */
  .nav-button.active,
  .nav-button.active:hover:not(:disabled) {
    background-color: transparent;
    color: #ffffff;
  }

  .nav-button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .more {
    position: relative;
  }

  .more-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 160px;
  }

  .action-btn {
    appearance: none;
    min-height: 44px;
    padding: 0 1.1rem;
    border: 1px solid rgb(var(--ink) / 0.15);
    border-radius: 10px;
    background: rgb(var(--ink) / 0.05);
    color: rgb(var(--ink) / 0.85);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .action-btn:active {
    transform: scale(0.96);
  }
</style>
