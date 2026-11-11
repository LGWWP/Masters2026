// -----------------------------------------------------------------------------
// xpanel.ts — WebXPanel bridge: lets this app run as a browser-based virtual
// panel, not only embedded inside a Crestron touchscreen's native container.
// -----------------------------------------------------------------------------
// WebXPanel provides the low-level CIP/WS transport that CrComLib
// (crestron.ts) rides on top of. Once WebXPanel.initialize() runs, CrComLib's
// publishEvent/subscribeState automatically route over it — so
// onUrlChange/onCipConnectionChange in crestron.ts work the same whether the
// app is embedded in a touchscreen's native container or running here as a
// WebXPanel in a plain browser/tablet.
//
// Connection health is split into (up to) three independent links, all of
// which the Header's status dot cares about:
//   - CIP: the link between the app and the control system program.
//   - WS:  the websocket between this browser and the processor. Only
//     meaningful when NOT embedded in a container — the container manages
//     its own transport and WebXPanel is inert there.
//   - SignalR: the app's own C# backend link (transport/signalr.svelte.ts),
//     tracked separately and combined with CIP/WS in Header.svelte.
//
// CIP/WS are written into stores/connection.svelte.ts's `bridgeStatus`.
// `null` on a field means "not applicable in this run mode", so the Header's
// status dot never waits on a transport that doesn't exist here.
// -----------------------------------------------------------------------------

import { getWebXPanel, runsInContainerApp } from '@crestron/ch5-webxpanel';
import { onCipConnectionChange, onUrlChange } from './crestron';
import { setCipConnected, setWsConnected } from '../stores/connection.svelte';

const { WebXPanel, isActive, WebXPanelEvents, WebXPanelConfigParams } =
  getWebXPanel(!runsInContainerApp());

interface QueryParameters {
  host?: string;
  ipid?: string;
  port?: number;
  roomid?: string;
  tokenurl?: string;
  authtoken?: string;
  tokensource?: string;
  [key: string]: string | number | undefined;
}

// Reads WebXPanel connection parameters from the page's query string, e.g.
// ?host=10.0.0.5&ipid=0x03
function getQueryParameters(): QueryParameters {
  const url = new URL(window.location.href);
  const queries: QueryParameters = {};
  new URLSearchParams(url.search).forEach((value, key) => {
    queries[key.toLowerCase()] = value;
  });
  return queries;
}

interface ControlSystemParameters {
  host?: string;
  ipId?: string;
  roomId?: string;
}

// Virtual Panel supplies connection settings in assets/data/project-config.json;
// its URL parameters may contain only authentication details.
async function getProjectControlSystem(): Promise<ControlSystemParameters> {
  try {
    const response = await fetch('./assets/data/project-config.json', {
      cache: 'no-store'
    });
    if (!response.ok) return {};

    const projectInfo = (await response.json()) as {
      config?: {
        controlSystem?: Partial<Record<keyof ControlSystemParameters, unknown>>;
      };
    } | null;
    const controlSystem = projectInfo?.config?.controlSystem;
    const parameters: ControlSystemParameters = {};
    for (const key of ['host', 'ipId', 'roomId'] as const) {
      const value = controlSystem?.[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        parameters[key] = value.trim();
      }
    }
    return parameters;
  } catch (err) {
    console.warn('Unable to load assets/data/project-config.json; using URL parameters and defaults.', err);
    return {};
  }
}

let unsubscribeUrlChange: (() => void) | undefined;
let urlCallback: ((url: string) => void) | undefined;
// The last *valid* hub URL we've parsed out of the raw join. Lets a caller
// that registers late (see onProcessorUrl below) immediately get whatever
// already arrived, instead of only hearing about the NEXT change.
let latestHubUrl: string | undefined;

// The processor publishes serial join 1 as a JSON payload (not a bare URL
// string), e.g. '{"hubUrl":"http://192.168.200.115:5001/hubs/room"}'. Pull
// the actual hub URL out of it. Returns undefined (and warns) if the raw
// value isn't valid JSON or doesn't contain a usable "hubUrl" string — the
// caller should simply not update SIGNALR_URL in that case, rather than
// handing SignalR a garbage value it will mis-resolve against the page's own
// origin.
function parseHubUrl(raw: string): string | undefined {
  if (!raw) return undefined;

  try {
    const payload = JSON.parse(raw) as { hubUrl?: unknown };
    if (typeof payload.hubUrl === 'string' && payload.hubUrl.length > 0) {
      return payload.hubUrl;
    }
    console.warn('Processor URL join (1) payload is missing a string "hubUrl" field:', raw);
  } catch (err) {
    console.warn('Processor URL join (1) payload is not valid JSON:', raw, err);
  }

  return undefined;
}

// Re-subscribing forces the current join value to be re-delivered, which is
// needed after a WS reconnect since a subscription that was already active
// won't refire on an unchanged value.
function resubscribeToProcessorUrl(): void {
  unsubscribeUrlChange?.();
  try {
    unsubscribeUrlChange = onUrlChange((raw) => {
      const hubUrl = parseHubUrl(raw);
      if (!hubUrl) return;
      latestHubUrl = hubUrl;
      urlCallback?.(hubUrl);
    });
  } catch (err) {
    console.warn('Failed to subscribe to processor URL changes', err);
  }
}

// Subscribe to the raw processor URL join RIGHT NOW, at module load — not
// deferred until App.svelte calls onProcessorUrl() from onMount. If we
// waited, there'd be a real window between this module loading and Svelte's
// first onMount during which the processor could publish join 1 (e.g. right
// as CIP connects) and have it missed forever, since the program may only
// ever send it once rather than repeatedly. Subscribing immediately closes
// that window; latestHubUrl (below) then replays it to App.svelte whenever
// it does register.
resubscribeToProcessorUrl();

