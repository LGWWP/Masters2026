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
    Minimal laptop glyph with an HDMI connector badge:
      1. Lid: a rounded rectangle (the screen).
      2. Base: a flat trapezoid-ish line under the lid (the keyboard deck).
      3. Badge: a small five-sided HDMI connector shape in the bottom-right
         corner — the detail that distinguishes this from the USB-C variant.
  -->

  <!-- Lid -->
  <rect x="4" y="4" width="13" height="9" rx="1.2" />

  <!-- Base -->
  <path d="M2.5 16.5h18l-1.3 2.3a1.5 1.5 0 0 1-1.3.7H5.1a1.5 1.5 0 0 1-1.3-.7z" />

  <!-- HDMI connector badge (trapezoid plug) -->
  <path d="M16.5 15l1.2-1.6h3.6l1.2 1.6v3h-6z" />
</svg>
