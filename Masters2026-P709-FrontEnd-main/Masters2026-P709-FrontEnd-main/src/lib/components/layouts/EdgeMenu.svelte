<!--
  EdgeMenu.svelte
  =============================================================================
  A slide-out navigation menu with a "liquid" edge

  HOW IT WORKS 
    The panel isn't a fixed shape that slides across the screen. 
    Instead, it continuously changes shape as it opens, creating a smooth, stretchy effect. 
    The amount it opens and stretches is animated, and the stretch follows the user's finger position, making the interaction feel natural and responsive.

  WHY THE ANIMATION VALUES ARE PLAIN VARIABLES (not $state)
    These animation values update many times per second and only affect the panel's shape. 
    Updating them directly avoids unnecessary UI re-renders, making the animation smoother and more efficient. 
    Only values that the UI needs to react to are stored in $state or $derived.

  LAYERS (back to front, all position: fixed)
    overlay  → dims the page; tapping it closes the menu
    svg      → the liquid panel background
    content  → the menu items
    handle   → the little tab that rides the edge; tap or drag it

  To add a menu item, edit PAGES in stores/navigation.svelte.ts — this file
  builds its list from that array, same as Footer.svelte.
-->

<svelte:options runes />

<script lang="ts">
  import { onMount } from 'svelte';
  import { nav, goTo, PAGES, type PageKey } from '../../stores/navigation.svelte';
  import { appStatus, syncPage } from '../../transport/signalr.svelte';
  import { bridgeStatus } from '../../stores/connection.svelte';
  import { lightsState, LOADS, lightPresets } from '../../stores/lights.svelte';
  import { selectPreset } from '../../transport/lights';
  import ThemeToggle from './ThemeToggle.svelte';
  import { isTransitioning } from '../../stores/system.svelte';

  // Match the connection status shown in the header.
  const connected = $derived(
    (bridgeStatus.cip ?? true) && (bridgeStatus.ws ?? true) && appStatus.isConnected
  );

  // ---------------------------------------------------------------------------
  // Constants for Adjusting — change these to adjust the feel without touching logic
  // ---------------------------------------------------------------------------
  const MENU_WIDTH = 320;       // px: width of the fully open panel
  const EDGE_GRAB_PX = 40;      // px: a swipe must START this close to the left edge to open
  const OPEN_DRAG_PX = 140;     // px: drag distance that commits to "open"
  const CLOSE_DRAG_PX = 60;     // px: leftward drag distance that commits to "close"
  const BULGE_FACTOR = 0.85;    // how much of the finger travel becomes edge bulge
  const HANDLE_HEIGHT = 60;     // px: must match .handle height in the CSS below
  const WIDTH_EASE = 0.14;      // 0..1: fraction of the remaining distance covered each frame
  const DEPTH_EASE = 0.1;       //       smaller = slower / floatier
  const Y_EASE = 0.15;
  const SETTLE_EPSILON = 0.1;   // stop animating when every value is within this of its target

  // ---------------------------------------------------------------------------
  // Reactive state (drives the template)
  // ---------------------------------------------------------------------------
  let isOpen = $state(false);
  let lightingExpanded = $state(false);

  $effect(() => {
    if (!connected) lightingExpanded = false;
  });

  // ---------------------------------------------------------------------------
  // Animation state (plain variables — see header comment for why)
  // ---------------------------------------------------------------------------
  // "target" is where we want to be; "cur" is where we are right now.
  let targetWidth = 0;
  let targetDepth = 0;
  let targetY = 0;
  let curWidth = 0;
  let curDepth = 0;
  let curY = 0;

  let isDragging = false;
  let dragStartX = 0;
  // After a drag opens/closes the menu, the browser still fires a "click" when
  // the finger lifts. If that lands on the handle it would immediately undo the
  // drag, so we suppress exactly one click.
  let suppressNextClick = false;

  // Element references, filled in by `bind:this` in the template.
  let pathEl: SVGPathElement;
  let handleEl: HTMLButtonElement;

  // ---------------------------------------------------------------------------
  // Derived values from the lights store
  // ---------------------------------------------------------------------------
  // The store holds a level per lightId (string keys "1".."5" on
  // lightsState.levels), matching the unified API's lightId resource
  // identifier.
  function levelOf(lightId: string): number {
    return lightsState.levels[lightId] ?? 0;
  }

  // $derived re-computes automatically whenever a level in lightsState changes,
  // so the "N ON" badge stays live with no extra wiring.
  const lightsOnCount = $derived(LOADS.filter((l) => levelOf(l.id) > 0).length);

  // ---------------------------------------------------------------------------
  // The animation loop
  // ---------------------------------------------------------------------------
  let rafId = 0; // 0 means "loop is not running"

  // Redraws the path and handle from the current values. Called every frame.
  function render() {
    const h = window.innerHeight;
    const edgeX = curWidth + curDepth; // x of the crest of the curve

    // SVG path commands:
    //   M x y        move the pen
    //   L x y        straight line
    //   C c1 c2 end  cubic Bézier curve (two control points + end point)
    //   Z            close the shape
    // We trace: top-left → top of the panel's edge → curve out to the crest at
    // the finger's Y → curve back to the bottom of the edge → bottom-left.
    // The ±70 / ±140 offsets set how tall (wide in Y) the bulge is.
    pathEl.setAttribute(
      'd',
      `M 0 0 L ${curWidth} 0
       C ${curWidth} ${curY - 140}, ${edgeX} ${curY - 70}, ${edgeX} ${curY}
       C ${edgeX} ${curY + 70}, ${curWidth} ${curY + 140}, ${curWidth} ${h}
       L 0 ${h} Z`
    );

    // We move it with `transform` (not left/top)
    // because transforms are GPU-composited and don't trigger layout.
    handleEl.style.transform = `translate(${edgeX}px, ${curY - HANDLE_HEIGHT / 2}px)`;
  }

  function frame() {
    // Each frame covers a fixed FRACTION of the remaining distance, so motion
    // is fast at first and slows as it arrives (exponential ease-out).
    curWidth += (targetWidth - curWidth) * WIDTH_EASE;
    curDepth += (targetDepth - curDepth) * DEPTH_EASE;
    curY += (targetY - curY) * Y_EASE;

    // While not dragging, the handle drifts back to the vertical centre.
    if (!isDragging) targetY = window.innerHeight / 2;

    const settled =
      Math.abs(targetWidth - curWidth) < SETTLE_EPSILON &&
      Math.abs(targetDepth - curDepth) < SETTLE_EPSILON &&
      Math.abs(targetY - curY) < SETTLE_EPSILON;

    if (settled) {
      // Snap to the exact targets so we never rest at e.g. 319.93px.
      curWidth = targetWidth;
      curDepth = targetDepth;
      curY = targetY;
      render();
      rafId = 0; // stop looping — nothing is moving, so don't burn CPU/battery
      return;
    }

    render();
    rafId = requestAnimationFrame(frame);
  }

  // Wake the loop up. Safe to call repeatedly; it only starts one loop.
  function startLoop() {
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  onMount(() => {
    // Initial position: closed, handle vertically centred.
    targetY = curY = window.innerHeight / 2;
    render();

    // The function returned from onMount runs when the component is destroyed.
    return () => cancelAnimationFrame(rafId);
  });

  // If the system starts/stops warming up or cooling down while the menu is
  // open, close it — SystemPowerOverlay covers the whole screen during those
  // states anyway, so there is nothing to interact with underneath.
  $effect(() => {
    if (isTransitioning() && isOpen) setOpen(false);
  });

  // ---------------------------------------------------------------------------
  // Open / close
  // ---------------------------------------------------------------------------
  function setOpen(open: boolean) {
    isOpen = open;
    targetWidth = open ? MENU_WIDTH : 0;
    targetDepth = 0;
    if (!open) lightingExpanded = false; // collapse the submenu so it's fresh next time
    startLoop();
  }

  // ---------------------------------------------------------------------------
  // Pointer (touch / mouse / pen) handling
  // ---------------------------------------------------------------------------
  // We listen on `window` (see <svelte:window> in the template) so a drag keeps
  // working even when the finger leaves the handle. Pointer events cover touch
  // and mouse with one code path.
  //
  // NOTE: for touch, the browser may claim a drag as a scroll/pan and send
  // `pointercancel`. That's unlikely here because the app shell is
  // `overflow: hidden`, and the handle/menu set `touch-action: none` below.

  function onPointerDown(e: PointerEvent) {
    suppressNextClick = false;

    // SystemPowerOverlay covers the whole screen while starting/stopping, so
    // edge swipes must not open the menu underneath it. While the room is
    // simply "off", the menu stays usable — that's how the Sources page can
    // be reached to turn the system on.
    if (isTransitioning()) return;

    // Closed: only start from the very edge. Open: allow starting anywhere over
    // the panel so you can swipe it shut.
    const grabLimit = isOpen ? MENU_WIDTH + 40 : EDGE_GRAB_PX;
    if (e.clientX > grabLimit) return;

    isDragging = true;
    dragStartX = e.clientX;
    targetY = e.clientY; // make the bulge appear under the finger
    startLoop();
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDragging) return;

    targetY = e.clientY;
    const deltaX = e.clientX - dragStartX;

    if (!isOpen) {
      // Pulling right: stretch the edge, and commit to "open" past the threshold.
      targetDepth = Math.max(0, deltaX) * BULGE_FACTOR;
      if (deltaX > OPEN_DRAG_PX) {
        isDragging = false;
        suppressNextClick = true;
        setOpen(true);
        return;
      }
    } else {
      // Pushing left: dent the edge, and commit to "close" past the threshold.
      targetDepth = Math.min(0, deltaX * BULGE_FACTOR);
      if (deltaX < -CLOSE_DRAG_PX) {
        isDragging = false;
        suppressNextClick = true;
        setOpen(false);
        return;
      }
    }
    startLoop();
  }

  // Finger lifted (or the browser cancelled the gesture): release the bulge and
  // let the springs carry everything back to rest.
  function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    targetDepth = 0;
    startLoop();
  }

  function onHandleClick() {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    setOpen(!isOpen);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) setOpen(false);
  }

  // ---------------------------------------------------------------------------
  // Menu actions
  // ---------------------------------------------------------------------------
  // Same offline-first sequence as Footer.svelte: update the local UI first,
  // then tell the server. Then close the menu so the new page is visible.
  function go(key: PageKey) {
    goTo(key);
    syncPage(key);
    setOpen(false);
  }

  // Same behaviour as the preset buttons on the Lights page: fire the
  // "SelectPreset" hub command and wait for the "PresetSelected" echo.
  function applyPreset(presetId: string) {
    selectPreset(presetId);
  }

  // Pressing the open panel anywhere that isn't a button closes the menu,
  // matching the overlay behaviour outside the panel. Button taps (rows,
  // submenu, theme toggle) are left alone. Honors suppressNextClick so the
  // trailing click after a swipe-open/-close gesture doesn't instantly undo it.
  function onContentClick(e: MouseEvent) {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    const target = e.target as Element | null;
    if (target && target.closest('button')) return;
    setOpen(false);
  }
