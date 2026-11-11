<!--
  TvControls.svelte
  =============================================================================
  Control panel for `type: "tv"` sources.

  There is no backend/transport support yet for TV power, channel, or input
  commands (only source *selection* and room-wide volume exist today — see
  transport/sources.ts and transport/volume.ts), so this is informational
  text rather than interactive controls.
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
    <strong>{source.name}</strong> is selected. Use the TV's own remote to
    change the channel or switch inputs — this panel does not control the
    TV directly.
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
