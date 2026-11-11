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
    Minimal house glyph:
      1. Outer silhouette: roof peak + walls + floor as one closed pentagon,
         so the eaves join cleanly with stroke-linejoin.
      2. Door: an inverted "U" centered on the base.
  -->

  <!-- House outline -->
  <path d="M3 10 12 3l9 7v11H3z" />

  <!-- Door -->
  <path d="M10 21v-6h4v6" />
</svg>
