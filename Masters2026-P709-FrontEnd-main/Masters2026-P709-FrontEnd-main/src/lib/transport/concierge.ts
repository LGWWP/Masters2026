// -----------------------------------------------------------------------------
// concierge.ts — HTTP transport for the Concierge domain
// -----------------------------------------------------------------------------
// This is the ONLY file that talks to the Concierge API. The page calls
// startConcierge() while mounted and sendConciergeRequest() on a service tap;
// it does not need to know endpoint paths, authentication, or polling rules.
//
// Unlike lights.ts, this domain talks directly to an HTTP API rather than
// invoking the Crestron hub. SignalR supplies the room's Concierge settings
// through stores/concierge.svelte.ts; HTTP supplies availability, the service
// catalogue, and the result of each request.
//
// This file owns NO reactive state. State lives in stores/concierge.svelte.ts.
// It DOES own the polling lifecycle and private request-ordering counters.
// The UI shows "sending" immediately, but only the API response can confirm
// that a service request was sent — the same confirmation principle as Lights.
// -----------------------------------------------------------------------------

import {
  applyConciergeServices,
  conciergeState,
  DEFAULT_OFFLINE_MESSAGE,
  type ConciergeConfig,
  type ConciergeRequest,
  type ConciergeService
} from '../stores/concierge.svelte';

// Let callers import the lifecycle function and its config type together;
// the store remains the single definition of the configuration shape.
export type { ConciergeConfig } from '../stores/concierge.svelte';

// -----------------------------------------------------------------------------
// Timing — polling, HTTP deadlines, and transient request feedback
// -----------------------------------------------------------------------------
// Health checks wait 10s AFTER the previous poll finishes, so a slow API
// does not create overlapping polls within the same lifecycle. Health and
// service-list reads have a 15s deadline; /callService disables that deadline.
// A completed request shows its result for 3s before becoming tappable again.
const HEALTH_INTERVAL_MS = 10000;
const REQUEST_TIMEOUT_MS = 15000;
const RESULT_DISPLAY_MS = 3000;

// -----------------------------------------------------------------------------
// Wire validation and error handling
// -----------------------------------------------------------------------------
// A structured non-2xx API response carries { error, message }. Preserve the
// machine-readable error code for recovery (e.g. ServiceDisabledForRoom) and
// the server's message for display. Network/JSON/shape failures stay ordinary
// Errors so they can use a local fallback message instead.
class ConciergeApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// JSON starts as unknown. Exclude null and arrays before reading object
// fields, then let each endpoint validate its own response contract.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A catalogue entry needs a non-empty uid and string display fields. The
// full catalogue check below also rejects duplicate uids.
function isService(value: unknown): value is ConciergeService {
  return isRecord(value) && typeof value.uid === 'string' && value.uid.length > 0 &&
    typeof value.name === 'string' && typeof value.description === 'string' &&
    typeof value.icon === 'string';
}

