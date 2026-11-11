<!--
  ShadePreview.svelte
  =============================================================================
  Decorative window illustration for the Shades page.

  Props:
    position  Opening percentage: 0 = closed, 100 = open.
    tilt      Slat opening percentage on the UI's scale.
    curtain   Draw two side panels that open horizontally.
    slatted   Draw slats whose thickness follows the tilt value.

  The page owns the surrounding Card and responsive layout. This component
  renders the supplied values without reading stores or sending commands.
-->

<script lang="ts">
  type Props = {
    position: number;
    tilt?: number;
    curtain?: boolean;
    slatted?: boolean;
  };

  let {
    position,
    tilt = 0,
    curtain = false,
    slatted = false,
  }: Props = $props();

  // ── Preview helper ───────────────────────────────────────────────────────────
  // Keep the CSS clipping and slat-height inputs within a whole-percent range.
  function previewStopPercent(position: number): number {
    return Math.max(0, Math.min(100, Math.round(position)));
  }
</script>

<!-- ═══════════════════════════════════════════════════════════════════════════
     Window preview
     ═══════════════════════════════════════════════════════════════════════════ -->
<!-- Position controls the opening; tilt controls the slat thickness.
     Curtain previews open horizontally using two side panels. -->
<div class="window-preview" aria-hidden="true">
  <div class="window-frame"></div>
  <div
    class="shade-layer"
    class:curtain
    class:slatted
    style="--shade-stop:{previewStopPercent(position)}%; --slat-height:{8 -
      previewStopPercent(tilt) * 0.065}%;"
  ></div>
</div>

<style>
  /* ── Animated preview property ────────────────────────────────────────────── */
  /* Register the percentage so slat thickness can interpolate during tilt. */
  @property --slat-height {
    syntax: "<percentage>";
    inherits: false;
    initial-value: 1.5%;
  }

  /* ── Window preview ───────────────────────────────────────────────────────── */
  .window-preview {
    position: relative;
    width: min(100%, 440px);
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    overflow: hidden;
    background: linear-gradient(
      180deg,
      rgb(var(--line-hi) / 0.16),
      rgb(var(--line-hi) / 0.06)
    );
    border: 1px solid rgb(var(--line-hi) / 0.45);
  }

  /* Layer gradients and silhouettes to suggest an outdoor view. */
  .window-frame {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        ellipse at 22% 24%,
        rgb(var(--surface-hi) / 0.52) 0 5%,
        transparent 23%
      ),
      radial-gradient(
        ellipse at 72% 18%,
        rgb(var(--surface-hi) / 0.36) 0 4%,
        transparent 20%
      ),
      linear-gradient(
        180deg,
        rgb(var(--accent-rgb) / 0.36),
        rgb(var(--surface-hi) / 0.3) 58%,
        rgb(var(--surface) / 0.28) 59%
      );
  }

  .window-frame::before,
  .window-frame::after {
    position: absolute;
    right: -3%;
    bottom: -2%;
    left: -3%;
    content: "";
  }

  .window-frame::before {
    height: 48%;
    background: rgb(var(--ink) / 0.15);
    clip-path: polygon(
      0 62%,
      12% 35%,
      24% 56%,
      40% 15%,
      56% 61%,
      71% 34%,
      86% 59%,
      100% 24%,
      100% 100%,
      0 100%
    );
    filter: blur(2px);
  }

  .window-frame::after {
    height: 32%;
    background: rgb(var(--ink) / 0.22);
    clip-path: polygon(
      0 47%,
      8% 30%,
      14% 48%,
      21% 22%,
      28% 50%,
      38% 36%,
      48% 58%,
      61% 28%,
      72% 52%,
      84% 25%,
      100% 46%,
      100% 100%,
      0 100%
    );
    filter: blur(1px);
  }

  /* ── Roller and slatted shades ────────────────────────────────────────────── */
  /* Increasing --shade-stop clips more from the bottom as the shade opens. */
  .shade-layer {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      180deg,
      rgb(var(--surface-hi) / 0.92),
      rgb(var(--surface-hi) / 0.92) 8%,
      rgb(var(--surface) / 0.65) 8%,
      rgb(var(--surface) / 0.65) 11%
    );
    clip-path: inset(0 0 var(--shade-stop, 0%) 0);
    transition:
      clip-path 200ms ease,
      --slat-height 250ms ease;
  }

  /* Tilt changes the solid slat height within each repeating band. */
  .shade-layer.slatted {
    background: repeating-linear-gradient(
      180deg,
      rgb(var(--surface-hi) / 0.94) 0% calc(var(--slat-height, 1.5%) - 0.8%),
      rgb(var(--ink) / 0.3) calc(var(--slat-height, 1.5%) - 0.8%)
        var(--slat-height, 1.5%),
      transparent var(--slat-height, 1.5%) 12%
    );
  }

  /* ── Curtain panels ───────────────────────────────────────────────────────── */
  /* Two panels shrink toward the sides instead of using the vertical clip. */
  .shade-layer.curtain {
    clip-path: none;
    background: none;
  }

  .shade-layer.curtain::before,
  .shade-layer.curtain::after {
    position: absolute;
    top: 0;
    bottom: 0;
    width: calc((100% - var(--shade-stop, 0%)) / 2);
    content: "";
    background: repeating-linear-gradient(
      90deg,
      rgb(var(--surface-hi) / 0.92) 0%,
      rgb(var(--surface-hi) / 0.92) 12%,
      rgb(var(--surface) / 0.65) 12%,
      rgb(var(--surface) / 0.65) 18%
    );
    transition: width 200ms ease;
  }

  .shade-layer.curtain::before {
    left: 0;
  }

  .shade-layer.curtain::after {
    right: 0;
  }
</style>
