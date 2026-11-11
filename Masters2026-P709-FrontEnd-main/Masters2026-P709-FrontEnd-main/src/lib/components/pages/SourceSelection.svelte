<!--
  SourceSelection.svelte
  =============================================================================
  Lets the user pick which source is routed to the room's displays.

  Transport pattern (same as every other page)
  ──────────────────────────────────────────────
  User action → setSource() → SignalR → applyCurrentSource()
              → sourcesState update → reactive re-render

  Selecting a source while the system is off still just calls setSource(id).
  The server decides whether to start the system first; this page never
  checks or sets system state itself. The existing SystemPowerOverlay already
  shows a "Starting up…" screen whenever systemState.current is "starting",
  so no extra wiring is needed here for that case.
-->
<svelte:options runes />

<script lang="ts">
  import {
    displayPreviewState,
    sourcesState,
    SOURCES,
  } from "../../stores/sources.svelte";
  import { setSource } from "../../transport/sources";
  import SourceTypeIcon from "../icons/SourceTypeIcon.svelte";
  import Card from "../ui/Card.svelte";
  import DisplayPreview from "./sourceControls/DisplayPreview.svelte";
  import TvControls from "./sourceControls/TvControls.svelte";
  import OhpControls from "./sourceControls/OhpControls.svelte";
  import WirelessPresenterControls from "./sourceControls/WirelessPresenterControls.svelte";
  import LaptopControls from "./sourceControls/LaptopControls.svelte";
  import OtherControls from "./sourceControls/OtherControls.svelte";

  // The currently-selected source's full record (name/type/iconSvg), looked
  // up from the catalogue by id — sourcesState only tracks the id, same
  // separation used by every other domain store in this app.
  const selectedSource = $derived(
    SOURCES.find((s) => s.id === sourcesState.current) ?? null,
  );

  // The room's preview feed URL, fetched from the hub's GetPreviewUrl query
  // on connect (see transport/sources.ts). Empty until it arrives.
  //
  // The endpoint serves a snapshot, so the <img> is re-fetched by bumping a
  // cache-busting query param — every 5 seconds while this page is shown,
  // and immediately when the selected source changes (both are dependencies
  // of the derived URL below).
  const PREVIEW_REFRESH_MS = 5000;
  let refreshTick = $state(0);

  // $effect only runs while the page is mounted, so the timer (and the
  // image fetches it causes) stop the moment the user navigates away.
  $effect(() => {
    const timer = setInterval(() => {
      refreshTick += 1;
    }, PREVIEW_REFRESH_MS);
    return () => clearInterval(timer);
  });

  const previewUrl = $derived.by(() => {
    const base = displayPreviewState.url;
    if (!base) return "";
    const url = new URL(base);
    url.searchParams.set("refresh", `${sourcesState.current}-${refreshTick}`);
    return url.toString();
  });
</script>

<section class="sources-page" aria-labelledby="sources-title">
  <header class="page__header">
    <h1 id="sources-title">Sources</h1>
  </header>

  <div class="preview-area">
    <!-- src updates in place (no {#key} remount): the browser keeps showing
         the previous frame until the refreshed one has loaded, so the 5s
         refresh doesn't flash the placeholder. -->
    <DisplayPreview url={previewUrl} />
  </div>

  <section class="available-sources" aria-labelledby="available-sources-title">
    <h2 id="available-sources-title">Available sources</h2>
    <ul class="source-grid" aria-labelledby="available-sources-title">
      {#each SOURCES as source (source.id)}
        {@const selected = sourcesState.current === source.id}
        <li>
          <Card
            renderAs="button"
            class="source-card"
            active={selected}
            glow={false}
            aria-pressed={selected}
            onclick={() => setSource(source.id)}
          >
            <SourceTypeIcon
              type={source.type}
              iconSvg={source.iconSvg}
              size="2rem"
              class="source-card__icon"
            />
            <span class="source-card__name">{source.name}</span>
          </Card>
        </li>
      {/each}
    </ul>
  </section>

  <!--
    Control section — content is keyed to the selected source's `type`,
    one dedicated panel per type (see
    components/pages/sourceControls/).
  -->
  <section class="source-controls" aria-label="Source controls">
    {#if selectedSource}
      <Card class="source-controls__card">
        {#if selectedSource.type === "tv"}
          <TvControls source={selectedSource} />
        {:else if selectedSource.type === "ohp"}
          <OhpControls source={selectedSource} />
        {:else if selectedSource.type === "wirelessPresenter"}
          <WirelessPresenterControls source={selectedSource} />
        {:else if selectedSource.type === "laptopHdmi"}
          <LaptopControls source={selectedSource} connector="HDMI" />
        {:else if selectedSource.type === "laptopUsbC"}
          <LaptopControls source={selectedSource} connector="USB-C" />
        {:else}
          <OtherControls source={selectedSource} />
        {/if}
      </Card>
    {:else}
      <Card class="source-controls__card">
        <p class="controls-empty">Select a source above to see its controls.</p>
      </Card>
    {/if}
  </section>
</section>

<style>
  .sources-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 100%;
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: 1rem clamp(1rem, 5vw, 2rem);
    box-sizing: border-box;
  }

  .page__header {
    flex-shrink: 0;
  }
  .page__header h1 {
    margin: 0;
    font-size: 1.5rem;
    letter-spacing: 0.02em;
  }

  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.45;
  }

  .available-sources {
    flex-shrink: 0;
  }

  .preview-area {
    flex-shrink: 0;
    margin-inline: auto;
    /* Leave room for the shell, source tiles and controls on landscape panels. */
    width: min(73%, 48rem, max(16rem, calc((100dvh - 29rem) * 16 / 9)));
  }

  .source-grid {
    flex-shrink: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .source-grid li {
    display: flex;
    min-width: 0;
  }

  .source-grid :global(.source-card) {
    min-height: 6rem;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    border-width: 2px;
    border-radius: 1.25rem;
    background: rgb(var(--ink) / 0.06);
    text-align: center;
  }

  .source-grid :global(.source-card.active) {
    background: rgb(var(--accent-rgb) / 0.2);
    border-color: var(--accent-cyan);
  }

  .source-grid :global(.source-card:focus-visible) {
    outline: 2px solid var(--accent-cyan);
    outline-offset: 3px;
  }

  :global(.source-card__icon) {
    color: rgb(var(--ink) / 0.55);
  }

  :global(.card.active .source-card__icon) {
    color: var(--accent-cyan);
  }

  .source-card__name {
    font-size: 1.05rem;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .source-controls {
    flex: 1;
    min-height: 6rem;
    display: flex;
    flex-direction: column;
  }

  :global(.source-controls__card) {
    flex: 1;
    padding: 1.25rem;
    gap: 0.75rem;
    border-radius: 1.25rem;
    background: rgb(var(--ink) / 0.06);
  }

  .controls-empty {
    margin: 0;
    opacity: 0.6;
  }

  @media (max-width: 700px) {
    .preview-area {
      width: 100%;
    }
  }
</style>
