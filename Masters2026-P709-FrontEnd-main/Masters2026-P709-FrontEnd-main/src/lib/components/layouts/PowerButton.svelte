<!--
  PowerButton.svelte
  =============================================================================
  The small round power button shown in the header. It is shutdown-only: the
  system is started by selecting a source on the Sources page instead (the
  server starts the system if needed when a source is chosen).

  What a tap does depends on the current system state:

    disconnected -> button is disabled until the connection returns
    off        -> inert; the button is disabled (nothing to shut down)
    on         -> open the "Shut down?" confirmation (a stray tap should not
                  turn off a room that is in a meeting)
    starting / stopping -> button is disabled; the overlay shows progress

  Colour reflects systemState.current at a glance:
    off                 -> red
    on                  -> green
    starting / stopping -> neutral, with a pulsing animation (see .busy below)

  The button never changes the state itself. It asks the transport
  (setSystemPower), and the state arrives back from the server through the
  store, so it always reflects what really happened.
-->

<svelte:options runes />

<script lang="ts">
  import PowerIcon from '../icons/PowerIcon.svelte';
  import { systemState, powerUi, isTransitioning } from '../../stores/system.svelte';
  import { bridgeStatus } from '../../stores/connection.svelte';
  import { appStatus } from '../../transport/signalr.svelte';

  // $derived re-computes whenever the store changes, so these stay current.
  const connected = $derived(
    (bridgeStatus.cip ?? true) && (bridgeStatus.ws ?? true) && appStatus.isConnected
  );
  const busy = $derived(isTransitioning());
  const isOn = $derived(systemState.current === 'on');
  const disabled = $derived(!connected || busy || !isOn);

  const label = $derived(
    !connected ? 'System power: offline' : busy ? 'System power: please wait' : isOn ? 'Shut down system' : 'System is off'
  );

  function onTap() {
    if (disabled) return;

    powerUi.confirmOpen = true; // the overlay component renders the dialog
  }
</script>

<button
  type="button"
  class="power-button"
  class:off={!isOn && !busy}
  class:on={isOn}
  class:busy
  class:offline={!connected}
  {disabled}
  aria-label={label}
  title={label}
  onclick={onTap}
>
  <PowerIcon size="1.4rem" />
</button>

<style>
  .power-button {
    appearance: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid rgb(var(--ink) / 0.15);
    background: rgb(var(--ink) / 0.05);
    color: rgb(var(--ink) / 0.55);
    cursor: pointer;
    transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease;
  }

  /* System is off: red, so it reads as "needs attention / not running". */
  .power-button.off {
    color: #f87171;
    border-color: rgb(248 113 113 / 0.5);
    background: rgb(248 113 113 / 0.12);
  }

  /* System is on: green, so it reads as "active" at a glance. Same colours
     as the connection status dot in Header.svelte, for consistency. */
  .power-button.on {
    color: #4ade80;
    border-color: rgb(74 222 128 / 0.5);
    background: rgb(74 222 128 / 0.12);
  }

  .power-button:active:not(:disabled) {
    transform: scale(0.94);
  }

  /* Warming up / cooling down: gentle pulse while the button is locked. */
  .power-button.busy {
    cursor: default;
    animation: power-pulse 1.2s ease-in-out infinite;
  }

  @keyframes power-pulse {
    50% { opacity: 0.45; }
  }

  @media (prefers-reduced-motion: reduce) {
    .power-button.busy { animation: none; opacity: 0.6; }
  }

  .power-button.offline {
    opacity: 0.35;
    cursor: not-allowed;
    animation: none;
  }
</style>
