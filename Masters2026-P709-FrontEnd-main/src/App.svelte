<!--
  App.svelte
  =============================================================================
  The root component. Its ONLY responsibilities are:
    1. Define the three-row responsive shell (header / main / footer).
    2. Start the SignalR connection once at boot.
    3. Delegate everything else to smaller components:
         - Header  → nav buttons (imports from stores/transport)
         - PageOutlet → renders current page with a fade transistion
         - Footer  → connection indicator

  Notice App.svelte does NOT import any pages directly. That's intentional:
  keeping page knowledge inside the navigation store means adding a new page
  only touches one file (navigation.svelte.ts). The shell never needs to
  change as the app grows.
-->

<script lang="ts">
  import { untrack } from "svelte";
  import Header from "./lib/components/layouts/Header.svelte";
  import Footer from "./lib/components/layouts/Footer.svelte";
  import EdgeMenu from "./lib/components/layouts/EdgeMenu.svelte";
  import SystemPowerOverlay from "./lib/components/layouts/SystemPowerOverlay.svelte";
  import { systemState } from "./lib/stores/system.svelte";
  import { bridgeStatus } from "./lib/stores/connection.svelte";
  import { goTo } from "./lib/stores/navigation.svelte";
  import PageOutlet from "./lib/components/PageOutlet.svelte";
  import { appStatus, initSignalR } from "./lib/transport/signalr.svelte";
  import { onProcessorUrl } from "./lib/crestron/xpanel";

  // -------------------------------------------------------------------------
  // Domain transport registrations (side-effect imports)
  // -------------------------------------------------------------------------
  // Each domain transport module calls onHubReady(...) at import time to
  // queue its inbound hub handlers. Importing them HERE, BEFORE initSignalR
  // runs, guarantees the handlers are queued before the hub is built.
  //
  // To add a new page/domain (Shades, Sources, Climate, ...):
  //   1. Create stores/<domain>.svelte.ts   (reactive state)
  //   2. Create transport/<domain>.ts       (hub handlers + commands)
  //   3. Add ONE side-effect import line right here.
  // Nothing else in App.svelte or signalr.svelte.ts needs to change.
  import "./lib/transport/lights";
  import "./lib/transport/shades";
  import "./lib/transport/system";
  import "./lib/transport/volume";
  import "./lib/transport/sources";
  // (Concierge is NOT listed here: its transport is a REST API with no hub
  // handlers to register, so the page imports it directly on demand.)

  // The SignalR hub URL.
  //
  // Points at the C# backend's RoomHub. Rather than a hardcoded address,
  // this is received dynamically from the Crestron processor over serial
  // join 1 (see crestron/crestron.ts's onUrlChange, wired up here through
  // crestron/xpanel.ts's onProcessorUrl, which also handles the
  // WebXPanel/CIP bridge — see that file for run-mode details). Starts
  // empty; there is nothing to connect to until the processor sends a value.
  let SIGNALR_URL = "";

  // Registered at module load (not inside onMount) — same reasoning as
  // xpanel.ts subscribing to the raw join immediately: onProcessorUrl
  // doesn't touch the DOM, so there's no reason to wait for Svelte's first
  // render, and waiting would reopen the exact "early publish gets missed"
  // race xpanel.ts was just fixed to close.
  //
  // Fire-and-forget — if the backend is down, initSignalR schedules its own
  // retry loop, and the UI keeps working locally in the meantime.
  onProcessorUrl((url) => {
    SIGNALR_URL = url;
    initSignalR(SIGNALR_URL);
  });

  // ---------------------------------------------------------------------------
  // Return to Home on shutdown
  // ---------------------------------------------------------------------------
  // Reacts to the server-confirmed system state only — never fired directly
  // from a local tap. When every panel hears the system has gone "off" (via
  // the "SystemPowerStateChanged" broadcast, see transport/system.ts), send
  // that panel back to the Home page, the same way CurrentPageChanged echoes
  // already use goTo() in signalr.svelte.ts.
  //
  // untrack() around goTo() is required here: goTo() internally reads
  // `nav.current` (to skip navigating if already there), and without
  // untrack() that read would ALSO become a dependency of this effect. That
  // would make the effect re-fire on every navigation (e.g. tapping
  // "Sources"), immediately snapping back to Home and making it impossible
  // to navigate anywhere while the system is off — exactly the behaviour
  // needed to reach the Sources page and turn the system on in the first
  // place. untrack() keeps the effect's only real dependency as
  // `systemState.current`.
  $effect(() => {
    if (systemState.current === "off") {
      untrack(() => goTo("home"));
    }
  });

  // Redirect only when an established connection drops. Starting offline and
  // failed initial connection attempts leave the startup page unchanged.
  let wasConnected = false;
  $effect(() => {
    const connected =
      (bridgeStatus.cip ?? true) && (bridgeStatus.ws ?? true) && appStatus.isConnected;

    if (wasConnected && !connected) {
      untrack(() => goTo("concierge"));
    }
    wasConnected = connected;
  });
</script>

<!-- Normal shell; the system no longer gates it behind a standby screen. -->
<div class="app-shell">
  <Header />

  <!--
    <main> is the middle row of the shell. It has `position: relative` so the
    PageOutlet's absolutely-positioned `.page` layers stack inside it (rather
    than escaping to fill the viewport).
  -->
  <main class="app-main">
    <PageOutlet />
  </main>

  <Footer />
</div>

<!-- Fixed-position overlay menu; lives outside the grid so it doesn't take a row. -->
<EdgeMenu />

<!-- Confirmation + start-up/shut-down progress. Mounted last so it sits on top. -->
<SystemPowerOverlay />

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, "Segoe UI", Roboto, sans-serif;
    /*
     * auto (not hidden): invisible while the shell matches the viewport, but
     * when the window drops below the shell's 320×640 minimum (below) the
     * window scrolls instead of clipping the UI.
     */
    overflow: auto;
  }

  /*
   * The whole shell is one CSS grid with three rows:
   *   auto  — header sizes to its content (72px in Header.svelte today)
   *   1fr   — main takes ALL remaining space, no matter the viewport height
   *   auto  — footer sizes to its content (40px today)
   *
   * This is the responsive part: change the panel size or rotate the display
   * and main stretches/shrinks to fit. No JavaScript, no media queries
   * required for the layout itself.
   */
  .app-shell {
    display: grid;
    grid-template-rows: auto 1fr auto;
    /*
     * minmax(0, 1fr) (not the implicit `auto`) pins the single column to the
     * viewport width. Without it, the widest row's min-content (the footer's
     * button strip on narrow panels) silently inflates the column, dragging
     * <main> — and every page inside it — past the right edge of the screen.
     */
    grid-template-columns: minmax(0, 1fr);
    width: 100vw;
    /* The app never lays out smaller than 320×640 — below that the window
       scrolls (body overflow: auto above) rather than squeezing the UI. */
    min-width: 320px;
    min-height: 640px;
    /*
     * 100dvh ("dynamic viewport height") handles mobile browser chrome
     * showing/hiding. On a Crestron panel it just resolves to 100vh, but
     * it's a good default for anything that might also run in a browser
     * tab during development.
     */
    height: 100dvh;
    overflow: hidden;
  }

  .app-main {
    position: relative;
    overflow: hidden;
  }
</style>
