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
    Minimal window-with-blinds glyph:
      1. Window frame: a rounded square.
      2. Two horizontal slats dividing the pane into three bands — reads
         instantly as "blinds/shades" without extra clutter.
  -->

  <!-- Window frame -->
  <rect x="4" y="4" width="16" height="16" rx="1" />

  <!-- Slats -->
  <path d="M4 9h16M4 14h16" />
</svg>
