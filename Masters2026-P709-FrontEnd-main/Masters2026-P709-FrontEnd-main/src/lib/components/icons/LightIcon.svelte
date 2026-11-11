<script lang="ts">
  import { levelColor as getLevelColor } from '../../stores/theme.svelte';

  type Props = {
    /** CSS size (any length). Defaults to 1em so it tracks font-size. */
    size?: string | number;
    /** Extra classes to merge onto the <svg>. */
    class?: string;
    /** Light level (0-100). */
    level?: number;
    /** Extra styles to merge onto the <svg>. */
    style?: string;
  };

  let { size = '1em', class: className = '', level = 0, ...rest }: Props = $props();

</script>

 <div class="bulb-wrap">
  <div class="bulb" style="
              background: radial-gradient(circle, {getLevelColor(level)}, transparent 70%);
              opacity: {0.1 + level / 120};
              transform: scale({0.7 + level / 350});
            "></div>

  <svg viewBox="0 0 24 24" width={size} height={size}
      fill="none" stroke="{getLevelColor(level)}" stroke-width="1.75"
      stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true" style="filter: drop-shadow(0 0 {level/10}px {getLevelColor(level)})" class={className} {...rest}>
    <!--
      Minimal bulb glyph:
        1. Bulb body: a rounded shape that opens at the bottom, with two short
          "shoulders" curving inward to suggest the neck/base of the bulb.
        2. Base line: a single short horizontal stroke under the bulb — the
          screw base. Kept as one line (not two) so it reads clearly at 1em.
    -->

    <!-- Bulb outline -->
    <path d="M9 18c0-1.2-.5-2-1.4-2.9A6 6 0 1 1 18 11a6 6 0 0 1-1.6 4.1c-.9.9-1.4 1.7-1.4 2.9" />

    <!-- Screw base -->
    <path d="M10 21h4" />
  </svg>
</div>


<style>
    .bulb-wrap {
    position: relative;
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .bulb {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    transition: all 0.4s;
  }

  .bulb-wrap svg { position: relative; z-index: 1; transition: all 0.4s; }
</style>