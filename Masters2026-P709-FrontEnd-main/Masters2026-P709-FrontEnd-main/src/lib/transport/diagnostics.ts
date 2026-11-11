// -----------------------------------------------------------------------------
// diagnostics.ts — transport for AI room diagnostics (the MCP hub)
// -----------------------------------------------------------------------------
// Same two responsibilities as every other transport module (see lights.ts):
//   1. Register inbound hub handlers.
//   2. Expose outbound command functions the UI calls.
//
// ONE IMPORTANT DIFFERENCE: troubleshooting lives on its OWN SignalR hub
// (`/hubs/mcp` by default), not the room hub managed by signalr.svelte.ts.
// It is a second, independent connection using the same @microsoft/signalr
// client — the MCP hub is not multiplexed on the room hub.
//
// DISCOVERY: diagnostics are entirely optional per room. The room hub's
// GetRoomConfiguration response carries `mcpHubPath` only when MCP /
// troubleshooting is configured. signalr.svelte.ts resolves that path
// against the room hub's host (same scheme/host/port) and hands the full
// URL to setMcpHub() below — nothing here is hard-coded.
//
// WIRE CONTRACT (the MCP hub)
//   Queries (client → hub, request/response):
//     GetTroubleshootingState()        — the current troubleshooting state
//     GetMcpStatus()                   — MCP Gateway registration state string
//   Commands (client → hub, fire-and-forget — results arrive as events):
//     StartTroubleshooting()           — start a new conversation; ignored
//                                        while busy or unavailable
//     AnswerTroubleshooting(optionIndex) — answer with the option at that
//                                        index in the current answerOptions
//   Events (hub → client):
//     TroubleshootingStateChanged(state) — the whole state, after every change
//     McpStatusChanged(status)           — gateway registration state changed
//
// Nothing is pushed automatically on connect, so both queries run once per
// connect/reconnect to fill in the initial UI; after that the events keep it
// current. Commands return no data: the UI updates from the events, so every
// connected panel shows the same conversation.
// -----------------------------------------------------------------------------

import * as signalR from '@microsoft/signalr';
import {
  applyMcpHubConnected,
  applyMcpHubUrl,
  applyMcpStatus,
  applyTroubleshootingState,
  diagnosticsState,
  type TroubleshootingState
} from '../stores/diagnostics.svelte';

// How long to wait between "cold start" retry attempts while the MCP hub is
// not yet reachable. Mirrors the room hub's cold-retry loop; once connected,
// SignalR's withAutomaticReconnect takes over.
const COLD_RETRY_MS = 5000;

// -----------------------------------------------------------------------------
// Module-level state (private)
// -----------------------------------------------------------------------------
let mcpHub: signalR.HubConnection | null = null;
// The URL the current `mcpHub` was built for. If the room config later
// publishes a different path, the stale connection is torn down and rebuilt.
let mcpHubUrl = '';
let coldRetryTimer: ReturnType<typeof setTimeout> | null = null;

// -----------------------------------------------------------------------------
// setMcpHub — called by signalr.svelte.ts whenever GetRoomConfiguration lands
// -----------------------------------------------------------------------------
// `url` is the fully-resolved MCP hub URL, or null when the room has no
// diagnostics configured (no `mcpHubPath`). Connects eagerly — the hub is the
// shared source of truth for an in-progress conversation, so a panel opening
// the Support page mid-conversation must already have the state.
export function setMcpHub(url: string | null): void {
  const next = url ?? '';

  if (next === mcpHubUrl) return; // unchanged — keep the live connection

  teardown();
  mcpHubUrl = next;
  applyMcpHubUrl(next);

  if (next !== '') connect(next);
}

// -----------------------------------------------------------------------------
// Outbound: startTroubleshooting — wired to the Start button
// -----------------------------------------------------------------------------
// Fire-and-forget: the hub returns immediately and Claude's first turn
// arrives as a TroubleshootingStateChanged event. The hub itself ignores the
// call while busy or unavailable; the guards here just avoid pointless wire
// traffic (the UI disables the button too — belt & braces).
export function startTroubleshooting(): void {
  console.log('[Diagnostics →] StartTroubleshooting');

  const t = diagnosticsState.troubleshooting;
  if (t.isBusy || !t.isAvailable) return;

  const hub = connectedHub();
  if (!hub) {
    console.warn('startTroubleshooting: no MCP hub connection, command dropped');
    return;
  }

  hub.invoke('StartTroubleshooting').catch((err) => {
    console.warn('StartTroubleshooting invoke failed', err);
  });
}

// -----------------------------------------------------------------------------
// Outbound: answerTroubleshooting — wired to the answer buttons
// -----------------------------------------------------------------------------
// `optionIndex` is a 0-based index into the current state's answerOptions —
// the index is sent, not the text. Ignored by the hub while busy, with no
// running conversation, or for an index that is not a current option.
export function answerTroubleshooting(optionIndex: number): void {
  console.log('[Diagnostics →] AnswerTroubleshooting', { optionIndex });

  const t = diagnosticsState.troubleshooting;
  if (t.isBusy) return;
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= t.answerOptions.length) {
    console.warn('answerTroubleshooting: index out of range', optionIndex);
    return;
  }

  const hub = connectedHub();
  if (!hub) {
    console.warn('answerTroubleshooting: no MCP hub connection, command dropped', { optionIndex });
    return;
  }

  hub.invoke('AnswerTroubleshooting', optionIndex).catch((err) => {
    console.warn('AnswerTroubleshooting invoke failed', err);
  });
}

