<!--
  Support.svelte
  =============================================================================
  Support page — hosts AI room diagnostics (the MCP hub troubleshooting
  conversation).

  Transport pattern (same as every other page)
  ──────────────────────────────────────────────
  User action → startTroubleshooting() / answerTroubleshooting(i) → MCP hub
              → TroubleshootingStateChanged → diagnosticsState update
              → reactive re-render

  Diagnostics run on their OWN SignalR hub, discovered via `mcpHubPath` in
  the room configuration (see transport/diagnostics.ts). The feature is
  entirely optional per room: when no MCP hub is configured, this page shows
  no diagnostics UI at all.

  The Start/Restart button also fires itself automatically once per visit,
  as soon as the MCP hub connects and diagnostics are available — opening
  this page is enough to kick off (or restart) a conversation.

  Controls:
    * Start button    — starts a new conversation (StartTroubleshooting).
                        Disabled while busy or when diagnostics are
                        unavailable (`isAvailable: false`) — `status` carries
                        the reason in that case.
    * Status window   — the state's status line, with a busy indicator while
                        Claude is working on a turn.
    * Message window  — Claude's latest message; scrolls when it is longer
                        than the window.
    * Answer buttons  — one per entry in answerOptions; the index (not the
                        text) is sent. All are disabled while busy, and the
                        just-chosen one stays highlighted via
                        selectedAnswerIndex until the next message arrives.
-->

<svelte:options runes />

<script lang="ts">
  import Card from '../ui/Card.svelte';
  import { diagnosticsState } from '../../stores/diagnostics.svelte';
  import { startTroubleshooting, answerTroubleshooting } from '../../transport/diagnostics';

  const t = $derived(diagnosticsState.troubleshooting);

  // Commands are pointless while busy, unavailable, or disconnected — the
  // transport guards too, but disabling the controls tells the user why.
  const controlsDisabled = $derived(t.isBusy || !diagnosticsState.hubConnected);

  // A conversation is "in progress" once Claude has said something and isn't
  // done yet — then Start acts as a restart.
  const inConversation = $derived(
    !t.isDone && (t.message !== '' || t.answerOptions.length > 0)
  );

  // Press Start/Restart automatically as soon as the page is opened, instead
  // of waiting for the user to tap it — PageOutlet remounts this component
  // fresh on every navigation (see its `{#key nav.current}`), so this effect
  // runs once per visit. It waits for the MCP hub connection (and the
  // GetTroubleshootingState query that follows it) before firing, the same
  // conditions that gate the button itself, and only fires once per mount.
  let autoStarted = $state(false);
  $effect(() => {
    if (autoStarted) return;
    if (!diagnosticsState.mcpHubUrl || controlsDisabled || !t.isAvailable) return;
    autoStarted = true;
    startTroubleshooting();
  });

  const statusText = $derived.by(() => {
    if (!diagnosticsState.hubConnected) return 'Disconnected from diagnostics — reconnecting…';
    if (t.status !== '') return t.status;
    if (!t.isAvailable) return 'Diagnostics are currently unavailable.';
    return 'Press Start to begin diagnostics.';
  });
</script>

