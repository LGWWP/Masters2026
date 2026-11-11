<!--
  Lights.svelte
  =============================================================================
  HTML structure
  ──────────────
  <section.lights-page>          ← page root, labelledby h1
    <header.page__header>        ← title
    <section.presets>            ← scene buttons (h2 → preset grid)
    <section.room-layout>        ← <LightsInteractive /> (floor plan + loads)

  Heading hierarchy:  h1 (page) → h2 (section)

  Transport pattern (unchanged)
  ──────────────────────────────
  User action → selectPreset() → SignalR → applyPresetSelected()
              → lightsState update → reactive re-render
-->

<script lang="ts">
  import { lightsState, lightPresets } from '../../stores/lights.svelte';
  import { selectPreset } from '../../transport/lights';
  import LightsInteractive from './LightsInteractive.svelte';

  // ── Preset handler ───────────────────────────────────────────────────────────
  // Fires the "SelectPreset" hub command. The UI does not mark a preset
  // active on click; it waits for the "PresetSelected" echo (see
  // transport/lights.ts), the same round-trip pattern used everywhere else.
  function applyPreset(presetId: string) {
    selectPreset(presetId);
  }

  // Active preset comes straight from the server's own echo — not derived by
  // comparing light levels on the client.
  const activePresetId = $derived(lightsState.activePresetId);

</script>

<!-- ═══════════════════════════════════════════════════════════════════════════
     Page root
     ═══════════════════════════════════════════════════════════════════════════ -->
<section class="lights-page" aria-labelledby="lights-title">

  <!-- ── Page header ──────────────────────────────────────────────────────── -->
  <header class="page__header">
    <h1 id="lights-title">Lighting</h1>
  </header>

  <!-- ── Scene presets ────────────────────────────────────────────────────── -->
  <section class="presets" aria-labelledby="presets-title">
    <h2 id="presets-title">Scenes</h2>
    <div class="preset-grid" role="group" aria-label="Scene presets">
      {#each lightPresets as preset (preset.id)}
        <button
          type="button"
          class="preset-btn"
          class:active={activePresetId === preset.id}
          onclick={() => applyPreset(preset.id)}
        >
          {preset.name}
        </button>
      {/each}
    </div>
  </section>

  <!-- ── Room layout ──────────────────────────────────────────────────────── -->
  <section class="room-layout" aria-label="Room layout">
    <LightsInteractive />
  </section>

</section>

<style>
  /* ── Page layout ──────────────────────────────────────────────────────────── */
  .lights-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: 1rem clamp(1rem, 5vw, 2rem);
    box-sizing: border-box;
  }

  /* ── Page header ──────────────────────────────────────────────────────────── */
  .page__header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .page__header h1 {
    margin: 0;
    font-size: 1.5rem;
    letter-spacing: 0.02em;
  }

  /* ── Section headings ─────────────────────────────────────────────────────── */
  /* h2 acts as a visible label for each content section */
  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.45;
  }

  /* ── Presets section ──────────────────────────────────────────────────────── */
  .presets { flex-shrink: 0; margin-bottom: 1rem; }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.75rem;
  }

  /* ── Room layout section ──────────────────────────────────────────────────── */
  .room-layout {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  /* ── Short landscape panels ───────────────────────────────────────────────
     When there isn't enough height to fit everything, the height:100% lock
     above crushes .room-layout (floor plan + load controls) into a sliver.
     Release the lock and let the page scroll instead — the PageOutlet .page
     wrapper is overflow:auto. .room-layout gets a definite height (not
     min-height) because LightsInteractive sizes itself via height:100% and
     a size container query, both of which need a resolvable height.
     Scoped to >700px wide: narrower panels use the stacked rules below. */
  @media (max-height: 520px) and (min-width: 701px) {
    .lights-page {
      height: auto;
      min-height: 100%;
    }

    .room-layout {
      flex: none;
      height: 340px;
    }
  }

  /* ── Stacked (narrow) panels ──────────────────────────────────────────────
     Matches LightsInteractive's stacked breakpoint: the floor plan and
     loads flow to their natural height and the whole page scrolls, so the
     presets/floor plan scroll out of the way instead of pinning the loads
     into a tiny inner scroller. */
  @media (max-width: 700px) {
    .lights-page {
      height: auto;
      min-height: 100%;
    }

    .room-layout {
      flex: none;
      overflow: visible;
    }
  }

  .preset-btn {
    background: var(--bg-inactive);
    border: 1px solid var(--border-inactive);
    color: var(--text-muted);
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    padding: 12px 24px;
    border-radius: 30px;
    cursor: pointer;
    transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);
  }

  .preset-btn:hover {
    background: rgb(var(--ink) / 0.07);
    border-color: rgb(var(--accent-rgb) / 0.4);
    color: rgb(var(--ink) / 0.85);
    transform: translateY(-1px);
  }

  .preset-btn.active {
    border-color: var(--accent-cyan);
    color: var(--text-primary);
    font-weight: 600;
    box-shadow: 0 0 16px var(--accent-cyan-glow);
    text-shadow: 0 0 8px rgb(var(--ink) / 0.3);
  }

</style>
