<svelte:options runes />

<script lang="ts">
  import { untrack } from "svelte";
  import Card from "../ui/Card.svelte";
  import {
    conciergeConfigState,
    conciergeState,
  } from "../../stores/concierge.svelte";
  import { startConcierge } from "../../transport/concierge";

  $effect(() => {
    const config = conciergeConfigState.current;
    return untrack(() =>
      startConcierge(
        config ? { ...config } : { apiUrl: "", roomId: "", authToken: "" },
      ),
    );
  });
</script>

<section class="page-body" aria-labelledby="concierge-title">
  <header class="page__header">
    <h1 id="concierge-title">Concierge</h1>
  </header>

  <h2 id="concierge-requests-title">Service requests</h2>
  <section class="concierge" aria-labelledby="concierge-requests-title">
    <Card class="concierge__card">
      {#if conciergeState.status === "loading"}
        <p class="concierge__hint" role="status">Loading concierge services…</p>
      {:else if conciergeState.status !== "online"}
        <p class="concierge__hint" role="alert">{conciergeState.message}</p>
      {:else if conciergeState.requests.length === 0}
        {#if conciergeState.notice}<p role="alert">
            {conciergeState.notice}
          </p>{/if}
        <p class="concierge__hint">
          No concierge services are available for this room.
        </p>
      {:else}
        {#if conciergeState.notice}<p role="alert">
            {conciergeState.notice}
          </p>{/if}
        <p class="concierge__hint">Select a service to send a request.</p>
        <div class="requests" role="group" aria-label="Service requests">
          {#each conciergeState.requests as request (request.uid)}{/each}
        </div>
      {/if}
    </Card>
  </section>
</section>

<style>
  /* Fill the page (the .page wrapper in PageOutlet is absolutely positioned
     over <main>) as a flex column: the header stays anchored top-left in
     normal flow, and the controls section below grows to take the remaining
     space and centres the card within it. */
  .page-body {
    box-sizing: border-box;
    min-height: 100%;
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: 1rem clamp(1rem, 5vw, 2rem);
    display: flex;
    flex-direction: column;
  }

  .page__header {
    flex-shrink: 0;
    margin-bottom: 1rem;
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

  .concierge {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* The Card renders with this forwarded class; :global() is needed because
     a page's scoped CSS can't otherwise reach inside the component. */
  .concierge > :global(.concierge__card) {
    width: 100%;
    max-width: 1100px;
  }

  .concierge__hint {
    margin: 0 0 1rem;
    font-size: 0.95rem;
    opacity: 0.7;
  }

  .requests {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
    gap: 0.75rem;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
