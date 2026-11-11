<!--
  OhpControls.svelte
  =============================================================================
  Control panel for `type: "ohp"` sources (overhead projector).

  There is no backend/transport support yet for projector power, lens
  shutter, or freeze commands, so this is informational text rather than
  interactive controls.
-->

<svelte:options runes />

<script lang="ts">
  import type { Source } from '../../../stores/sources.svelte';
  import SourceTypeIcon from '../../icons/SourceTypeIcon.svelte';

  type Props = { source: Source };
  let { source }: Props = $props();
</script>

<div class="type-controls">
  <SourceTypeIcon type={source.type} iconSvg={source.iconSvg} size="2.5rem" class="type-controls__icon" />
  <p class="message">
    <strong>{source.name}</strong> is selected. Use the projector's own
    remote or control panel for power, lens shutter, and image freeze — this
    panel does not control the projector directly.
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
