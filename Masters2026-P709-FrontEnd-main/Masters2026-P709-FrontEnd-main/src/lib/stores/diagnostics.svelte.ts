// -----------------------------------------------------------------------------
// diagnostics.svelte.ts — reactive state for AI room diagnostics (MCP hub)
// -----------------------------------------------------------------------------
// Same role as every other store in this folder: it only HOLDS state. It
// knows nothing about SignalR. The transport layer (transport/diagnostics.ts)
// writes into it through the apply*() functions below; the Support page reads
// from `diagnosticsState` and re-renders automatically (this file is
// `.svelte.ts` so the `$state` rune works).
//
// WHAT THE STATE MEANS
//   mcpHubUrl        — full URL of the MCP hub, resolved from the room hub's
//                      host plus the `mcpHubPath` published in the room
//                      configuration (see applyRoomConfiguration() in
//                      transport/signalr.svelte.ts). Empty means diagnostics
//                      are not configured for this room — the Support page
//                      hides the diagnostics UI entirely in that case.
//   hubConnected     — true while the MCP hub connection is up. Reflected in
//                      the UI the same way as the room hub ("disconnected"
//                      state), and state is re-queried on reconnect.
//   mcpStatus        — MCP Gateway registration state (for example
//                      "Registered"), from GetMcpStatus / McpStatusChanged.
//   troubleshooting  — the whole troubleshooting state, pushed by the hub
//                      after every change (TroubleshootingStateChanged) and
//                      queried once on connect (GetTroubleshootingState) so a
//                      panel that opens mid-conversation joins it already in
//                      progress.
// -----------------------------------------------------------------------------

// Mirrors the hub's troubleshooting state payload (camelCase on the wire).
export type TroubleshootingState = {
  // false when no Anthropic API key is configured, or MCP is off; `status`
  // carries the reason. StartTroubleshooting does nothing in that case.
  isAvailable: boolean;
  // true while Claude is working on a turn — disable every control.
  isBusy: boolean;
  // Status line: progress, the answer just chosen, or why a turn failed.
  // Shown, but not part of the conversation transcript.
  status: string;
  // Claude's latest message. Empty while the next one is being produced.
  message: string;
  // Answers the user can pick from, in display order. AnswerTroubleshooting
  // takes an index into this array.
  answerOptions: string[];
  // The option index just chosen, or null once a new message arrives.
  selectedAnswerIndex: number | null;
  // Claude considers the conversation finished — offer to start a new one.
  isDone: boolean;
};

export function emptyTroubleshootingState(): TroubleshootingState {
  return {
    isAvailable: false,
    isBusy: false,
    status: '',
    message: '',
    answerOptions: [],
    selectedAnswerIndex: null,
    isDone: false
  };
}

export const diagnosticsState = $state<{
  mcpHubUrl: string;
  hubConnected: boolean;
  mcpStatus: string;
  troubleshooting: TroubleshootingState;
}>({
  mcpHubUrl: '',
  hubConnected: false,
  mcpStatus: '',
  troubleshooting: emptyTroubleshootingState()
});

// -----------------------------------------------------------------------------
// apply*() — the ONE way the transport writes into the store (same idea as
// applyLightLevel() in lights.svelte.ts). Payload validation happens in the
// transport, because that is where the untrusted wire lives.
// -----------------------------------------------------------------------------

export function applyMcpHubUrl(url: string): void {
  diagnosticsState.mcpHubUrl = url;
  // A room without diagnostics (or a URL change) invalidates everything we
  // knew: blank the state so the UI never shows another hub's conversation.
  if (url === '') {
    diagnosticsState.hubConnected = false;
    diagnosticsState.mcpStatus = '';
    diagnosticsState.troubleshooting = emptyTroubleshootingState();
  }
}

export function applyMcpHubConnected(connected: boolean): void {
  diagnosticsState.hubConnected = connected;
}

export function applyMcpStatus(status: string): void {
  diagnosticsState.mcpStatus = status;
}

export function applyTroubleshootingState(state: TroubleshootingState): void {
  diagnosticsState.troubleshooting = state;
}
