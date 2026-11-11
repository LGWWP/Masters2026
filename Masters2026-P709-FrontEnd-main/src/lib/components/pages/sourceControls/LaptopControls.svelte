<!--
  LaptopControls.svelte
  =============================================================================
  Control panel for `type: "laptopHdmi"` and `type: "laptopUsbC"` sources.
  Shared between both since the only real difference is which cable the
  user needs to plug in.

  There is no backend/transport support yet for live cable-detect state, so
  this is informational text rather than interactive controls.
-->

<svelte:options runes />

<script lang="ts">
  import type { Source } from '../../../stores/sources.svelte';
  import SourceTypeIcon from '../../icons/SourceTypeIcon.svelte';

  type Props = {
    source: Source;
    /** Which cable this source expects. */
    connector: 'HDMI' | 'USB-C';
  };
  let { source, connector }: Props = $props();
</script>

<div class="type-controls">
  <SourceTypeIcon type={source.type} iconSvg={source.iconSvg} size="2.5rem" class="type-controls__icon" />
  <p class="message">
    <strong>{source.name}</strong> is selected. Connect your laptop using the
    room's {connector} cable to present on the room's displays.
    {#if connector === 'USB-C'}
      A single USB-C cable also carries power and audio where supported.
    {/if}
  </p>
</div>

<style>
  .type-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  :global(.type-controls__icon) {
    color: rgb(var(--ink) / 0.55);
    flex-shrink: 0;
  }

  .message {
    margin: 0;
    opacity: 0.75;
    line-height: 1.5;
  }
</style>
