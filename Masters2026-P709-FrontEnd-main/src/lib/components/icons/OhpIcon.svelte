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
    Minimal overhead-projector glyph:
      1. Body: a low, wide rounded box sitting on the surface.
      2. Lens: a small circle on top of the body.
      3. Projection rays: two short diverging lines above the lens,
         suggesting light being cast upward onto a screen.
  -->

  <!-- Body -->
  <rect x="3" y="13" width="18" height="6" rx="1.5" />

  <!-- Lens barrel -->
  <path d="M12 13v-2.5" />
  <circle cx="12" cy="8.5" r="2" />

  <!-- Projection rays -->
  <path d="M9.3 4.3l1 1.6M14.7 4.3l-1 1.6" />
</svg>
