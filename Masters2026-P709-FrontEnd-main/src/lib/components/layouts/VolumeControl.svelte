<!--
  VolumeControl.svelte
  =============================================================================
  Footer volume control. Two buttons side by side:

    [ speaker ]  mute / unmute in one tap
    [ 42%     ]  opens a flyout with a large slider and -/+ buttons

  Like every control in this app it never changes the volume itself. It sends
  the request through the transport (setVolume / setMute) and the new value
  arrives back in volumeState from the server.

  While the control system is offline (SignalR or the CIP/WS bridge down),
  every control here is disabled — commands would just be dropped anyway.
-->

<svelte:options runes />

<script lang="ts">
  import SpeakerIcon from '../icons/SpeakerIcon.svelte';
  import Flyout from '../ui/Flyout.svelte';
  import { toggleFlyout } from '../../stores/flyout.svelte';
  import { volumeState } from '../../stores/volume.svelte';
  import { setVolume, setMute } from '../../transport/volume';
  import { appStatus } from '../../transport/signalr.svelte';
  import { bridgeStatus } from '../../stores/connection.svelte';

  const FLYOUT_ID = 'volume';
  const STEP = 5; // size of the -/+ buttons

  // Same "control system offline" test as Footer/PowerButton: every
  // applicable transport must be up, otherwise volume commands would just be
  // dropped — so the buttons are disabled instead of silently doing nothing.
  const connected = $derived(
    (bridgeStatus.cip ?? true) && (bridgeStatus.ws ?? true) && appStatus.isConnected
  );

  // While the slider is being dragged we show the drag position (the "draft")
  // instead of the confirmed level; otherwise the thumb would jump back until
  // the server echo arrives. Same idea as the sliders on the Lights page.
  let draft = $state<number | null>(null);
  const shown = $derived(draft ?? volumeState.level);

  // Drop the draft once the server has confirmed the same value.
  $effect(() => {
    if (draft !== null && volumeState.level === draft) draft = null;
  });

  function onInput(e: Event) {
    draft = Number((e.target as HTMLInputElement).value);
  }

  // `change` fires when the finger is released, so we send one command per drag.
  function onChange(e: Event) {
    const level = Number((e.target as HTMLInputElement).value);
    draft = level;
    setVolume(level);
  }

  function nudge(delta: number) {
    const level = Math.max(0, Math.min(100, shown + delta));
    draft = level;
    setVolume(level);
  }
</script>

<div class="volume">
  <button
    type="button"
    class="icon-btn"
    class:muted={volumeState.muted}
    aria-label={volumeState.muted ? 'Unmute' : 'Mute'}
    aria-pressed={volumeState.muted}
    disabled={!connected}
    onclick={() => setMute(!volumeState.muted)}
  >
    <SpeakerIcon size="1.5rem" muted={volumeState.muted} />
  </button>

  <!-- data-flyout-trigger lets the Flyout ignore taps on this button. -->
  <button
    type="button"
    class="level-btn"
    data-flyout-trigger={FLYOUT_ID}
    aria-label="Volume {shown}%"
    disabled={!connected}
    onclick={() => toggleFlyout(FLYOUT_ID)}
  >
    {volumeState.muted ? 'Muted' : `${shown}%`}
  </button>

  <Flyout id={FLYOUT_ID}>
    <div class="flyout-body">
      <button type="button" class="step-btn" aria-label="Volume down" disabled={!connected} onclick={() => nudge(-STEP)}>−</button>

      <input
        type="range"
        class="slider"
        min="0" max="100" step="1"
        value={shown}
        style="--pct: {shown}%"
        aria-label="Volume"
        disabled={!connected}
        oninput={onInput}
        onchange={onChange}
      />

      <button type="button" class="step-btn" aria-label="Volume up" disabled={!connected} onclick={() => nudge(STEP)}>+</button>
    </div>
  </Flyout>
</div>