// Registers the single callback for the processor-supplied SignalR hub URL,
// extracted from the join 1 JSON payload (see parseHubUrl above; the raw
// join itself is read via crestron.ts's onUrlChange, subscribed immediately
// above). App.svelte uses this to populate SIGNALR_URL. If a value already
// arrived before this is called, it's replayed synchronously so a late
// registration never misses it. Returns an unsubscribe function.
export function onProcessorUrl(callback: (url: string) => void): () => void {
  urlCallback = callback;
  if (latestHubUrl) callback(latestHubUrl);

  return () => {
    if (urlCallback === callback) urlCallback = undefined;
  };
}

async function initializeWebXPanel(): Promise<void> {
  const entries = getQueryParameters();
  const controlSystem = await getProjectControlSystem();

  WebXPanelConfigParams.host = controlSystem.host ?? entries.host ?? window.location.hostname;
  // toLowerCase ensures an accidentally-entered "0X00" IPID still works.
  WebXPanelConfigParams.ipId = (controlSystem.ipId ?? entries.ipid ?? '0x03').toLowerCase();
  WebXPanelConfigParams.port = entries.port ?? 49200;
  WebXPanelConfigParams.roomId = controlSystem.roomId ?? entries.roomid ?? '';
  WebXPanelConfigParams.tokenSource = entries.tokensource ?? 'CSSelf';
  WebXPanelConfigParams.authToken = entries.authtoken ?? '';
  WebXPanelConfigParams.tokenUrl =
    WebXPanelConfigParams.roomId.length > 0
      ? `https://${WebXPanelConfigParams.host}/VirtualControl/Rooms/${WebXPanelConfigParams.roomId}/cws/websocket/getWebSocketToken`
      : (entries.tokenurl ??
        `https://${WebXPanelConfigParams.host}/cws/websocket/getWebSocketToken`);

  console.log('WebXPanel is active — running as a standalone virtual panel.', WebXPanelConfigParams);
  try {
    WebXPanel.initialize(WebXPanelConfigParams);
  } catch (err) {
    console.error('WebXPanel.initialize() threw:', err);
  }
}

if (isActive) {
  // Running as a standalone WebXPanel (e.g. a browser or tablet, not
  // embedded in a Crestron touchscreen's native container): WebXPanel owns
  // both the CIP and WS transports, so track both.
  WebXPanel.addEventListener(WebXPanelEvents.CONNECT_CIP, () =>
    { setCipConnected(true); console.log('WebXPanel: CIP connected.'); }
  );
  WebXPanel.addEventListener(WebXPanelEvents.DISCONNECT_CIP, () => setCipConnected(false));

  WebXPanel.addEventListener(WebXPanelEvents.CONNECT_WS, () => {
    setWsConnected(true);
    console.log('WebXPanel: WS connected.');
    // The server URL arrives over this WS via the join CrComLib subscribes
    // to; a plain subscription won't refire if the value hasn't changed
    // since the last connection, so force a fresh delivery here.
    resubscribeToProcessorUrl();
  });
  WebXPanel.addEventListener(WebXPanelEvents.DISCONNECT_WS, () => setWsConnected(false));
  WebXPanel.addEventListener(WebXPanelEvents.ERROR_WS, (e: CustomEvent) =>
    { setWsConnected(false); console.error('WebXPanel WS error:', e?.detail ?? e); }
  );
  WebXPanel.addEventListener(WebXPanelEvents.WEB_WORKER_FAILED, (e: CustomEvent) =>
    { setWsConnected(false); console.error('WebXPanel web worker failed:', e?.detail ?? e); }
  );
  WebXPanel.addEventListener(WebXPanelEvents.AUTHENTICATION_FAILED, (e: CustomEvent) =>
    { setWsConnected(false); console.error('WebXPanel authentication failed:', e?.detail ?? e); }
  );
  WebXPanel.addEventListener(WebXPanelEvents.AUTHENTICATION_REQUIRED, () =>
    { setWsConnected(false); console.warn('WebXPanel authentication required.'); }
  );
  WebXPanel.addEventListener(WebXPanelEvents.FETCH_TOKEN_FAILED, (e: CustomEvent) =>
    { setWsConnected(false); console.error('WebXPanel failed to fetch connection token:', e?.detail ?? e); }
  );
  WebXPanel.addEventListener(WebXPanelEvents.INVALID_MAC_ADDRESS, () =>
    { setWsConnected(false); console.error('WebXPanel reported an invalid MAC address.'); }
  );
  WebXPanel.addEventListener(WebXPanelEvents.INVALID_CREDENTIALS, () =>
    { setWsConnected(false); console.error('WebXPanel reported invalid credentials.'); }
  );
  WebXPanel.addEventListener(WebXPanelEvents.NOT_AUTHORIZED, (e: CustomEvent) =>
    { setWsConnected(false); console.error('WebXPanel: not authorized.', e?.detail ?? e); }
  );

  void initializeWebXPanel();
} else if (runsInContainerApp()) {
  // Embedded in a Crestron touchscreen's native container app: CIP and WS
  // are both managed by the container itself, outside this app's control.
  // Only CIP feedback is exposed back to the app (via the reserved join in
  // crestron.ts, which also logs the connect/disconnect status itself); WS
  // is not applicable here, so bridgeStatus.ws stays null.
  console.log("Running inside a Crestron touchscreen's native container app.");
  onCipConnectionChange(setCipConnected);
} else {
  // Plain browser during development, no container and no active WebXPanel:
  // there is no Crestron bridge at all. Leave cip/ws as `null` (not
  // applicable) so the Header's status dot reflects SignalR alone.
  console.warn('No Crestron bridge available (plain browser, WebXPanel inactive).');
}
