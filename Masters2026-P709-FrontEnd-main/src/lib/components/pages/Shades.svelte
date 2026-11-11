<!--
  Shades.svelte
  =============================================================================
  HTML structure
  ──────────────
  <section.shades-page>          ← page root, labelledby h1
    <header.page__header>        ← title
    <p.command-error>            ← command / feedback errors (when present)
    <section.presets>            ← scene buttons or configuration note
    <div.content>                ← shade list + selected shade detail
      <Card.shade-list-card>     ← shade selection buttons
      <div.shade-detail>
        <Card.preview-card>      ← <ShadePreview /> (window illustration)
        <section.control-column>
          <Card.control-card>    ← <ShadeLevelControl /> for position + tilt

  Heading hierarchy:  h1 (page) → h2 (section / control)

  Transport pattern
  ─────────────────
  User action → setShadePosition() / setShadeTilt() / selectShadePreset()
              → SignalR → applyShadePosition() / applyShadeTilt() /
                applyShadePresetSelected() → shadesState → reactive re-render
  Position / tilt drafts preview the request until matching feedback arrives;
  active scene and quick-action states come from the server's reported values.
-->

<script lang="ts">
  import Card from "../ui/Card.svelte";
  import ShadePreview from "./ShadePreview.svelte";
  import ShadeLevelControl from "./ShadeLevelControl.svelte";
  import {
    SHADES,
    shadePresets,
    shadesState,
  } from "../../stores/shades.svelte";
  import {
    setShadePosition,
    setShadeTilt,
    selectShadePreset,
  } from "../../transport/shades";
  import { appStatus } from "../../transport/signalr.svelte";

  // ── Local selection and command state ────────────────────────────────────────
  // Drafts keep the sliders and preview responsive while server feedback is
  // pending. A null scope represents all configured shades in the helpers below.
  let selectedScope = $state<string | null>(null);
  let draftPosition = $state<number | null>(null);
  let draftTilt = $state<number | null>(null);
  let positionPending = $state(false);
  let tiltPending = $state(false);
  // Revisions prevent older async failures from clearing a newer request or
  // replacing its error message after a command or selection change.
  let positionRevision = 0;
  let tiltRevision = 0;
  let commandRevision = 0;
  let commandError = $state<string | null>(null);

  // ── Selection labels and preview type ────────────────────────────────────────
  const selectableShades = $derived(SHADES);
  const positionLabel = $derived(
    selectedScope !== null &&
      selectableShades.find((shade) => shade.id === selectedScope)?.type ===
        "curtain"
      ? "Curtain Position"
      : "Shade Position",
  );
  const curtainPreview = $derived.by(() => {
    const scopedShades = selectableShades.filter(
      (shade) => selectedScope === null || shade.id === selectedScope,
    );
    return (
      scopedShades.length > 0 &&
      scopedShades.every((shade) => shade.type === "curtain")
    );
  });

  // ── Selection sync ───────────────────────────────────────────────────────────
  // Restore the remembered shade (or choose the first one) when configuration
  // arrives. If the selected shade disappears, clear its drafts and requests.
  $effect(() => {
    if (selectedScope === null && SHADES.length > 0) {
      const rememberedScope = shadesState.selectedShadeId;
      selectedScope =
        rememberedScope !== null &&
        SHADES.some((shade) => shade.id === rememberedScope)
          ? rememberedScope
          : SHADES[0].id;
      shadesState.selectedShadeId = selectedScope;
      return;
    }
    if (
      selectedScope !== null &&
      !SHADES.some((shade) => shade.id === selectedScope)
    ) {
      selectedScope = null;
      shadesState.selectedShadeId = null;
      draftPosition = null;
      draftTilt = null;
      positionPending = false;
      tiltPending = false;
      positionRevision++;
      tiltRevision++;
      commandRevision++;
    }
  });

  // ── Scoped feedback values ───────────────────────────────────────────────────
  function scopeShadeIds(scope: string | null = selectedScope): string[] {
    return selectableShades
      .filter((shade) => scope === null || shade.id === scope)
      .map((shade) => shade.id);
  }

  // Wait for every shade in scope to report before averaging its position.
  function confirmedPosition(): number | null {
    const ids = scopeShadeIds();
    if (
      ids.length === 0 ||
      ids.some((id) => shadesState.positions[id] === undefined)
    )
      return null;
    const values = ids.map((id) => shadesState.positions[id]);
    return Math.round(
      values.reduce((sum, value) => sum + value, 0) / values.length,
    );
  }

  // A local draft takes precedence until confirmed; missing feedback displays 0.
  const confirmed = $derived(confirmedPosition());
  const positionPercent = $derived(draftPosition ?? confirmed ?? 0);
  const tiltIds = $derived(
    SHADES.filter(
      (shade) =>
        (selectedScope === null || shade.id === selectedScope) &&
        shade.supportsTilt === true,
    ).map((shade) => shade.id),
  );
  // Tilt uses the opposite scale on the server: invert feedback so the UI's
  // 0 = Closed / 100 = Open labels match the position controls.
  const confirmedTilt = $derived(
    tiltIds.length === 0 ||
      tiltIds.some((id) => shadesState.tilts[id] === undefined)
      ? null
      : 100 -
          Math.round(
            tiltIds.reduce((sum, id) => sum + shadesState.tilts[id], 0) /
              tiltIds.length,
          ),
  );
  const tiltPercent = $derived(draftTilt ?? confirmedTilt ?? 0);

  // ── Feedback confirmation ────────────────────────────────────────────────────
  // Release each draft only when every targeted shade echoes the requested value.
  $effect(() => {
    const ids = scopeShadeIds();
    if (
      positionPending &&
      ids.length > 0 &&
      ids.every((id) => shadesState.positions[id] === draftPosition)
    ) {
      positionPending = false;
      draftPosition = null;
    }
    if (
      tiltPending &&
      tiltIds.length > 0 &&
      tiltIds.every((id) => shadesState.tilts[id] === 100 - (draftTilt ?? 0))
    ) {
      tiltPending = false;
      draftTilt = null;
    }
  });

  // Fall back to reported values if confirmation takes longer than 10 seconds.
  // The effect cleanup cancels the timer when targets change or settle.
  $effect(() => {
    const positionTarget = positionPending ? draftPosition : null;
    const tiltTarget = tiltPending ? draftTilt : null;
    if (positionTarget === null && tiltTarget === null) return;
    const timeout = setTimeout(() => {
      commandError =
        "The server did not confirm the requested blind settings within 10 seconds. Showing the last reported values.";
      console.warn("Shades: feedback confirmation timed out", {
        positionTarget,
        tiltTarget,
      });
      if (positionTarget !== null) {
        positionPending = false;
        draftPosition = null;
      }
      if (tiltTarget !== null) {
        tiltPending = false;
        draftTilt = null;
      }
    }, 10000);
    return () => clearTimeout(timeout);
  });

  // ── Scope handler ────────────────────────────────────────────────────────────
  // Remember the selection and discard drafts / errors from the previous scope.
  function setScope(scope: string | null): void {
    positionRevision++;
    tiltRevision++;
    commandRevision++;
    selectedScope = scope;
    shadesState.selectedShadeId = scope;
    draftPosition = null;
    draftTilt = null;
    positionPending = false;
    tiltPending = false;
    commandError = null;
  }

  // ── Position handlers ────────────────────────────────────────────────────────
  // Send to every shade in scope and collect failures so the error can name
  // each affected shade. A successful invoke still waits for feedback above.
  async function sendPosition(value: number): Promise<void> {
    const revision = ++positionRevision;
    const command = ++commandRevision;
    const ids = scopeShadeIds();
    draftPosition = value;
    positionPending = true;
    commandError = null;
    const results = await Promise.allSettled(
      ids.map((id) => setShadePosition(id, value)),
    );
    if (revision !== positionRevision) return;
    const failedNames = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [SHADES.find((shade) => shade.id === ids[index])?.name ?? ids[index]]
        : [],
    );
    if (failedNames.length > 0) {
      positionPending = false;
      draftPosition = null;
      if (command === commandRevision) {
        commandError = `Could not set ${failedNames.join(", ")}. Check the connection and server logs, then try again.`;
      }
    }
  }

  // ── Tilt handlers ────────────────────────────────────────────────────────────
  // Only target shades that support tilt, converting the UI value back to the
  // server's scale. Confirmation follows the same draft / feedback pattern.
  async function sendTiltValue(value: number): Promise<void> {
    const revision = ++tiltRevision;
    const command = ++commandRevision;
    draftTilt = value;
    tiltPending = true;
    commandError = null;
    const results = await Promise.allSettled(
      tiltIds.map((id) => setShadeTilt(id, 100 - value)),
    );
    if (revision !== tiltRevision) return;
    if (results.some((result) => result.status === "rejected")) {
      tiltPending = false;
      draftTilt = null;
      if (command === commandRevision) {
        commandError =
          "Could not set slat tilt. The server must implement SetShadeTilt and ShadeTiltChanged.";
      }
    }
  }

  // ── Preset handler ───────────────────────────────────────────────────────────
  // A scene supersedes pending manual adjustments. Its active state comes from
  // the "ShadePresetSelected" echo, rather than being set on click.
  async function applyPreset(presetId: string): Promise<void> {
    positionRevision++;
    tiltRevision++;
    const command = ++commandRevision;
    positionPending = false;
    tiltPending = false;
    draftPosition = null;
    draftTilt = null;
    commandError = null;
    try {
      await selectShadePreset(presetId);
    } catch {
      if (command === commandRevision) {
        commandError =
          "Could not select the preset. The server must implement SelectShadePreset and ShadePresetSelected.";
      }
    }
  }