<style>
  /* position: relative anchors the Flyout, which is positioned inside it. */
  .volume {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .icon-btn,
  .level-btn,
  .step-btn {
    appearance: none;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    border: 1px solid rgb(var(--ink) / 0.15);
    border-radius: 10px;
    background: rgb(var(--ink) / 0.05);
    color: rgb(var(--ink) / 0.8);
    font: inherit;
    cursor: pointer;
  }

  .icon-btn { width: 44px; }
  .icon-btn.muted {
    color: var(--danger-ink);
    border-color: var(--danger-ink);
    background: var(--danger-bg);
  }

  .level-btn {
    min-width: 64px;
    padding: 0 0.75rem;
    font-size: 0.95rem;
    font-variant-numeric: tabular-nums;
  }

  .icon-btn:active:not(:disabled),
  .level-btn:active:not(:disabled),
  .step-btn:active:not(:disabled) {
    transform: scale(0.96);
  }

  /* Offline: the control system can't receive commands, so the whole cluster
     is disabled (same treatment as the nav buttons in Footer.svelte). */
  .icon-btn:disabled,
  .level-btn:disabled,
  .step-btn:disabled,
  .slider:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .flyout-body {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 320px;
  }

  .step-btn {
    flex-shrink: 0;
    width: 44px;
    font-size: 1.4rem;
  }

  /* Slider: same look as the dimmers on the Lights page. */
  .slider {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    height: 26px;
    background: transparent;
    cursor: pointer;
    outline: none;
    border: none;
  }
  .slider::-webkit-slider-runnable-track {
    height: 18px;
    border-radius: 9px;
    background: linear-gradient(
      to right,
      rgb(var(--accent-rgb) / 0.35) 0%,
      var(--accent-cyan) var(--pct, 0%),
      rgb(var(--ink) / 0.1) var(--pct, 0%),
      rgb(var(--ink) / 0.1) 100%
    );
  }
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow:
      0 0 0 3px rgb(var(--accent-rgb) / 0.3),
      0 2px 8px rgb(var(--shadow-rgb) / 0.5);
  }
  .slider::-moz-range-track {
    height: 18px;
    border-radius: 9px;
    background: rgb(var(--ink) / 0.1);
  }
  .slider::-moz-range-progress {
    height: 18px;
    border-radius: 9px;
    background: linear-gradient(to right, rgb(var(--accent-rgb) / 0.35) 0%, var(--accent-cyan) 100%);
  }
  .slider::-moz-range-thumb {
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 50%;
    background: #ffffff;
    box-shadow:
      0 0 0 3px rgb(var(--accent-rgb) / 0.3),
      0 2px 8px rgb(var(--shadow-rgb) / 0.5);
  }

  /* Narrow panels: the 320px-wide horizontal slider row doesn't fit, so the
     flyout goes vertical — [+] on top, slider, [−] at the bottom
     (column-reverse keeps the DOM/focus order −, slider, +). Placed after
     the base .slider rules above so it wins at equal specificity. */
  @media (max-width: 480px) {
    .flyout-body {
      flex-direction: column-reverse;
      width: auto;
    }

    /* vertical-lr + rtl renders the native range vertically with 0 at the
       bottom; the fill gradient flips to match (to top). */
    .slider {
      writing-mode: vertical-lr;
      direction: rtl;
      flex: none;
      width: 26px;
      height: 200px;
    }

    .slider::-webkit-slider-runnable-track {
      width: 18px;
      height: 100%;
      background: linear-gradient(
        to top,
        rgb(var(--accent-rgb) / 0.35) 0%,
        var(--accent-cyan) var(--pct, 0%),
        rgb(var(--ink) / 0.1) var(--pct, 0%),
        rgb(var(--ink) / 0.1) 100%
      );
    }

    .slider::-moz-range-track {
      width: 18px;
      height: 100%;
    }

    .slider::-moz-range-progress {
      width: 18px;
      height: auto;
      background: linear-gradient(to top, rgb(var(--accent-rgb) / 0.35) 0%, var(--accent-cyan) 100%);
    }
  }
</style>
