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
    Minimal "cast to screen" glyph for a wireless presenter (e.g. AirMedia):
      1. Screen: a rounded rectangle, same family as the other source icons.
      2. Wi-Fi arcs: two concentric arcs plus a dot above the screen,
         reading as "wireless signal being sent".
  -->

  <!-- Screen -->
  <rect x="3" y="9" width="18" height="11" rx="1.5" />

  <!-- Wi-Fi arcs -->
  <path d="M8.5 9c1.1-1.7 2.9-2.7 4.9-2.7s3.8 1 4.9 2.7" />
  <path d="M10.3 9c.6-.8 1.4-1.2 2.3-1.2s1.7.4 2.3 1.2" />
  <circle cx="13.4" cy="4.3" r="0.9" fill="currentColor" stroke="none" />
</svg>