</script>

<!--
  <svelte:window> attaches listeners to `window` and removes them automatically
  when this component is destroyed.
  `onresize` just wakes the loop so render() re-reads the new window height.
-->
<svelte:window
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onkeydown={onKeyDown}
  onresize={startLoop}
/>

<!--
  Edge strip: an invisible hit target along the left edge while closed.
  Touch gestures are claimed by the browser based on the `touch-action` of the
  element where the finger LANDS. The page underneath allows panning, so the
  browser could steal the swipe and cancel our pointer events. This strip sets
  `touch-action: none`, so the swipe always reaches onPointerDown/Move.
  Its width matches EDGE_GRAB_PX so the touch zone and the grab zone agree.
-->
<div class="edge-strip" class:disabled={isOpen} style:--edge-width="{EDGE_GRAB_PX}px" aria-hidden="true"></div>

<!-- Layer 1: dim backdrop. Only receives taps while open (see CSS). -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="overlay" class:active={isOpen} onclick={() => setOpen(false)}></div>

<!-- Layer 2: the liquid panel. `d` is written by render(), not by Svelte. -->
<svg class="liquid" class:open={isOpen} aria-hidden="true">
  <path bind:this={pathEl} />
</svg>

<!--
  Layer 3: menu content.
  `inert` makes the whole subtree unfocusable and unclickable while closed, so
  keyboard users can't tab into an invisible menu.
  `--menu-width` hands the JS constant to the CSS so there is one source of truth.
