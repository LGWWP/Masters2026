// -----------------------------------------------------------------------------
// volume.ts — transport for the volume / mute domain
// -----------------------------------------------------------------------------
// Same pattern as transport/lights.ts and transport/system.ts:
//   1. Register inbound hub handlers (server -> UI).
//   2. Expose outbound commands (setVolume, setMute).
// The UI never changes its own state on a tap; it waits for the echo.
// Imported once, for its side effects, from App.svelte.
// -----------------------------------------------------------------------------

import { onHubReady, getHub } from './signalr.svelte';
import { applyVolume, applyMute } from '../stores/volume.svelte';

// Inbound. Contract with RoomHub (C#):
//   Clients.All.SendAsync("AudioMutedChanged", isMuted)         isMuted true/false
//   Clients.All.SendAsync("VolumeLevelChanged", levelPercent)   levelPercent 0..100
onHubReady((hub) => {

  hub.on('AudioMutedChanged', (isMuted: unknown) => {
    console.log('[SignalR ←] AudioMutedChanged', isMuted);
    if (typeof isMuted !== 'boolean') {
      console.warn('SignalR: bad AudioMutedChanged payload', isMuted);
      return;
    }
    applyMute(isMuted);
  });

  // TODO: UI Lab 1.4b - Register inbound hub handler for volume changes 
  // Hint: Use the mute handler above as a reference.
  // UI Lab 1.4b - End
});

export function setVolume(levelPercent: number): void {
  console.log('[Volume →] setVolume', levelPercent);

  const hub = getHub();
  if (!hub) {
    console.warn('setVolume: no hub connection, command dropped', { levelPercent });
    return;
  }
  hub.invoke('SetVolumeLevel', levelPercent).catch((err) => {
    console.warn('setVolume invoke failed', err);
  });
}

export function setMute(isMuted: boolean): void {
  console.log('[Volume →] setMute', isMuted);

  const hub = getHub();
  if (!hub) {
    console.warn('setMute: no hub connection, command dropped', { isMuted });
    return;
  }
  hub.invoke('SetAudioMuted', isMuted).catch((err) => {
    console.warn('setMute invoke failed', err);
  });
}
