<!--
  SystemPowerOverlay.svelte
  =============================================================================
  A full-screen layer with two jobs. It shows only when one of them applies:

    1. Confirmation: the user tapped the power button while the system is on,
       so ask "Shut down the system?" before doing it.
    2. Progress: the system is starting up or shutting down (state "starting"
       or "stopping"). Because the state comes from the server, EVERY panel
       shows this at the same time, not only the one that was tapped.

  Mounted once in App.svelte, above everything else (including EdgeMenu).
-->

<svelte:options runes />

<script lang="ts">
  import { fade } from 'svelte/transition';
  import { systemState, powerUi, isTransitioning } from '../../stores/system.svelte';
  import { setSystemPower } from '../../transport/system';

  const busy = $derived(isTransitioning());

  // Only ask for confirmation while the system is actually on. If another
  // panel already shut it down, a stale dialog would make no sense.
  const confirming = $derived(powerUi.confirmOpen && systemState.current === 'on');

  const visible = $derived(busy || confirming);

  // While the overlay fades out, the state has already changed, so a plain
  // derived value would flip to the wrong content mid-fade. These remember the
  // last meaningful value and keep showing it until the overlay is gone.
  let lastMode: 'progress' | 'confirm' = 'progress';
  const mode = $derived.by(() => {
    if (busy) lastMode = 'progress';
    else if (confirming) lastMode = 'confirm';
    return lastMode;
  });

  let lastTitle = 'Starting up…';
  const title = $derived.by(() => {
    if (systemState.current === 'starting') lastTitle = 'Starting up…';
    else if (systemState.current === 'stopping') lastTitle = 'Shutting down…';
    return lastTitle;
  });

  // $effect runs after the state changes. Here it resets the confirm flag when
  // it can no longer apply, so the dialog cannot re-appear later by surprise.
  $effect(() => {
    if (systemState.current !== 'on' && powerUi.confirmOpen) {
      powerUi.confirmOpen = false;
    }
  });

  function cancel() {
    powerUi.confirmOpen = false;
  }

  function confirmShutdown() {
    powerUi.confirmOpen = false;
    setSystemPower(false);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && confirming) cancel();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if visible}
  <!-- transition:fade fades the layer in and out; Svelte handles the timing. -->
  <div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="power-title"
    transition:fade={{ duration: 200 }}
  >
    <div class="panel">
      {#if mode === 'progress'}
        <div class="spinner" aria-hidden="true"></div>
        <!-- aria-live makes screen readers announce the state change. -->
        <h2 id="power-title" aria-live="polite">{title}</h2>
        <p>Please wait</p>
      {:else}
        <h2 id="power-title">Shut down the system?</h2>
        <p>Displays and audio will turn off.</p>
        <div class="actions">
          <button type="button" class="btn" onclick={cancel}>Cancel</button>
          <button type="button" class="btn danger" onclick={confirmShutdown}>Shut Down</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    /* Above EdgeMenu, which uses z-index 1000-1003. */
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--overlay);
  }

  .panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    min-width: 320px;
    padding: 2rem 2.5rem;
    text-align: center;
    background: rgb(var(--panel));
    border: 1px solid rgb(var(--ink) / 0.1);
    border-radius: 16px;
    box-shadow: 0 10px 40px rgb(var(--shadow-rgb) / 0.4);
  }

  h2 {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 600;
    color: rgb(var(--ink) / 0.92);
  }

  p {
    margin: 0;
    font-size: 0.95rem;
    color: rgb(var(--ink) / 0.55);
  }

  /* A ring with one coloured edge, rotated forever. */
  .spinner {
    width: 56px;
    height: 56px;
    margin-bottom: 0.5rem;
    border: 4px solid rgb(var(--ink) / 0.12);
    border-top-color: var(--accent-cyan);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner { animation-duration: 3s; }
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .btn {
    appearance: none;
    min-width: 120px;
    min-height: 48px; /* large enough for a finger on a touch panel */
    padding: 0 1.25rem;
    border: 1px solid rgb(var(--ink) / 0.15);
    border-radius: 10px;
    background: rgb(var(--ink) / 0.06);
    color: rgb(var(--ink) / 0.85);
    font: inherit;
    font-size: 1rem;
    cursor: pointer;
  }

  .btn:active {
    transform: scale(0.97);
  }

  .btn.danger {
    background: var(--danger-bg-strong);
    border-color: var(--danger-ink);
    color: var(--danger-ink);
  }
</style>
