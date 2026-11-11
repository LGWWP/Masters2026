<!--
  OtherControls.svelte
  =============================================================================
  Fallback control panel for `type: "other"` sources (and any unrecognized
  type the server might send — see normalizeSource() in
  transport/signalr.svelte.ts, which downgrades unknown types to "other").

  There is no well-defined control surface for an arbitrary "other" source,
  so this just confirms what's selected rather than inventing controls that
  don't map to anything real.
-->

<svelte:options runes />

<script lang="ts">
  import type { Source } from '../../../stores/sources.svelte';
  import SourceTypeIcon from '../../icons/SourceTypeIcon.svelte';

  type Props = { source: Source };
  let { source }: Props = $props();
</script>

<div class="other-controls">
  <SourceTypeIcon type={source.type} iconSvg={source.iconSvg} size="2.5rem" class="other-controls__icon" />
  <p class="message">
    <strong>{source.name}</strong> is selected. No additional controls are
    available for this source.
  </p>
</div>

<style>
  .other-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  :global(.other-controls__icon) {
    color: rgb(var(--ink) / 0.55);
    flex-shrink: 0;
  }

  .message {
    margin: 0;
    opacity: 0.75;
    line-height: 1.5;
  }
</style>
