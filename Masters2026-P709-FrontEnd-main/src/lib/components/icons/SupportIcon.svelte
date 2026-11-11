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
    Minimal support-headset glyph:
      1. Headband: an arc across the top of the head.
      2. Ear cups: two rounded rectangles hanging from each end of the band.
      3. Boom mic: a short cord from the right ear cup that curves down
         toward the chin — the visual cue that turns a "headphones" icon
         into a "support agent" icon.
  -->

  <!-- Headband arc -->
  <path d="M4 13a8 8 0 0 1 16 0" />

  <!-- Left ear cup -->
  <path d="M3 13h4v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />

  <!-- Right ear cup -->
  <path d="M17 13h4v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z" />

  <!-- Boom mic -->
  <path d="M20 20v1a2 2 0 0 1-2 2h-4" />
</svg>
