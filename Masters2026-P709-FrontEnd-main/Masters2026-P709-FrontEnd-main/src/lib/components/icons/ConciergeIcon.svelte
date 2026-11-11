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
    Minimal concierge service-bell glyph:
      1. Dome: an arc covering the bell body.
      2. Knob: a short stem with a cap on top — the "ding" button.
      3. Base: the tray the dome sits on.
  -->

  <!-- Dome -->
  <path d="M4 16a8 8 0 0 1 16 0" />

  <!-- Knob stem + cap -->
  <path d="M12 8V6" />
  <path d="M10.25 6h3.5" />

  <!-- Base tray -->
  <path d="M3 16h18v1.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
</svg>