-->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<nav
  class="content"
  class:active={isOpen}
  inert={!isOpen}
  style:--menu-width="{MENU_WIDTH}px"
  aria-label="Main menu"
  onclick={onContentClick}
>
  <h2>ROOM CONTROL</h2>

  <ul>
    {#each PAGES as page, i (page.key)}
      <!-- `--i` feeds the CSS stagger delay: each row appears slightly later. -->
      <li class="item" style:--i={i}>
        {#if page.key === 'lights'}
          <!-- Lights is special: tapping expands a submenu instead of navigating. -->
          <button
            type="button"
            class="row"
            class:current={nav.current === page.key}
            disabled={page.requiresConnection && !connected}
            aria-expanded={lightingExpanded}
            onclick={() => (lightingExpanded = !lightingExpanded)}
          >
            <span class="label">{page.label}</span>
            <span class="badge" class:lit={lightsOnCount > 0}>{lightsOnCount} ON</span>
            <span class="chevron" class:expanded={lightingExpanded} aria-hidden="true">▶</span>
          </button>

          <!--
            Animating height to "auto" is impossible in CSS, but animating a
            grid row from 0fr → 1fr is, and it gives the same effect.
          -->
          <div class="submenu" class:expanded={lightingExpanded}>
            <ul class="submenu-inner">
              <li>
                <button type="button" class="sub-row" disabled={!connected} onclick={() => go('lights')}>
                  Open Lights page
                </button>
              </li>
              {#each lightPresets as preset (preset.id)}
                <li>
                  <button type="button" class="sub-row" disabled={!connected} onclick={() => applyPreset(preset.id)}>
                    {preset.name}
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {:else}
          <button
            type="button"
            class="row"
            class:current={nav.current === page.key}
            disabled={page.requiresConnection && !connected}
            onclick={() => go(page.key)}
          >
            <span class="label">{page.label}</span>
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  <!-- `--i` continues the nav rows' stagger so this section arrives last,
       with the same fade/slide as the items above. -->
  <div class="theme-section" style:--i={PAGES.length}>
    <h2>THEME</h2>
    <ThemeToggle />
  </div>
</nav>

<!-- Layer 4: the handle tab. Moved by render(); opens/closes on tap. -->
<button
  type="button"
  class="handle"
  bind:this={handleEl}
  onclick={onHandleClick}
  aria-label={isOpen ? 'Close menu' : 'Open menu'}
  aria-expanded={isOpen}
>
  <span class="handle-arrow" class:open={isOpen} aria-hidden="true">▶</span>
</button>

<style>
  /* Every layer is fixed to the viewport so the menu floats over header, main
     and footer without affecting the app grid layout. */
  .edge-strip,
  .overlay,
  .liquid,
  .content,
  .handle {
    position: fixed;
  }

  /* ── Edge strip ───────────────────────────────────────────────────────── */
  .edge-strip {
    top: 0;
    left: 0;
    width: var(--edge-width);
    height: 100%;
    touch-action: none;
    z-index: 999; /* below the handle so the handle still gets its own taps */
  }
  /* Open: the overlay takes over, so the strip must not swallow taps. */
  .edge-strip.disabled {
    pointer-events: none;
  }

  /* ── Layer 1: overlay ─────────────────────────────────────────────────── */
  .overlay {
    inset: 0;
    background: var(--overlay);
    opacity: 0;
    /* Closed: let taps fall through to the page underneath. */
    pointer-events: none;
    transition: opacity 300ms ease;
    touch-action: none; /* so a swipe-to-close that starts over the backdrop isn't stolen */
    z-index: 1000;
    /* (The prototype blurred the backdrop. backdrop-filter is expensive on
       panel hardware, so it is intentionally left out.) */
  }
  .overlay.active {
    opacity: 1;
    pointer-events: auto;
  }

  /* ── Layer 2: liquid SVG ──────────────────────────────────────────────── */
  .liquid {
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none; /* purely visual */
    z-index: 1001;
  }
  .liquid path {
    fill: rgb(var(--panel));
  }
  /* A full-screen drop-shadow is costly, so only pay for it while open. */
  .liquid.open {
    filter: drop-shadow(8px 0 20px rgb(var(--shadow-rgb) / 0.6));
  }

  /* ── Layer 3: content ─────────────────────────────────────────────────── */
  .content {
    top: 0;
    left: 0;
    height: 100%;
    width: var(--menu-width);
    box-sizing: border-box;
    padding: 60px 25px;
    overflow-y: auto;
    z-index: 1002;
    color: rgb(var(--ink) / 0.92);
    opacity: 0;
    transform: translateX(-20px);
    transition:
      opacity 300ms ease,
      transform 300ms ease;
    pointer-events: none;
    touch-action: none; /* stop the browser panning so our swipe-to-close works */
  }
  .content.active {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }

  h2 {
    margin: 0 0 35px 10px;
    font-size: 0.8rem;
    letter-spacing: 3px;
    color: rgb(var(--ink) / 0.45);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* Staggered entry: rows start shifted and invisible, then ease in one after
     another using the per-row --i index set in the template. The theme
     section joins the same stagger (its --i continues after the nav rows)
     so it appears/disappears in step with the rest of the menu. */
  .item,
  .theme-section {
    opacity: 0;
    transform: translateX(-30px);
  }
  .item {
    margin-bottom: 12px;
  }
  .content.active .item,
  .content.active .theme-section {
    opacity: 1;
    transform: translateX(0);
    transition:
      opacity 400ms ease calc(80ms + var(--i) * 40ms),
      /* the slight overshoot in this curve gives the "springy" arrival */
      transform 400ms cubic-bezier(0.18, 0.89, 0.32, 1.2) calc(80ms + var(--i) * 40ms);
  }

  .row {
    appearance: none;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 12px 14px;
    box-sizing: border-box;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    color: rgb(var(--ink) / 0.85);
    font: inherit;
    font-size: 1.25rem;
    font-weight: 300;
    text-align: left;
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  .row:active:not(:disabled) {
    background: rgb(var(--ink) / 0.06);
  }
  /* Same purple the Footer uses for the active page. */
  .row.current {
    background: rgb(var(--brand-rgb) / 0.35);
    border-color: rgb(var(--brand-rgb) / 0.6);
  }
  .label {
    flex: 1; /* pushes the badge / chevron to the right */
  }

  .badge {
    padding: 3px 8px;
    border-radius: 20px;
    background: rgb(var(--ink) / 0.08);
    color: rgb(var(--ink) / 0.55);
    font-size: 0.75rem;
    font-weight: 700;
  }
  .badge.lit {
    background: var(--badge-lit-bg);
    color: var(--badge-lit-ink);
  }

  .chevron {
    font-size: 0.8rem;
    color: rgb(var(--ink) / 0.35);
    transition: transform 300ms ease;
  }
  .chevron.expanded {
    transform: rotate(90deg);
    color: rgb(var(--ink) / 0.7);
  }

  /* Submenu: grid row 0fr → 1fr animates height without knowing the height. */
  .submenu {
    display: grid;
    grid-template-rows: 0fr;
    padding-left: 24px;
    transition: grid-template-rows 300ms cubic-bezier(0.25, 1, 0.5, 1);
  }
  .submenu.expanded {
    grid-template-rows: 1fr;
  }
  /* min-height:0 + overflow:hidden lets the grid row shrink all the way to 0. */
  .submenu-inner {
    min-height: 0;
    overflow: hidden;
  }
  .submenu.expanded .submenu-inner {
    padding-top: 6px;
  }

  .sub-row {
    appearance: none;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: rgb(var(--ink) / 0.6);
    font: inherit;
    font-size: 1rem;
    font-weight: 300;
    text-align: left;
    cursor: pointer;
    transition:
      color 120ms ease,
      transform 100ms ease;
  }
  .sub-row:active:not(:disabled) {
    color: var(--brand-ink);
    transform: translateX(4px);
  }

  .row:disabled,
  .sub-row:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* ── Layer 4: handle ──────────────────────────────────────────────────── */
  .handle {
    appearance: none;
    top: 0;
    left: 0; /* real position comes from the transform set in render() */
    width: 24px;
    height: 60px; /* keep in sync with HANDLE_HEIGHT in the script */
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(var(--panel));
    border: 1px solid rgb(var(--ink) / 0.15);
    border-left: none;
    border-radius: 0 8px 8px 0;
    color: rgb(var(--ink) / 0.55);
    font-size: 0.8rem;
    box-shadow: 4px 0 10px rgb(var(--shadow-rgb) / 0.3);
    cursor: pointer;
    z-index: 1003; /* above everything so it is always grabbable */
    touch-action: none;
  }
  .theme-section {
    margin-top: 28px;
    padding: 0 10px;
  }
  .theme-section h2 {
    margin: 0 0 12px;
  }
  .handle-arrow {
    transition: transform 300ms cubic-bezier(0.25, 1, 0.5, 1);
  }
  .handle-arrow.open {
    transform: rotate(180deg); /* ▶ becomes ◀ when the menu is open */
  }
</style>
