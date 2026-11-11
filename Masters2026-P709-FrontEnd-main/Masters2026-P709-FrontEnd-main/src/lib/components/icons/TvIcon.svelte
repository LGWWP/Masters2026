<script lang="ts">
  type Props = {
    /** CSS size (any length). Defaults to 1em so it tracks font-size. */
    size?: string | number;
    /** Extra classes to merge onto the <svg>. */
    class?: string;
  };

  let { size = '1em', class: className = '', ...rest }: Props = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size}
     fill="none" stroke="currentColor" stroke-width="1.75"
     stroke-linecap="round" stroke-linejoin="round"
     aria-hidden="true" class={className} {...rest}>
  <!--
    Minimal flat-panel TV glyph:
      1. Wide screen: a rounded rectangle, flatter/wider than the generic
         monitor glyph so it reads as "TV" rather than a desktop display.
      2. Splayed stand legs instead of a single pedestal — distinguishes it
         from SourceIcon's monitor-on-a-neck silhouette.
  -->

  <!-- Screen -->
  <rect x="2.5" y="5" width="19" height="12" rx="1.5" />

  <!-- Splayed stand legs -->
  <path d="M8 20l2.5-3M16 20l-2.5-3" />
</svg>