// -----------------------------------------------------------------------------
// Connection lifecycle
// -----------------------------------------------------------------------------
// Handlers are registered BEFORE start() so the very first inbound message
// can't be missed (same reasoning as initSignalR in signalr.svelte.ts).
// Drops are treated the same way as the room hub: reflect "disconnected" in
// the UI and re-query state once reconnected.
function connect(url: string): void {
  const hub = new signalR.HubConnectionBuilder()
    .withUrl(url)
    .configureLogging(signalR.LogLevel.Information)
    .withAutomaticReconnect({
      nextRetryDelayInMilliseconds: (ctx) => (ctx.previousRetryCount < 10 ? 1000 : 5000)
    })
    .build();

  registerInbound(hub);

  hub.onreconnecting(() => {
    if (hub !== mcpHub) return;
    applyMcpHubConnected(false);
  });
  hub.onreconnected(() => {
    if (hub !== mcpHub) return;
    applyMcpHubConnected(true);
    fetchInitialState(hub);
  });
  hub.onclose(() => {
    if (hub !== mcpHub) return; // torn down deliberately — nothing to heal
    applyMcpHubConnected(false);
    scheduleColdRetry();
  });

  mcpHub = hub;
  tryStart();
}

function tryStart(): void {
  const hub = mcpHub;
  if (!hub) return;
  hub
    .start()
    .then(() => {
      if (hub !== mcpHub) return;
      console.log(`MCP hub connected to ${mcpHubUrl}.`);
      applyMcpHubConnected(true);
      fetchInitialState(hub);
    })
    .catch((err) => {
      if (hub !== mcpHub) return;
      console.warn(`MCP hub connection to ${mcpHubUrl} failed:`, err);
      scheduleColdRetry();
    });
}

function scheduleColdRetry(): void {
  if (coldRetryTimer !== null) return; // already scheduled
  coldRetryTimer = setTimeout(() => {
    coldRetryTimer = null;
    tryStart();
  }, COLD_RETRY_MS);
}

function teardown(): void {
  if (coldRetryTimer !== null) {
    clearTimeout(coldRetryTimer);
    coldRetryTimer = null;
  }
  if (mcpHub) {
    const stale = mcpHub;
    mcpHub = null; // detach first so lifecycle callbacks know it's deliberate
    stale.stop().catch(() => {});
  }
  mcpHubUrl = '';
}

function connectedHub(): signalR.HubConnection | null {
  return mcpHub && mcpHub.state === signalR.HubConnectionState.Connected ? mcpHub : null;
}

// -----------------------------------------------------------------------------
// Queries — run once per connect/reconnect to fill in the initial UI
// -----------------------------------------------------------------------------
function fetchInitialState(hub: signalR.HubConnection): void {
  hub
    .invoke('GetTroubleshootingState')
    .then((state: unknown) => {
      console.log('[Diagnostics ←] GetTroubleshootingState', state);
      const normalized = normalizeTroubleshootingState(state);
      if (normalized) {
        applyTroubleshootingState(normalized);
      } else {
        console.warn('Diagnostics: bad GetTroubleshootingState payload', state);
      }
    })
    .catch((err) => console.warn('GetTroubleshootingState invoke failed', err));

  hub
    .invoke('GetMcpStatus')
    .then((status: unknown) => {
      console.log('[Diagnostics ←] GetMcpStatus', status);
      if (typeof status === 'string') {
        applyMcpStatus(status);
      } else {
        console.warn('Diagnostics: bad GetMcpStatus payload', status);
      }
    })
    .catch((err) => console.warn('GetMcpStatus invoke failed', err));
}

// -----------------------------------------------------------------------------
// Inbound handlers — every write goes through the store's apply*() functions,
// with runtime validation because the wire is untrusted.
// -----------------------------------------------------------------------------
function registerInbound(hub: signalR.HubConnection): void {
  hub.on('TroubleshootingStateChanged', (state: unknown) => {
    console.log('[Diagnostics ←] TroubleshootingStateChanged', state);
    const normalized = normalizeTroubleshootingState(state);
    if (!normalized) {
      console.warn('Diagnostics: bad TroubleshootingStateChanged payload', state);
      return;
    }
    applyTroubleshootingState(normalized);
  });

  hub.on('McpStatusChanged', (status: unknown) => {
    console.log('[Diagnostics ←] McpStatusChanged', status);
    if (typeof status !== 'string') {
      console.warn('Diagnostics: bad McpStatusChanged payload', status);
      return;
    }
    applyMcpStatus(status);
  });
}

// Validates + copies a troubleshooting state payload off the wire. Returns
// null for anything malformed so callers can log and drop it.
function normalizeTroubleshootingState(value: unknown): TroubleshootingState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;

  if (
    typeof s.isAvailable !== 'boolean' ||
    typeof s.isBusy !== 'boolean' ||
    typeof s.status !== 'string' ||
    typeof s.message !== 'string' ||
    !Array.isArray(s.answerOptions) ||
    !s.answerOptions.every((o) => typeof o === 'string') ||
    !(s.selectedAnswerIndex === null || s.selectedAnswerIndex === undefined ||
      Number.isInteger(s.selectedAnswerIndex)) ||
    typeof s.isDone !== 'boolean'
  ) {
    return null;
  }

  return {
    isAvailable: s.isAvailable,
    isBusy: s.isBusy,
    status: s.status,
    message: s.message,
    answerOptions: [...(s.answerOptions as string[])],
    selectedAnswerIndex:
      s.selectedAnswerIndex === undefined ? null : (s.selectedAnswerIndex as number | null),
    isDone: s.isDone
  };
}
