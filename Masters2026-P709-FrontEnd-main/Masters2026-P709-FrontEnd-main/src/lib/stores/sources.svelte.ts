// -----------------------------------------------------------------------------
// sources.svelte.ts — reactive state for the Sources page
// -----------------------------------------------------------------------------
// This file is the "model" for source selection. It knows nothing about
// SignalR or the Crestron backend. It just holds which source is currently
// routed, for any Sources UI to display.
//
// WHY IT LIVES IN /stores AND NOT /transport
//   Transport code (SignalR) changes when the backend changes.
//   Page components change when the design changes.
//   State is the stable middle layer that BOTH sides talk to — so it belongs
//   in its own file, imported by both sides but coupled to neither.
//
// WHY `.svelte.ts` (not `.ts`)
//   `$state(...)` is a Svelte 5 rune. The Svelte compiler only processes
//   `.svelte`, `.svelte.ts`, and `.svelte.js` files. A plain `.ts` file would
//   leave the rune unhandled and reactivity would silently break.
//
// NOTE ON STARTING THE SYSTEM FROM THIS PAGE
//   Selecting a source while the system is off is expected to start it — but
//   that is entirely the SERVER's responsibility. The client just sends
//   `setSource(id)` (see transport/sources.ts); the server starts the system
//   if needed, then broadcasts both the new system state and the new current
//   source. This store never guesses or sets system state itself.
// -----------------------------------------------------------------------------

// ── Source configuration ───────────────────────────────────────────────────
// `type` drives which icon is shown (see components/icons/SourceTypeIcon.svelte).
// `iconSvg` is only used when `type` is "other" — a custom glyph supplied by
// the Crestron program for a source that doesn't fit the built-in types. All
// other types always use their matching built-in icon, regardless of
// `iconSvg`.
export type SourceType =
  | 'tv'
  | 'ohp'
  | 'wirelessPresenter'
  | 'laptopHdmi'
  | 'laptopUsbC'
  | 'other';

// Static metadata for each selectable source. `id` is the string resource
// identifier used on the wire (sourceId), matching the unified API's
// identifier migration table.
export type Source = {
  id: string;
  name: string;
  type: SourceType;
  iconSvg?: string | null;
};

// Like `lightPresets` (see stores/lights.svelte.ts), the source catalogue is
// NOT hardcoded client-side config — it comes from the Crestron program's
// "GetRoomConfiguration" response. Empty until the first response arrives —
// see applyRoomConfiguration() in transport/signalr.svelte.ts, which calls
// applySources() below once per successful connect/reconnect.
export const SOURCES = $state<Source[]>([]);

// -----------------------------------------------------------------------------
// applySources — the ONE way the transport writes the source catalogue
// -----------------------------------------------------------------------------
// Called once per successful connect/reconnect, after "GetRoomConfiguration"
// resolves. Replaces the whole catalogue in place so the $state array stays
// reactive to anything iterating over it.
export function applySources(sources: Source[]): void {
  SOURCES.splice(0, SOURCES.length, ...sources);
}

// Optional room-output MJPEG stream from GetRoomConfiguration. This follows
// the display's routed output, so it is shared by every selectable source.
export const displayPreviewState = $state<{ url: string | null }>({ url: null });

export function applyDisplayPreviewUrl(url: string | null): void {
  displayPreviewState.url = url;
}

// ── Runtime state ───────────────────────────────────────────────────────────
// `current` is null until the server reports a source (e.g. right after
// connecting, or before any source has ever been selected).
// Stream status is unknown until the server broadcasts StreamRunningChanged.
export const sourcesState = $state<{
  current: string | null;
  isStreamRunning: boolean | null;
}>({
  current: null,
  isStreamRunning: null
});

export function applyStreamRunning(isRunning: boolean): void {
  sourcesState.isStreamRunning = isRunning;
}

// Track every selection update, including clears from system power feedback,
// so a pending snapshot cannot overwrite a newer update with the same id.
let currentSourceRevision = 0;

export function getCurrentSourceRevision(): number {
  return currentSourceRevision;
}

// -----------------------------------------------------------------------------
// applyCurrentSource — the ONE way the transport writes into sourcesState
// -----------------------------------------------------------------------------
// The SignalR handler calls this. Centralising the write keeps validation in
// one place and makes it trivial to add features later (e.g. persist to
// localStorage, log to a diagnostics buffer).
export function applyCurrentSource(sourceId: string | null): void {
  currentSourceRevision += 1;
  sourcesState.current = sourceId;
}

// clearCurrentSource — called when the system powers off, so a stale source
// selection from the previous session isn't shown as still "selected" (see
// transport/system.ts, which calls this on the "off" SystemPowerStateChanged
// broadcast).
export function clearCurrentSource(): void {
  applyCurrentSource(null);
}
