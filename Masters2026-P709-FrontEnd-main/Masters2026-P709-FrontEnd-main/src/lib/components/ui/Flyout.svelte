<!--
  Flyout.svelte
  =============================================================================
  A small panel that pops up ABOVE its trigger button (used from the footer).

  How to use it: put the trigger button and the Flyout together inside one
  wrapper that has `position: relative`, give both the same `id`, and mark the
  trigger with data-flyout-trigger={id}:

    <div class="wrap">                          <- position: relative
      <button data-flyout-trigger="volume" onclick={() => toggleFlyout('volume')}>
      <Flyout id="volume"> ...content... </Flyout>
    </div>

  Behaviour:
    - Opens when flyouts.openId === id (see stores/flyout.svelte.ts).
    - Only one flyout is open at a time.
    - Tapping anywhere outside it, or pressing Escape, closes it.
-->

<svelte:options runes />

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { flyouts, closeFlyout } from '../../stores/flyout.svelte';

  type Props = {
    id: string;
    children?: Snippet;
  };

  let { id, children }: Props = $props();

  const open = $derived(flyouts.openId === id);

  // Set by bind:this; used to tell whether a tap landed inside the panel.
  let panelEl = $state<HTMLElement | null>(null);

  function onPointerDown(e: PointerEvent) {
    if (!open) return;
    const target = e.target as Element;

    // Taps inside the panel, or on its own trigger button, are not "outside".
    // (The trigger toggles the flyout itself; closing here as well would make
    // it close and immediately re-open.)
    if (panelEl?.contains(target)) return;
    if (target.closest(`[data-flyout-trigger="${id}"]`)) return;

    closeFlyout();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') closeFlyout();
  }
</script>

<svelte:window onpointerdown={onPointerDown} onkeydown={onKeyDown} />

{#if open}
  <div class="flyout" bind:this={panelEl} transition:fly={{ y: 12, duration: 180 }}>
    {@render children?.()}
  </div>
{/if}

<style>
  .flyout {
    position: absolute;
    right: 0;
    bottom: calc(100% + 12px); /* opens upward, just above the trigger */
    z-index: 900; /* below the EdgeMenu (1000+) and the power overlay (2000) */
    padding: 1rem 1.25rem;
    background: rgb(var(--panel));
    border: 1px solid rgb(var(--ink) / 0.12);
    border-radius: 14px;
    box-shadow: 0 10px 30px rgb(var(--shadow-rgb) / 0.35);
  }
</style>