// -----------------------------------------------------------------------------
// requestJson — shared HTTP/JSON boundary
// -----------------------------------------------------------------------------
// All endpoints must return JSON, including failures. This helper logs the
// exchange, applies its own AbortController, and translates structured HTTP
// errors. A successful HTTP status does NOT validate the payload — callers
// still receive unknown and must check the endpoint-specific fields.
//
// timeoutMs = 0 means no client deadline. The timer is always cleared when
// the fetch/JSON work settles, including on invalid JSON or an HTTP error.
async function requestJson(url: string, options: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const method = options.method ?? 'GET';
  console.log('[Concierge →]', method, url, options.body ?? null);
  const controller = new AbortController();
  const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      console.warn('[Concierge ←]', method, url, { status: response.status, error: 'Invalid JSON' });
      throw new Error(`Concierge returned invalid JSON (HTTP ${response.status}).`);
    }
    console.log('[Concierge ←]', method, url, { status: response.status, body });
    if (!response.ok) {
      if (isRecord(body) && typeof body.error === 'string' && typeof body.message === 'string') {
        throw new ConciergeApiError(body.error, body.message);
      }
      throw new Error(`Concierge returned an invalid error response (HTTP ${response.status}).`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

// -----------------------------------------------------------------------------
// Configuration — validate before polling, then build URLs and auth headers
// -----------------------------------------------------------------------------
// apiUrl is an HTTP(S) base URL, optionally with a path. roomId and authToken
// are required. Credentials, query strings, and fragments are rejected in
// the base URL; endpoint parameters and Bearer authentication are added here.
// Return a displayable message rather than throwing during page setup.
function configError(config: ConciergeConfig): string | null {
  if (!config.apiUrl || !config.roomId || !config.authToken) {
    return 'Concierge is not configured. Check the processor room configuration.';
  }
  try {
    const url = new URL(config.apiUrl);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password ||
        url.search || url.hash) {
      return 'Concierge API URL must be an HTTP(S) URL without credentials, query, or fragment.';
    }
  } catch {
    return 'Concierge API URL is invalid.';
  }
  return null;
}

// Strip trailing slashes so appending /health, /services, or /callService
// produces the same endpoint regardless of the configured trailing slash.
function baseUrl(config: ConciergeConfig): string {
  return config.apiUrl.replace(/\/+$/, '');
}

// /services and /callService send this header. The /health read below does
// not attach the room's Bearer token.
function authHeaders(config: ConciergeConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.authToken}` };
}

// -----------------------------------------------------------------------------
// Lifecycle bookkeeping — private state, not the reactive page model
// -----------------------------------------------------------------------------
// There is one active Concierge lifecycle for the page. activeGeneration
// advances on every start and active cleanup, invalidating older health and
// catalogue work. servicesGeneration separately makes the latest catalogue
// fetch win when polling and a disabled-service refresh overlap.
//
// activeConfig is the config used by new service requests. lastRoomKey tracks
// base URL + room id so another room/API cannot inherit the previous room's
// service cards or offline message. A token-only change keeps those values.
let activeGeneration = 0;
let servicesGeneration = 0;
let activeConfig: ConciergeConfig | null = null;
let lastRoomKey = '';

// -----------------------------------------------------------------------------
// Inbound: loadServices — fetch the room's available service catalogue
// -----------------------------------------------------------------------------
// Contract:
//   GET /services?roomId=<encoded room id>  (Bearer token)
//   { roomId, offlineMessage, services: [{ uid, name, description, icon }] }
//
// Used after the first healthy check, after recovery, and when a request
// reports ServiceDisabledForRoom. Both stale successes AND stale failures
// are ignored so an older fetch cannot change the current page's status.
async function loadServices(config: ConciergeConfig, generation: number): Promise<void> {
  const requestGeneration = ++servicesGeneration;
  let body: unknown;
  try {
    body = await requestJson(`${baseUrl(config)}/services?roomId=${encodeURIComponent(config.roomId)}`, {
      headers: authHeaders(config)
    });
  } catch (error) {
    if (generation !== activeGeneration || requestGeneration !== servicesGeneration) return;
    throw error;
  }
  if (generation !== activeGeneration || requestGeneration !== servicesGeneration) return;
  // Check the room identity and entire catalogue before committing anything.
  // Duplicate uids would make request-card identity ambiguous in the UI.
  if (!isRecord(body) || body.roomId !== config.roomId || typeof body.offlineMessage !== 'string' ||
      !Array.isArray(body.services) || !body.services.every(isService) ||
      new Set(body.services.map((service: ConciergeService) => service.uid)).size !== body.services.length) {
    throw new Error('Concierge returned an invalid services response.');
  }
  // The store preserves request objects for surviving uids, including any
  // in-flight status, while updating their display fields and room message.
  applyConciergeServices(body.services, body.offlineMessage);
  conciergeState.status = 'online';
  conciergeState.message = '';
}

// Structured API failures show the server's explanation as an error. Network,
// timeout, or malformed-response failures use the room's offline message
// (or DEFAULT_OFFLINE_MESSAGE until a valid catalogue has supplied one).
function showLoadError(error: unknown): void {
  console.warn('Concierge failed to load services:', error);
  conciergeState.status = error instanceof ConciergeApiError ? 'error' : 'offline';
  conciergeState.message = error instanceof ConciergeApiError ? error.message : conciergeState.offlineMessage;
}

// -----------------------------------------------------------------------------
// Lifecycle: startConcierge — called by the page's configuration effect
// -----------------------------------------------------------------------------
// Params: { apiUrl, roomId, authToken } from the Concierge configuration store.
// Returns cleanup for Svelte to call on config change or page unmount.
//
// Steps:
//   1. Invalidate the previous lifecycle and clear cards if the room/API changed.
//   2. Report invalid config locally, without starting HTTP polling.
//   3. Check GET /health immediately; require { status: "online" }.
//   4. Fetch services while not online, then continue health checks every 10s.
//      Healthy polls leave the catalogue alone; recovery fetches it again.
//
// Cleanup stops future polling and invalidates old health/catalogue results.
// It does not abort in-flight fetches or cancel submitted service requests.
export function startConcierge(config: ConciergeConfig): () => void {
  const generation = ++activeGeneration;
  const roomKey = JSON.stringify([baseUrl(config), config.roomId]);
  if (roomKey !== lastRoomKey) {
    conciergeState.requests = [];
    conciergeState.offlineMessage = DEFAULT_OFFLINE_MESSAGE;
    lastRoomKey = roomKey;
  }
  activeConfig = config;
  conciergeState.notice = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const error = configError(config);
  if (error) {
    console.warn(error);
    conciergeState.status = 'error';
    conciergeState.message = error;
  } else {
    conciergeState.status = 'loading';
    conciergeState.message = '';
    const poll = async () => {
      try {
        const health = await requestJson(`${baseUrl(config)}/health`);
        if (generation !== activeGeneration) return;
        if (!isRecord(health) || health.status !== 'online') {
          throw new Error('Concierge returned an invalid health response.');
        }
        if (conciergeState.status !== 'online') await loadServices(config, generation);
      } catch (err) {
        if (generation !== activeGeneration) return;
        showLoadError(err);
      }
      // Schedule only after this attempt settles, including failures, and
      // only if this lifecycle still owns the page.
      if (generation === activeGeneration) timer = setTimeout(poll, HEALTH_INTERVAL_MS);
    };
    void poll();
  }
  return () => {
    // An older effect's cleanup must not clear a newer effect's config.
    if (generation === activeGeneration) {
      activeGeneration++;
      activeConfig = null;
    }
    clearTimeout(timer);
  };
}

// -----------------------------------------------------------------------------
// Outbound: sendConciergeRequest — the function service-card buttons call
// -----------------------------------------------------------------------------
// Params: the actual request object from conciergeState.requests, not a copy.
// Contract:
//   POST /callService  (Bearer token, application/json)
//   Body:     { roomId, serviceUid }
//   Response: { roomId, serviceUid, success, status: "sent" | "failed", message }
//
// Design notes:
//   * Only an online service and a currently listed, idle request may send.
//     Sending/result states block repeated taps until the result resets.
//   * Status moves idle -> sending -> confirmed/failed -> idle. Confirmation
//     requires BOTH success: true and status: "sent" from the matching room
//     and service; a successful HTTP status alone is not enough.
//   * HTTP/response failures become card feedback here rather than escaping
//     to the page's click handler. No automatic request retry is performed.
export async function sendConciergeRequest(request: ConciergeRequest): Promise<void> {
  const config = activeConfig;
  if (!config || conciergeState.status !== 'online' || !conciergeState.requests.includes(request)) {
    console.warn('Concierge request dropped: service is not available.');
    return;
  }
  if (request.status !== 'idle') {
    console.warn('Concierge request already pending:', request.uid);
    return;
  }
  request.status = 'sending';
  request.message = '';
  conciergeState.notice = '';
  try {
    // Passing 0 disables requestJson's usual 15s deadline. The card stays
    // "sending" until fetch settles; the health loop runs independently.
    const body = await requestJson(`${baseUrl(config)}/callService`, {
      method: 'POST',
      headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: config.roomId, serviceUid: request.uid })
    }, 0);
    if (!isRecord(body) || body.roomId !== config.roomId || body.serviceUid !== request.uid ||
        typeof body.success !== 'boolean' || (body.status !== 'sent' && body.status !== 'failed') ||
        typeof body.message !== 'string') {
      throw new Error('Concierge returned an invalid call response.');
    }
    request.status = body.success && body.status === 'sent' ? 'confirmed' : 'failed';
    request.message = body.message;
  } catch (error) {
    console.warn('Concierge request failed:', error);
    request.status = 'failed';
    request.message = error instanceof ConciergeApiError
      ? error.message
      : 'Request failed. Please try again.';
    // The catalogue can change after it was loaded. If this service is no
    // longer enabled, keep the explanation in a page notice and refresh the
    // list, which may remove its card. Only refresh if the active room/API
    // still matches the request; use the current config (including its token).
    if (error instanceof ConciergeApiError && error.code === 'ServiceDisabledForRoom' &&
        activeConfig && baseUrl(config) === baseUrl(activeConfig) && config.roomId === activeConfig.roomId) {
      conciergeState.notice = error.message;
      const generation = activeGeneration;
      void loadServices(activeConfig, generation).catch((err: unknown) => {
        if (generation === activeGeneration) showLoadError(err);
      });
    }
  }
  // Keep terminal feedback visible briefly, then allow another tap. Do not
  // clear another status if the request is no longer confirmed or failed.
  setTimeout(() => {
    if (request.status === 'confirmed' || request.status === 'failed') {
      request.status = 'idle';
      request.message = '';
    }
  }, RESULT_DISPLAY_MS);
}
