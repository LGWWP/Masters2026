<!--
  Header.svelte
  =============================================================================
  The top bar of the app. Shows:
  Date/Time, Room Name with connection status dot, and company logo.
-->

<svelte:options runes />  <!-- enable Svelte reactive statements -->

<script lang="ts">
  import { appStatus } from '../../transport/signalr.svelte';  // get the current application connection status
  import { bridgeStatus } from '../../stores/connection.svelte';  // CIP/WS status from the Crestron bridge (crestron/xpanel.ts)
  import CompanyLogo from '../../../assets/crestron_logo_ko_cmyk.png'; // import the company logo image
  import PowerButton from './PowerButton.svelte';
  import { roomState } from '../../stores/room.svelte';
  import { onMount } from 'svelte';

  // Tri-state status dot over every transport that applies in this run mode.
  // bridgeStatus.cip/ws are `null` when not applicable (e.g. WS is managed by
  // the container app itself when embedded in a touchscreen) — filtered out
  // so the dot only considers transports that actually exist here.
  // appStatus.isConnected (SignalR) always applies, so this is never empty.
  const applicableTransports = $derived(
    [bridgeStatus.cip, bridgeStatus.ws, appStatus.isConnected].filter(
      (status): status is boolean => status !== null
    )
  );
  const connectionStatus = $derived.by<'online' | 'offline' | 'partial'>(() => {
    if (applicableTransports.every((up) => up)) return 'online';
    if (applicableTransports.every((up) => !up)) return 'offline';
    return 'partial';
  });

  let now = $state(new Date());

  onMount(() => {
    const interval = setInterval(() => { now = new Date(); }, 1000);
    return () => clearInterval(interval);
  });

  // format the current date and time for display
  const formattedDate = $derived(
    now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  );
  const formattedTime = $derived(
    now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
</script>

<header class="app-header">
  <div class="col-left">
    <span class="date">{formattedDate}</span>
    <span class="time">{formattedTime}</span>
  </div>

  <div class="col-center">
    <span
      class="status-dot"
      class:online={connectionStatus === 'online'}
      class:partial={connectionStatus === 'partial'}
      class:offline={connectionStatus === 'offline'}
      aria-label={connectionStatus === 'online' ? 'Connected' : connectionStatus === 'partial' ? 'Partially connected' : 'Offline'}
    ></span>
    <span class="title">{roomState.name}</span>
  </div>

  <div class="col-right">
    <PowerButton />
    <img src={CompanyLogo} alt="Company Logo" class="company-logo" />
  </div>
</header>

<style>
  .app-header {
    display: grid;
    /* minmax(0, auto) lets the centre (room name) column compress below its
       single-line width when the header is tight, so the title wraps to a
       second line instead of shoving the date/time and logo aside. */
    grid-template-columns: 1fr minmax(0, auto) 1fr;
    align-items: center;
    padding: 0 1.25rem;
    height: 82px;
    background-color: rgb(var(--panel) / 0.85);
    border-bottom: 1px solid rgb(var(--ink) / 0.08);
  }

  .col-left {
    display: flex;
    flex-direction: column;
    justify-content: center;
    /* Shrink-wrap: the grid track is 1fr (it balances the title centring),
       but the date/time boxes themselves only span their text instead of
       stretching across all the leftover space to the right. */
    width: fit-content;
    align-items: flex-start;
    gap: 0.1rem;
  }

  /* Portrait, or a small landscape panel: not enough room for date/time. */
  @media (orientation: portrait), (orientation: landscape) and (max-width: 900px) {
    .col-left {
      display: none;
    }

    /* With .col-left gone, the 3-column grid (1fr auto 1fr) still reserves
       an empty first track, leaving the title stranded mid-bar instead of
       next to the now-missing date/time, and the logo short of the actual
       right edge. Flex + space-between instead: title stays left, the
       power button/logo anchor to the right, using all the freed space. */
    .app-header {
      display: flex;
      justify-content: space-between;
    }

    /* Keep the column shrinkable in the flex layout; the two-line clamp on
       the title itself lives in the base rule below. */
    .col-center {
      flex: 1;
      min-width: 0;
    }
  }

  .col-left .date {
    font-size: 0.75rem;
    color: rgb(var(--ink) / 0.55);
    letter-spacing: 0.03em;
    /* Never wrap: a long room name compresses the side tracks, and a wrapped
       date/time would spill out of the fixed-height header band. */
    white-space: nowrap;
  }

  .col-left .time {
    font-size: 1rem;
    font-weight: 600;
    color: rgb(var(--ink) / 0.92);
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .col-center {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0; /* let the title shrink/wrap instead of forcing overflow */
  }

  .col-center .title {
    /* Fluid: shrinks smoothly with the viewport (~16px at 360px wide,
       capped at the original 1.5rem on full-size panels) — no breakpoint
       jump. */
    font-size: clamp(0.95rem, 0.55rem + 1.8vw, 1.5rem);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: rgb(var(--ink) / 0.92);
    /* Long room names wrap to a second line when there isn't room for one,
       then ellipsize — never a third line, which would spill out of the
       fixed-height header band. */
    min-width: 0;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    line-height: 1.25;
  }

  /* Very small panels: even the clamped two-line name crowds the power
     button and logo, so drop it entirely. The connection status dot stays —
     it's tiny and still useful. (After the base rule above so its
     display:none wins at equal specificity.) */
  @media (max-width: 480px) {
    .col-center .title {
      display: none;
    }
  }

  .col-right {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 1rem;
  }

  .company-logo {
    /* Fluid like the title: ~22px on a 360px-wide panel up to the original
       36px on full-size displays. */
    height: clamp(20px, 8px + 2.8vw, 36px);
    width: auto;
    filter: var(--logo-filter);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background-color 200ms ease;
  }

  .status-dot.online {
    background-color: #4ade80;
  }

  .status-dot.partial {
    background-color: #fb923c;
  }

  .status-dot.offline {
    background-color: #f87171;
  }
</style>