</script>

<!-- ═══════════════════════════════════════════════════════════════════════════
     Page root
     ═══════════════════════════════════════════════════════════════════════════ -->
<section class="shades-page" aria-labelledby="shades-title">
  <!-- ── Page header ──────────────────────────────────────────────────────── -->
  <header class="page__header">
    <h1 id="shades-title">Shades</h1>
  </header>
  <!-- ── Command feedback ─────────────────────────────────────────────────── -->
  {#if commandError}<p class="command-error" role="alert">
      {commandError}
    </p>{/if}
  <!-- ── Scene presets ────────────────────────────────────────────────────── -->
  <section class="presets" aria-labelledby="shade-presets-title">
    <h2 id="shade-presets-title">Scenes</h2>
    {#if shadePresets.length === 0}
      <p class="feature-note">
        No presets configured. The server needs shadePresets, SelectShadePreset
        and ShadePresetSelected.
      </p>
    {:else}
      <div class="preset-grid" role="group" aria-label="Shade scenes">
        {#each shadePresets as preset (preset.id)}
          <button
            type="button"
            class="preset-btn"
            class:active={shadesState.activePresetId === preset.id}
            aria-pressed={shadesState.activePresetId === preset.id}
            disabled={!appStatus.isConnected}
            onclick={() => applyPreset(preset.id)}
          >
            {preset.name}
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Shade layout / empty state ────────────────────────────────────────── -->
  {#if selectableShades.length === 0}
    <p class="empty-state">
      No shades are configured yet. Add `shades` in room configuration.
    </p>
  {:else}
    <div class="content">
      <!-- ── Shade selection ──────────────────────────────────────────────── -->
      <Card class="shade-list-card" padding="sm">
        <h2>Shades</h2>
        <nav class="scope-tabs" aria-label="Select a shade">
          {#each selectableShades as shade (shade.id)}
            <!-- TODO: UI Lab 1.5aa - Add the shade selection button -->
            <!-- Hint: Use a button with class "scope-tab" and bind its active state to selectedScope -->
            <!-- UI Lab 1.5aa - End -->
            <!-- REF: UI Lab 1.5aa -->
            <button
              type="button"
              class="scope-tab"
              class:active={selectedScope === shade.id}
              aria-current={selectedScope === shade.id ? "true" : undefined}
              onclick={() => setScope(shade.id)}
            >
              {shade.name}
            </button>
            <!-- REF: UI Lab 1.5aa - End -->
          {/each}
        </nav>
      </Card>

      <div class="shade-detail">
        <!-- ── Decorative preview ─────────────────────────────────────────── -->
        <Card class="preview-card" aria-label="Shade preview">
          <ShadePreview
            position={positionPercent}
            tilt={tiltPercent}
            curtain={curtainPreview}
            slatted={tiltIds.length > 0}
          />
        </Card>

        <!-- ── Shade controls ─────────────────────────────────────────────── -->
        <section class="control-column" aria-label="Shade controls">
          <Card class="control-card">
            <!-- ── Position slider ────────────────────────────────────────── -->
            <ShadeLevelControl
              label={positionLabel}
              value={positionPercent}
              confirmedValue={confirmed}
              disabled={!appStatus.isConnected}
              oninput={(value) => {
                draftPosition = value;
              }}
              oncommit={sendPosition}
            />

            <!-- ── Slat tilt (supported shades only) ───────────────────────── -->
            {#if tiltIds.length > 0}
              <ShadeLevelControl
                kind="tilt"
                label="Slat Tilt"
                value={confirmedTilt === null && draftTilt === null
                  ? null
                  : tiltPercent}
                confirmedValue={confirmedTilt}
                disabled={!appStatus.isConnected}
                oninput={(value) => {
                  draftTilt = value;
                }}
                oncommit={sendTiltValue}
              />
            {/if}
          </Card>
        </section>
      </div>
    </div>
  {/if}
</section>

<style>
  /* ── Page layout ──────────────────────────────────────────────────────────── */
  .shades-page {
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
    margin-bottom: 1rem;
  }

  .page__header h1 {
    margin: 0;
    font-size: 1.5rem;
    letter-spacing: 0.02em;
  }

  /* ── Presets section ──────────────────────────────────────────────────────── */
  .presets {
    flex-shrink: 0;
    margin-bottom: 1rem;
  }

  .presets h2 {
    margin: 0 0 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.45;
  }

  /* ── Shade list and detail layout ─────────────────────────────────────────── */
  .content {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(150px, 210px) minmax(0, 1fr);
    gap: 1rem;
  }

  /* Card renders these class names in its child component, so use :global. */
  :global(.shade-list-card) {
    min-height: 0;
    overflow-y: auto;
  }

  .scope-tabs {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.55rem;
  }

  .scope-tab {
    justify-content: flex-start;
    text-align: left;
  }

  .shade-detail {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
    gap: 1rem;
  }

  :global(.preview-card) {
    min-height: 0;
    align-items: center;
    justify-content: center;
  }

  .control-column {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    overflow-y: auto;
  }

  :global(.control-card) {
    flex-shrink: 0;
  }

  /* ── Selection buttons ────────────────────────────────────────────────────── */
  .scope-tab,
  .preset-btn {
    border: 1px solid var(--border-inactive);
    border-radius: 12px;
    background: var(--bg-inactive);
    color: var(--text-muted);
    font-family: inherit;
    font-size: 0.92rem;
    font-weight: 600;
    padding: 0.65rem 0.9rem;
    cursor: pointer;
    transition: all 180ms ease;
  }

  .scope-tab.active,
  .preset-btn.active {
    border-color: var(--accent-cyan);
    color: var(--text-primary);
    background: rgb(var(--accent-rgb) / 0.16);
    box-shadow: 0 0 16px var(--accent-cyan-glow);
  }

  .scope-tab:hover,
  .preset-btn:not(:disabled):hover {
    border-color: rgb(var(--accent-rgb) / 0.4);
    color: rgb(var(--ink) / 0.9);
  }

  /* ── Section headings ─────────────────────────────────────────────────────── */
  /* h2 acts as a visible label for each content section. */
  h2 {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.55;
  }

  /* ── Selection alignment and interaction states ────────────────────────────── */
  .scope-tab {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .preset-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  button:focus-visible {
    outline: 2px solid var(--accent-cyan);
    outline-offset: 3px;
  }
  /* ── Status messages ──────────────────────────────────────────────────────── */
  .command-error {
    color: var(--danger-ink);
  }
  .feature-note {
    margin: 0;
    font-size: 0.82rem;
    opacity: 0.7;
  }
  /* ── Scene preset grid and buttons ─────────────────────────────────────────── */
  .preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.75rem;
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

  /* ── Empty state ──────────────────────────────────────────────────────────── */
  .empty-state {
    margin: 0;
    opacity: 0.65;
  }

  /* ── Stacked shade detail ────────────────────────────────────────────────────
     Place the preview above the controls when the detail columns no longer
     fit side by side. Keep the preview visible and release the inner scroller. */
  @media (max-width: 980px) {
    .shade-detail {
      grid-template-columns: minmax(0, 1fr);
    }
    :global(.preview-card) {
      min-height: 280px;
    }
    .control-column {
      overflow: visible;
    }
  }

  /* ── Stacked (narrow) panels ─────────────────────────────────────────────────
     Put the shade list above the detail and let the whole page scroll, matching
     the natural-height layout used by the Lighting page on narrow panels. */
  @media (max-width: 700px) {
    .shades-page {
      height: auto;
      min-height: 100%;
    }
    .content {
      flex: none;
      grid-template-columns: minmax(0, 1fr);
      overflow: visible;
    }
    :global(.shade-list-card) {
      overflow: visible;
    }
  }

  /* ── Short landscape panels ─────────────────────────────────────────────────
     Release the height:100% lock so the content keeps a usable minimum height
     and the page can scroll on wide panels with limited vertical space. */
  @media (max-height: 520px) and (min-width: 701px) {
    .shades-page {
      height: auto;
      min-height: 100%;
    }

    .content {
      flex: none;
      min-height: 340px;
    }
  }
</style>
