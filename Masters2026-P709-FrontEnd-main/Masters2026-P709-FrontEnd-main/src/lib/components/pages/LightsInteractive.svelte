<script lang="ts">
  import { lightsState, LOADS } from "../../stores/lights.svelte";
  import { setLight } from "../../transport/lights";
  import { levelColor as getLevelColor } from "../../stores/theme.svelte";
  import { roomState } from "../../stores/room.svelte";
  import Card from "../ui/Card.svelte";

  // The room SVG's own aspect ratio drives .floor-plan-surface's CSS (see
  // --room-aspect below) — it can no longer be hardcoded now that the SVG
  // itself is server-provided and could be any shape, not just the bundled
  // default's 616x264 (7:3).
  function svgAspectRatio(svg: string): number {
    const viewBox = svg.match(
      /viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i,
    );
    if (viewBox) {
      const w = parseFloat(viewBox[1]);
      const h = parseFloat(viewBox[2]);
      if (w > 0 && h > 0) return w / h;
    }
    const width = svg.match(/\swidth=["']([\d.]+)/i);
    const height = svg.match(/\sheight=["']([\d.]+)/i);
    if (width && height) {
      const w = parseFloat(width[1]);
      const h = parseFloat(height[1]);
      if (w > 0 && h > 0) return w / h;
    }
    return 7 / 3; // matches the bundled default's own viewBox
  }

  const roomAspectRatio = $derived(svgAspectRatio(roomState.roomSvg ?? ""));

  function level(lightId: string): number {
    return lightsState.levels[lightId] ?? 0;
  }

  function isOn(lightId: string): boolean {
    return level(lightId) > 0;
  }

  function toggle(lightId: string) {
    setLight(lightId, isOn(lightId) ? 0 : 100);
  }

  // ── Loads-panel slider (dimmer loads only) ──────────────────────────────
  // Same draft pattern as Lights.svelte: show the dragged value immediately
  // (not a backend round-trip), but keep showing it (instead of snapping
  // back to the old confirmed value) until the server echoes the same
  // level back, which auto-clears the draft below.
  let drafts = $state<Record<string, number | null>>({});

  function displayLevel(lightId: string): number {
    return drafts[lightId] ?? level(lightId);
  }

  $effect(() => {
    for (const load of LOADS) {
      const id = load.id;
      if (drafts[id] != null && level(id) === drafts[id]) {
        drafts[id] = null;
      }
    }
  });

  function onSliderInput(lightId: string, e: Event) {
    drafts[lightId] = Number((e.target as HTMLInputElement).value);
  }

  function onSliderChange(lightId: string, e: Event) {
    const levelPercent = Number((e.target as HTMLInputElement).value);
    drafts[lightId] = levelPercent;
    setLight(lightId, levelPercent);
  }

  // -----------------------------------------------------------------------
  // fixtures — one entry per physical fixture, flattened out of every
  // load's `positions` (see stores/lights.svelte.ts).
  // -----------------------------------------------------------------------
  type Fixture = {
    key: string;
    loadId: string;
    label: string;
    xPercent: number;
    yPercent: number;
  };

  // No per-fixture name in the config, so the label is derived from the
  // load's own name (first letter) + a 1-based index within that load —
  // e.g. "Wall Sconces" → "W1", "W2".
  function fixtureLabel(loadName: string, index: number): string {
    const initial = loadName.trim().charAt(0).toUpperCase() || "?";
    return `${initial}${index + 1}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fixtures = $derived(
    LOADS.flatMap((load) =>
      load.positions.map((pos, i): Fixture => ({
        key: `${load.id}-${i}`,
        loadId: load.id,
        label: fixtureLabel(load.name, i),
        xPercent: pos.xPercent,
        yPercent: pos.yPercent,
      })),
    ),
  );
</script>

<div class="layout">
  <!-- ── Content row ───────────────────────────────────────────────────── -->
  <div class="content">
    <!-- Floor plan (fluid) -->
    <Card padding="lg" class="floor-card">
      <div class="floor-plan">
        <!--
          The actual room-shaped surface. Split out from .floor-plan because
          a plain `aspect-ratio` on .floor-plan itself can get overridden by
          flex-shrink when there isn't enough height to go with the full
          width (exactly what was happening: the box rendered wider than
          its own aspect-ratio, so the room SVG — which preserves its own
          aspect ratio and letterboxes — ended up narrower than this box,
          leaving the percentage-positioned fixture buttons outside the
          visible room). `max-width: calc(100cqh * var(--room-aspect))`
          (needs `container-type: size` on the parent, set below) picks
          whichever of width/height is the tighter constraint, so this
          surface always matches the room SVG's own shape and the
          SVG/fixtures inside it never mismatch. `--room-aspect` comes from
          the active SVG's own viewBox/width-height (see roomAspectRatio
          above) since it's no longer always the bundled default's 7:3.
        -->
        <div
          class="floor-plan-surface"
          style="--room-aspect: {roomAspectRatio};"
        >
          <!--
            Non-interactive room layer — the server's own floor-plan SVG
            (GetRoomConfiguration's roomSvg), or the bundled
            src/assets/furniture-layout.svg default before that arrives.
            Either way it's inlined as-is; the rule below just sizes/
            positions it to fill the surface, and sets a themed `color` for
            default-theme SVGs that rely on `currentColor` (the server
            contract's own sample does) — self-contained SVGs like the
            bundled default simply ignore it.
          -->
          <div class="room-svg-layer" aria-hidden="true"></div>

          <!--
            Interactive fixture buttons — one per physical fixture, driven
            by each load's `positions` from the server config (see
            `fixtures` above). Replaces the old hardcoded
            pendant/recessed/wall-washer button groups, which only worked
            for exactly 4 known light ids.
          -->
          <div class="fixtures-layer"></div>
        </div>
      </div>
    </Card>

    <!-- ── Loads panel ─────────────────────────────────────────────────── -->
    <!--
      Shows every load from the server's "GetRoomConfiguration" response
      (see stores/lights.svelte.ts LOADS), regardless of whether it has any
      floor-plan `positions` — unlike the fixture buttons above, which only
      render for loads that do. The footer shows each load's config `type`
      (dimmer/switch) instead of a fixture label, since the config doesn't
      send fixture names.
    -->
    <div class="loads-panel" aria-label="Load controls">
      {#each LOADS as load (load.id)}
        {@const lv = displayLevel(load.id)}
        {@const color = getLevelColor(lv)}
        {@const on = isOn(load.id)}
        <Card padding="sm" active={on} glow={false} style="--card-gap:0.45rem">
          <div class="load-row__header">
            <span
              class="load-dot"
              style="background:{lv > 0
                ? color
                : 'rgb(var(--fixture-off) / .9)'};border-color:{lv > 0
                ? color
                : 'rgb(var(--line-hi) / .5)'};box-shadow:{lv > 0
                ? `0 0 8px 2px ${color}66`
                : 'none'};"
              aria-hidden="true"
            ></span>
            <span class="load-name">{load.name}</span>
            <span
              class="load-level"
              style="color:{lv > 0 ? color : 'rgb(var(--ink) / .25)'}"
              aria-live="polite">{lv}%</span
            >
          </div>

          {#if load.type === "dimmer"}
            <input
              type="range"
              class="load-slider"
              min="0"
              max="100"
              step="1"
              value={lv}
              style="--pct: {lv}%"
              aria-label="{load.name} brightness"
              oninput={(e) => onSliderInput(load.id, e)}
              onchange={(e) => onSliderChange(load.id, e)}
            />
          {/if}

          <div class="load-row__footer">
            <span class="load-fixtures"
              >{load.type === "dimmer" ? "Dimmer" : "Switch"}</span
            >
            <button
              type="button"
              class="load-toggle"
              class:on
              role="switch"
              aria-checked={on}
              aria-label="Toggle {load.name}"
              onclick={() => toggle(load.id)}>{on ? "On" : "Off"}</button
            >
          </div>
        </Card>
      {/each}
    </div>
  </div>
</div>

<style>
  /* ── Layout: flex-column → stats strip + content row ────────────────────── */
  .layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    gap: 0.75rem;
  }

  /* ── Content row: floor plan + loads panel ───────────────────────────────── */
  .content {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 230px;
    gap: 1rem;
    overflow: hidden;
  }
  @media (max-width: 700px) {
    /* Stacked (portrait-ish) layout: instead of locking everything into the
       viewport and inner-scrolling just the loads (which left them almost
       no room), let the whole column flow to its natural height — the page
       outlet (.page in PageOutlet.svelte) is overflow:auto, so the entire
       lights page scrolls past the presets/floor plan to reach every load.
       Lights.svelte's matching breakpoint releases the page-level height
       locks for the same reason. */
    .layout {
      height: auto;
      overflow: visible;
    }

    .content {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto;
      overflow: visible;
    }
  }

  /* ── Floor card (surface comes from ui/Card.svelte) ───────────────────── */
  :global(.floor-card) {
    min-height: 0;
    overflow: hidden;
  }

  /* ── Floor plan ──────────────────────────────────────────────────────────── */
  /* Outer host: just centers .floor-plan-surface and establishes a size
     query container so the surface below can reliably pick whichever of
     width/height is the tighter constraint (see comment above the markup). */
  .floor-plan {
    position: relative;
    width: 100%;
    height: 100%;
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    container-type: size;
  }

  .floor-plan-surface {
    position: relative;
    /* Set inline via style="--room-aspect: ..." from the active SVG's own
       viewBox/width-height (see roomAspectRatio in the script) — falls
       back to 7/3 (the bundled default) if that custom property is ever
       unset for some reason. */
    aspect-ratio: var(--room-aspect, 2.3333);
    width: 100%;
    max-width: calc(100cqh * var(--room-aspect, 2.3333));
    border-radius: 12px;
    border: 2px solid rgb(var(--line) / 0.6);
    background-color: rgb(var(--plan-bg));
    background-image:
      radial-gradient(rgb(var(--line) / 0.35) 1px, transparent 0),
      radial-gradient(rgb(var(--line) / 0.35) 1px, transparent 0);
    background-size: 20px 20px;
    background-position:
      0 0,
      10px 10px;
    overflow: hidden;
  }

  /* Stacked layout (see the .content breakpoint above): the column flows to
     natural height, so height:100% would collapse to 0 here — and a fixed
     height would transfer through the surface's aspect-ratio into a huge
     intrinsic min-width that blows the page out sideways. Go width-driven
     instead: the surface spans the full column and derives its height from
     its own aspect ratio, so no size container query is needed. */
  @media (max-width: 700px) {
    .floor-plan {
      height: auto;
      container-type: normal;
    }

    .floor-plan-surface {
      max-width: none;
    }
  }

  /* ── Loads panel ─────────────────────────────────────────────────────────── */
  .loads-panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    overflow-y: auto;
    min-height: 0;
  }

  .load-row__header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .load-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid rgb(var(--line-hi) / 0.5);
    flex-shrink: 0;
    transition:
      background 0.3s,
      box-shadow 0.3s;
  }

  .load-name {
    flex: 1;
    font-size: 0.82rem;
    font-weight: 600;
    color: rgb(var(--ink) / 0.85);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .load-level {
    font-size: 0.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: 3ch;
    text-align: right;
    flex-shrink: 0;
    transition: color 0.3s;
  }

  /* ── Slider (dimmer loads only) ──────────────────────────────────────── */
  .load-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 18px;
    background: transparent;
    cursor: pointer;
    outline: none;
    border: none;
  }
  .load-slider::-webkit-slider-runnable-track {
    height: 12px;
    border-radius: 6px;
    background: linear-gradient(
      to right,
      rgb(var(--accent-rgb) / 0.35) 0%,
      var(--accent-cyan) var(--pct, 0%),
      rgb(var(--ink) / 0.1) var(--pct, 0%),
      rgb(var(--ink) / 0.1) 100%
    );
  }
  .load-slider::-moz-range-track {
    height: 12px;
    border-radius: 6px;
    background: rgb(var(--ink) / 0.1);
  }
  .load-slider::-moz-range-progress {
    height: 12px;
    border-radius: 6px;
    background: linear-gradient(
      to right,
      rgb(var(--accent-rgb) / 0.35) 0%,
      var(--accent-cyan) 100%
    );
  }
  .load-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #ffffff;
    border: none;
    cursor: grab;
    box-shadow:
      0 0 0 2px rgb(var(--accent-rgb) / 0.3),
      0 1px 4px rgb(var(--shadow-rgb) / 0.5);
  }
  .load-slider:active::-webkit-slider-thumb {
    cursor: grabbing;
    box-shadow:
      0 0 0 3px rgb(var(--accent-rgb) / 0.45),
      0 1px 4px rgb(var(--shadow-rgb) / 0.5);
  }
  .load-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #ffffff;
    border: none;
    cursor: grab;
    box-shadow:
      0 0 0 2px rgb(var(--accent-rgb) / 0.3),
      0 1px 4px rgb(var(--shadow-rgb) / 0.5);
  }
  .load-slider:active::-moz-range-thumb {
    cursor: grabbing;
  }

  .load-row__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .load-fixtures {
    font-size: 0.62rem;
    color: rgb(var(--ink) / 0.3);
    font-family: var(--mono);
  }

  .load-toggle {
    padding: 0.3rem 0.85rem;
    border: 1px solid rgb(var(--ink) / 0.12);
    border-radius: 6px;
    background: rgb(var(--ink) / 0.05);
    color: rgb(var(--ink) / 0.45);
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 120ms,
      border-color 120ms,
      color 120ms;
    -webkit-tap-highlight-color: transparent;
  }
  .load-toggle.on {
    background: rgb(var(--accent-rgb) / 0.1);
    border-color: rgb(var(--accent-rgb) / 0.5);
    color: var(--accent-cyan);
  }
  .load-toggle:active {
    transform: scale(0.97);
  }

  /* ── Room SVG — the server's roomSvg (or the bundled default before it
         arrives) is inlined via {@html}. The bundled default is fully
         self-styled (transparent fills, its own theme-agnostic grey), so
         `color` below only matters for server SVGs built around
         `currentColor` (the config contract's own sample is) ─────────── */
  .room-svg-layer {
    position: absolute;
    inset: 0;
    color: rgb(var(--line-hi));
    pointer-events: none;
    user-select: none;
    z-index: 2;
  }
  .room-svg-layer :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }

  /* ── Fixture buttons ─────────────────────────────────────────────────────── */
  .fixtures-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
  }

  @media (max-width: 700px) {
    /* The room itself renders smaller in the stacked (portrait-ish) layout
       (see .content's grid-template-rows above), so the fixture dots need
       to shrink to match — otherwise they'd look oversized relative to the
       room and start overlapping each other. */
  }
</style>
