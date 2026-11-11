<svelte:options runes />

<script lang="ts">
  import SourceIcon from '../../icons/SourceIcon.svelte';
  import { systemState } from '../../../stores/system.svelte';

  let { url }: { url: string | null } = $props();
  let failed = $state(false);

  // Each refresh arrives as a NEW cache-busted url (see SourceSelection), so
  // clearing the failure flag here makes the preview retry automatically on
  // the next refresh instead of staying stuck on "Preview unavailable".
  $effect(() => {
    void url;
    failed = false;
  });

  function closeStreamOnDestroy(image: HTMLImageElement) {
    return { destroy: () => { image.removeAttribute('src'); } };
  }

  // The room's displays are off whenever the system isn't "on", so there is
  // no snapshot to show — just the empty outline, not a "Preview unavailable"
  // error (that's reserved for a real failure while the system is on).
  const systemOn = $derived(systemState.current === 'on');
  const showImage = $derived(systemOn && !!url && !failed);
  const showFailed = $derived(systemOn && failed);
</script>

<div class="display-preview" role="region" aria-label="Display preview">
  <div class="display-preview__placeholder" aria-hidden={showImage}>
    {#if !showFailed}
      <SourceIcon size="3rem" />
    {/if}
    <span>Display Preview</span>
    {#if showFailed}
      <p role="status">Preview unavailable</p>
      <button type="button" onclick={() => { failed = false; }}>Retry</button>
    {/if}
  </div>

  {#if showImage}
    <!-- Snapshot of the display output; the parent bumps a cache-busting
         param in `url` to refresh it. The action clears src on unmount so
         any in-flight request is dropped. -->
    <img use:closeStreamOnDestroy src={url} alt="Live preview of the room display" onerror={() => { failed = true; }} />
  {/if}
</div>

<style>
  .display-preview {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border: 1px solid rgb(var(--ink) / 0.05);
    border-radius: 1.25rem;
    background: rgb(var(--plan-bg));
    box-sizing: border-box;
  }

  .display-preview__placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1rem;
    color: rgb(var(--ink) / 0.55);
    text-align: center;
  }

  .display-preview__placeholder span {
    font-size: clamp(1rem, 2.5vw, 1.5rem);
    line-height: 1.25;
  }

  .display-preview__placeholder p {
    margin: 0;
    font-size: 0.85rem;
  }

  .display-preview__placeholder button {
    min-height: 44px;
    padding: 0.35rem 1rem;
    border: 1px solid rgb(var(--ink) / 0.2);
    border-radius: 0.5rem;
    background: rgb(var(--ink) / 0.06);
    color: rgb(var(--ink) / 0.85);
    font: inherit;
    cursor: pointer;
  }

  .display-preview__placeholder button:focus-visible {
    outline: 2px solid var(--accent-cyan);
    outline-offset: 3px;
  }

  .display-preview img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }
</style>
