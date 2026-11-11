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
    Minimal monitor-with-play glyph:
      1. Monitor screen: rounded rectangle.
      2. Stand: vertical neck + short horizontal base.
      3. Play triangle inside the screen — filled with currentColor so it
         reads clearly at small sizes. Universally recognized as "media
         source / what's playing".
  -->

  <!-- Monitor frame -->
  <rect x="3" y="5" width="18" height="12" rx="1.5" />

  <!-- Stand -->
  <path d="M12 17v4M8 21h8" />

  <!-- Play triangle (filled) -->
  <path d="M10.5 8.5v5l4.5-2.5z" fill="currentColor" />
</svg>