<section class="page-body" aria-labelledby="support-title">
  <header class="page__header">
    <h1 id="support-title">Support</h1>
  </header>

  {#if diagnosticsState.mcpHubUrl}
    <h2 id="diagnostics-title">AI room diagnostics</h2>
    <section class="diagnostics" aria-labelledby="diagnostics-title">
      <Card class="diagnostics__card">
        <!-- ── Start + status row ───────────────────────────────────────── -->
        <div class="diagnostics__top">
          <button
            class="start-button"
            onclick={startTroubleshooting}
            disabled={controlsDisabled || !t.isAvailable}
          >
            {t.isDone ? 'Start new' : inConversation ? 'Restart' : 'Start'}
          </button>

          <div class="status-window" role="status" aria-label="Diagnostics status">
            {#if t.isBusy}
              <span class="status-spinner" aria-hidden="true"></span>
            {/if}
            <span class="status-text">{statusText}</span>
          </div>
        </div>

        <!-- ── Message window (scrolls when the message is long) ────────── -->
        <div class="message-window" aria-label="Diagnostics message" aria-live="polite">
          {#if t.message}
            <p class="message-text">{t.message}</p>
          {:else}
            <p class="message-text message-text--empty">
              The assistant's message will appear here.
            </p>
          {/if}
        </div>

        <!-- ── Answer buttons — one per option, index is what gets sent ─── -->
        <div class="answers" aria-label="Answers">
          {#each t.answerOptions as option, i (i)}
            <button
              class="answer-button"
              class:answer-button--selected={i === t.selectedAnswerIndex}
              aria-pressed={i === t.selectedAnswerIndex}
              onclick={() => answerTroubleshooting(i)}
              disabled={controlsDisabled || t.isDone}
            >
              {option}
            </button>
          {/each}
          {#if t.answerOptions.length === 0 && inConversation && !t.isBusy}
            <p class="answers-empty">No answers required right now.</p>
          {/if}
          {#if t.isDone}
            <p class="answers-empty">
              This conversation is finished — press Start new to begin another.
            </p>
          {/if}
        </div>

        {#if diagnosticsState.mcpStatus}
          <p class="gateway-status">MCP Gateway: {diagnosticsState.mcpStatus}</p>
        {/if}
      </Card>
    </section>
  {:else}
    <section class="diagnostics">
      <p class="diagnostics-unavailable">
        AI room diagnostics are not configured for this room.
      </p>
    </section>
  {/if}
</section>

<style>
  /* Fill the page (the .page wrapper in PageOutlet is absolutely positioned
     over <main>) as a flex column: the header stays anchored top-left in
     normal flow, and the diagnostics section below grows to take the
     remaining space and centres the card within it. */
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

  .page__header { flex-shrink: 0; margin-bottom: 1rem; }
  .page__header h1 { margin: 0; font-size: 1.5rem; letter-spacing: 0.02em; }

  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.45;
  }

  .diagnostics {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .diagnostics-unavailable {
    font-size: 0.95rem;
    opacity: 0.5;
  }

  /* The Card renders with this forwarded class; :global() is needed because
     a page's scoped CSS can't otherwise reach inside the component. */
  .diagnostics > :global(.diagnostics__card) {
    width: 100%;
    max-width: 720px;
  }

  /* ── Start + status row ─────────────────────────────────────────────── */
  .diagnostics__top {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .start-button {
    flex-shrink: 0;
    appearance: none;
    font: inherit;
    font-weight: 600;
    color: #fff;
    background: rgb(var(--accent-rgb) / 0.85);
    border: 1px solid rgb(var(--accent-rgb));
    border-radius: 10px;
    padding: 0.6rem 1.5rem;
    cursor: pointer;
    transition: background 200ms, opacity 200ms, transform 80ms;
  }
  .start-button:active:not(:disabled) { transform: scale(0.97); }
  .start-button:disabled { opacity: 0.45; cursor: default; }

  .status-window {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.85rem;
    background: rgb(var(--ink) / 0.06);
    border: 1px solid rgb(var(--ink) / 0.08);
    border-radius: 10px;
  }

  .status-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.95rem;
    opacity: 0.85;
  }

  .status-spinner {
    flex-shrink: 0;
    width: 0.9rem;
    height: 0.9rem;
    border: 2px solid rgb(var(--accent-rgb) / 0.3);
    border-top-color: rgb(var(--accent-rgb));
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Message window — fixed height, scrolls when the message is long ── */
  .message-window {
    box-sizing: border-box;
    padding: 0.85rem 1rem;
    background: rgb(var(--ink) / 0.06);
    border: 1px solid rgb(var(--ink) / 0.08);
    border-radius: 10px;
    /* Always exactly 5 lines tall (plus padding) so the layout never jumps
       as messages of different lengths arrive; longer messages scroll. */
    height: calc(1.5em * 5 + 1.7rem);
    overflow-y: auto;
  }

  .message-text {
    margin: 0;
    line-height: 1.5;
  }

  .message-text--empty { opacity: 0.4; }

  /* ── Answer buttons ─────────────────────────────────────────────────── */
  .answers {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.75rem;
    /* Reserve a typical worst-case height (2 rows of buttons) so the card
       doesn't resize as the number of options changes between turns. With
       fewer rows, align-content centres them vertically. */
    min-height: 8rem;
    align-content: center;
  }

  .answer-button {
    appearance: none;
    font: inherit;
    text-align: left;
    color: inherit;
    background: rgb(var(--surface-hi) / 0.5);
    border: 1px solid rgb(var(--ink) / 0.15);
    border-radius: 10px;
    padding: 0.75rem 1rem;
    cursor: pointer;
    transition: border-color 200ms, background 200ms, opacity 200ms, transform 80ms;
  }
  .answer-button:active:not(:disabled) { transform: scale(0.98); }
  .answer-button:not(:disabled):hover { border-color: rgb(var(--accent-rgb) / 0.7); }
  .answer-button:disabled { opacity: 0.45; cursor: default; }

  /* The option just chosen — stays highlighted (even while disabled during
     the busy phase) until the next message clears selectedAnswerIndex. */
  .answer-button--selected,
  .answer-button--selected:disabled {
    border-color: rgb(var(--accent-rgb));
    background: rgb(var(--accent-rgb) / 0.18);
    opacity: 1;
  }

  .answers-empty {
    margin: auto 0;
    grid-column: 1 / -1;
    font-size: 0.9rem;
    opacity: 0.5;
  }

  .gateway-status {
    margin: 0.25rem 0 0;
    font-size: 0.8rem;
    opacity: 0.45;
  }
</style>
