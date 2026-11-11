// -----------------------------------------------------------------------------
// room.svelte.ts — reactive state for room-wide metadata (name, etc.)
// -----------------------------------------------------------------------------
// This file is the "model" for the room itself. It knows nothing about
// SignalR or the Crestron backend. It just holds the room name for any UI
// (Header, etc.) to display.
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
// `roomName` starts out as the local fallback (config.ts ROOM_NAME) and is
// replaced once "GetRoomConfiguration" resolves — see applyRoomConfiguration()
// in transport/signalr.svelte.ts, which calls applyRoomName() below once per
// successful connect/reconnect. `roomSvg` is the server's own floor-plan
// illustration (inline <svg> markup); it starts `null` and the Lights page
// falls back to its own bundled default until the server sends one — see
// stores/lights pattern comments for why this split (local default vs
// server override) is used throughout this app.
import { ROOM_NAME } from '../config';

export const roomState = $state<{ name: string; roomSvg: string | null }>({
  name: ROOM_NAME,
  roomSvg: null
});

// -----------------------------------------------------------------------------
// applyRoomName — the ONE way the transport writes into roomState
// -----------------------------------------------------------------------------
// The SignalR handler calls this. Centralising the write keeps validation in
// one place and makes it trivial to add features later (e.g. persist to
// localStorage, log to a diagnostics buffer).
export function applyRoomName(name: string): void {
  roomState.name = name;
}

// -----------------------------------------------------------------------------
// applyRoomSvg — the ONE way the transport writes the room's floor-plan SVG
// -----------------------------------------------------------------------------
export function applyRoomSvg(svg: string): void {
  roomState.roomSvg = svg;
}
