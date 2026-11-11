<!--
  ShadeLevelControl.svelte
  =============================================================================
  Shared slider and Close / Open buttons for position and slat tilt.

  Props:
    kind            Position or tilt layout and accessibility labels.
    label           Visible heading and position slider label.
    value           Displayed draft / reported percentage; null shows "--".
    confirmedValue  Server-reported percentage used for button highlights.
    disabled        Connection state supplied by the page.
    oninput         Preview a percentage while the slider is dragged.
    oncommit        Send a percentage on change or a quick-action click.

  The page owns drafts, tilt-scale conversion, commands, and feedback handling.
  Snippets keep the existing position and tilt markup / spacing while sharing
  the slider and buttons.
-->

<script lang="ts">
  type Props = {
    kind?: "position" | "tilt";
    label: string;
    value: number | null;
    confirmedValue: number | null;
    disabled?: boolean;
    oninput: (value: number) => void;
    oncommit: (value: number) => void | Promise<void>;
  };

  let {
    kind = "position",
    label,
    value,
    confirmedValue,
    disabled = false,
    oninput,
    oncommit,
  }: Props = $props();
</script>

<!-- ── Slider and value ───────────────────────────────────────────────────── -->
{#snippet slider()}
  <div class="slider-label-row">
    <h2>{label}</h2>
    <span
      class="shade-level"
      aria-live={kind === "position" ? "polite" : undefined}
      >{value === null ? "--" : value + "%"}</span
    >
  </div>
  <!-- TODO: UI Lab 1.5ab - Add a slider to control the shade position -->
  <!-- Hint: Use an input of type range. Bind its value to the current draft or reported percentage. -->
  <!-- UI Lab 1.5ab - End -->
{/snippet}

<!-- ── Quick actions ──────────────────────────────────────────────────────── -->
<!-- Highlight confirmed feedback while the slider can display a newer draft. -->
{#snippet quickActions()}
  <div
    class="quick-actions"
    role="group"
    aria-label={kind === "tilt"
      ? "Slat tilt quick actions"
      : "Position quick actions"}
  >
    <button
      type="button"
      class="action-btn"
      class:active={confirmedValue === 0}
      {disabled}
      onclick={() => oncommit(0)}
    >
      Close
    </button>
    <button
      type="button"
      class="action-btn"
      class:active={confirmedValue === 100}
      {disabled}
      onclick={() => oncommit(100)}
    >
      Open
    </button>
  </div>
{/snippet}

<!-- ═══════════════════════════════════════════════════════════════════════════
     Control layout
     ═══════════════════════════════════════════════════════════════════════════ -->
{#if kind === "tilt"}
  <div class="tilt-controls">
    {@render slider()}
    {@render quickActions()}
  </div>
{:else}
  <div class="slider-block">
    {@render slider()}
  </div>
  {@render quickActions()}
{/if}

<style>
  /* ── Tilt control layout ──────────────────────────────────────────────────── */
  .tilt-controls {
    display: grid;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }

  /* ── Control labels and values ────────────────────────────────────────────── */
  .slider-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  /* h2 acts as a visible label for each content section / control. */
  h2 {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.55;
  }

  .slider-label-row span {
    font-size: 1.9rem;
    line-height: 1;
    font-weight: 700;
  }

  .slider-label-row .shade-level {
    font-size: 0.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: 3ch;
    text-align: right;
    flex-shrink: 0;
    transition: color 0.3s;
  }

  /* ── Range sliders ────────────────────────────────────────────────────────── */
  .shade-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 16px;
    background: transparent;
    cursor: pointer;
    border: none;
    outline: none;
  }

  /* WebKit paints the fill with --pct; Firefox uses its progress pseudo-element. */
  .shade-slider::-webkit-slider-runnable-track {
    height: 10px;
    border-radius: 6px;
    background: linear-gradient(
      to right,
      rgb(var(--accent-rgb) / 0.35) 0%,
      var(--accent-cyan) var(--pct, 0%),
      rgb(var(--ink) / 0.12) var(--pct, 0%),
      rgb(var(--ink) / 0.12) 100%
    );
  }

  .shade-slider::-moz-range-track {
    height: 10px;
    border-radius: 6px;
    background: rgb(var(--ink) / 0.12);
  }

  .shade-slider::-moz-range-progress {
    height: 10px;
    border-radius: 6px;
    background: linear-gradient(
      to right,
      rgb(var(--accent-rgb) / 0.35),
      var(--accent-cyan)
    );
  }

  .shade-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow:
      0 0 0 2px rgb(var(--accent-rgb) / 0.3),
      0 1px 4px rgb(var(--shadow-rgb) / 0.5);
  }

  .shade-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 50%;
    background: #fff;
    box-shadow:
      0 0 0 2px rgb(var(--accent-rgb) / 0.3),
      0 1px 4px rgb(var(--shadow-rgb) / 0.5);
  }

  /* ── Slider endpoints and quick actions ────────────────────────────────────── */
  .slider-ends {
    display: flex;
    justify-content: space-between;
    font-size: 0.82rem;
    opacity: 0.7;
  }

  .quick-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .action-btn {
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

  .action-btn.active {
    background: rgb(var(--accent-rgb) / 0.1);
    border-color: rgb(var(--accent-rgb) / 0.5);
    color: var(--accent-cyan);
  }

  .action-btn:active {
    transform: scale(0.97);
  }

  .action-btn:not(:disabled):hover {
    border-color: rgb(var(--accent-rgb) / 0.4);
    color: rgb(var(--ink) / 0.9);
  }

  /* ── Interaction states ───────────────────────────────────────────────────── */
  .action-btn:disabled,
  .shade-slider:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  button:focus-visible,
  .shade-slider:focus-visible {
    outline: 2px solid var(--accent-cyan);
    outline-offset: 3px;
  }

  /* ── Narrow shade detail ──────────────────────────────────────────────────── */
  @media (max-width: 980px) {
    .slider-label-row span {
      font-size: 1.5rem;
    }
  }
</style>
