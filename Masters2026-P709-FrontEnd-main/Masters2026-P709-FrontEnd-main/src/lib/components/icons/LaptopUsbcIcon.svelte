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
    Minimal laptop glyph with a USB-C connector badge:
      1. Lid: a rounded rectangle (the screen).
      2. Base: a flat trapezoid-ish line under the lid (the keyboard deck).
      3. Badge: a small stadium (pill) shaped USB-C connector in the
         bottom-right corner — the detail that distinguishes this from the
         HDMI variant.
  -->

  <!-- Lid -->
  <rect x="4" y="4" width="13" height="9" rx="1.2" />

  <!-- Base -->
  <path d="M2.5 16.5h18l-1.3 2.3a1.5 1.5 0 0 1-1.3.7H5.1a1.5 1.5 0 0 1-1.3-.7z" />

  <!-- USB-C connector badge (rounded/stadium plug) -->
  <rect x="16" y="14" width="6" height="3.6" rx="1.8" />
</svg>
