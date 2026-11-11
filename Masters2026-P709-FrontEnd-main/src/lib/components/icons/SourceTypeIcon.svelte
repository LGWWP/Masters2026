<script lang="ts">
  // -----------------------------------------------------------------------------
  // SourceTypeIcon.svelte — picks the right glyph for a Source's `type`
  // -----------------------------------------------------------------------------
  // One built-in icon per known SourceType. "other" is special: it renders the
  // server-supplied `iconSvg` (from GetRoomConfiguration) when present, and
  // falls back to a generic default icon when it isn't. Every other type
  // always uses its own built-in icon — `iconSvg` is ignored for them, since
  // the type itself already has a well-defined glyph.
  import type { Source } from '../../stores/sources.svelte';
  import SourceIcon from './SourceIcon.svelte';
  import TvIcon from './TvIcon.svelte';
  import OhpIcon from './OhpIcon.svelte';
  import WirelessPresenterIcon from './WirelessPresenterIcon.svelte';
  import LaptopHdmiIcon from './LaptopHdmiIcon.svelte';
  import LaptopUsbcIcon from './LaptopUsbcIcon.svelte';

  type Props = {
    /** The source whose type (and, for "other", iconSvg) selects the glyph. */
    type: Source['type'];
    /** Custom glyph for type "other" — ignored for every other type. */
    iconSvg?: string | null;
    /** CSS size (any length). Defaults to 1em so it tracks font-size. */
    size?: string | number;
    /** Extra classes to merge onto the rendered icon. */
    class?: string;
  };

  let { type, iconSvg = null, size = '1em', class: className = '' }: Props = $props();
</script>

{#if type === 'tv'}
  <TvIcon {size} class={className} />
{:else if type === 'ohp'}
  <OhpIcon {size} class={className} />
{:else if type === 'wirelessPresenter'}
  <WirelessPresenterIcon {size} class={className} />
{:else if type === 'laptopHdmi'}
  <LaptopHdmiIcon {size} class={className} />
{:else if type === 'laptopUsbC'}
  <LaptopUsbcIcon {size} class={className} />
{:else if iconSvg}
  <!--
    Server-supplied glyph for an "other" source. The strings come from the
    Crestron program's own room configuration (not end-user input), and are
    expected to be inline <svg> markup using `currentColor` so they pick up
    the surrounding text color the same way the built-in icons do.
  -->
  <span class="custom-icon {className}" style="width: {size}; height: {size};">
    {@html iconSvg}
  </span>
{:else}
  <SourceIcon {size} class={className} />
{/if}

<style>
  .custom-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .custom-icon :global(svg) {
    width: 100%;
    height: 100%;
  }
</style>
