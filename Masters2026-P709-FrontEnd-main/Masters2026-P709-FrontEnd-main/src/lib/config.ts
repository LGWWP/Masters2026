// Settings shared by several components.
// ROOM_NAME is only the local fallback shown before the server's
// "GetRoomConfiguration" response arrives (or if it never does). Once
// connected, the room name is dynamic — see stores/room.svelte.ts and
// applyRoomConfiguration() in transport/signalr.svelte.ts.
export const ROOM_NAME = '';
