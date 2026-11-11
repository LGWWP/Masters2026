# Masters2026 P709 UI

This is the touch-panel client for the Masters2026 P709 program. Svelte 5 provides the UI, TypeScript describes the configuration and state, and Vite builds the browser assets. A packaging script turns that build into a `.ch5z` for the panel.

The control system owns the room state. The UI sends commands and displays the feedback it receives from the SignalR room hub. Concierge has its own HTTP API.

## Program Structure

### Crestron

This is the only part of the UI that concerns Crestron specific code.
The purpose of splitting the Crestron code into `src/lib/crestron/` is to isolate the CrComLib/WebXPanel dependency and allow the rest of the app to run and be developed in a plain browser.

Changes to the Crestron code are expected to be minimal.

The folder:

- Initialises WebXPanel when running in a browser, using `assets/data/project-config.json` connection settings when present and URL parameters as fallbacks
- Exposes `CrComLib` and the four `bridgeReceive*FromNative` callbacks on `window` so native panel feedback reaches the same join subscriptions ([src/lib/crestron/crestron.ts](src/lib/crestron/crestron.ts))
- Subscribes to **serial join 1** and extracts the SignalR hub URL from the JSON payload ([src/lib/crestron/xpanel.ts](src/lib/crestron/xpanel.ts))

On a real panel the native container supplies the processor transport and WebXPanel is inactive; in a browser WebXPanel supplies it. Either way, the bridge exposes the hub URL and connection status to the rest of the app.

### Core UI

#### Stores - the "model"

The client-side model of the room, implemented with Svelte 5 runes in `src/lib/stores/`. Modules cover lights, shades, sources, volume, system, room metadata, navigation, connection, theme, diagnostics, concierge, flyouts, and quick actions.

Configuration describes what the room contains. Runtime state holds the latest feedback. Transport modules apply changes to the stores; components read the stores and re-render when values change. Files that use runes have the `.svelte.ts` extension so the Svelte compiler can process them.

#### Transport - the "controller"

The client transport layer in `src/lib/transport/`, one module per domain. SignalR modules register inbound hub handlers (model changes pushed from the server) and expose outbound commands (lights, shades, system power, volume). Modules are imported as side effects near the top of [src/App.svelte](src/App.svelte) so their handlers register before the hub connects.

The shared [signalr.svelte.ts](src/lib/transport/signalr.svelte.ts) module builds the connection, handles retries, and requests room configuration after each successful connect/reconnect. Domain modules use `onHubReady` to register handlers and `getHub` to send commands. Lights, Shades, and Sources also use `onHubConnected` to request runtime snapshots through `GetRoomState`. Lights restores `lightLevels`; Sources restores `selectedSourceId`, including clearing the selection when the server returns null. Newer live feedback takes precedence over pending snapshots. Sources separately queries `GetPreviewUrl` on connect/reconnect for the display preview image.

Diagnostics uses a separate SignalR hub configured by `GetRoomConfiguration.mcpHubPath`. It connects independently and supplies troubleshooting state to the Support page.

Concierge uses a separate HTTP API rather than the room hub. Its page starts health polling and loads services using the settings supplied in the room configuration.

#### Components - the "view"

Svelte components in `src/lib/components/`:

- `layouts/` - header, footer, edge menu, power overlay, theme toggle, volume control
- `pages/` - Home, Lights, LightsInteractive, Shades, SourceSelection (the Sources page), Support, Concierge, and supporting shade components
- `pages/sourceControls/` - display preview and source-type information panels
- `ui/` - reusable Card and Flyout
- `icons/` - SVG icon components

#### App.svelte - bootstrapping

[src/App.svelte](src/App.svelte) is the app shell. It imports the transport modules, starts SignalR once a hub URL arrives from the processor, and mounts the header, page outlet, footer, and overlays.

[navigation.svelte.ts](src/lib/stores/navigation.svelte.ts) defines the page keys, lazy-loading functions, and menu entries. [PageOutlet.svelte](src/lib/components/PageOutlet.svelte) loads the selected page, so the shell does not need to import each page itself.

The header status dot combines the applicable CIP, WebSocket, and room SignalR links: all connected is online, all disconnected is offline, and a mixture is partially connected. Links that do not apply to the current run mode are ignored. When an established connection drops, the app switches to Concierge; initial offline startup stays on Home. Confirmed system power-off returns the app to Home.

### UI.Tests

Tests are small and follow the 3 AAAs pattern - Arrange, Act, Assert.

The regression scripts cover:

- Native bridge feedback through the `bridgeReceive*FromNative` globals
- WebXPanel project settings, URL fallbacks, authentication parameters, and native-container startup
- Lighting levels on connect/reconnect, live feedback ordering, invalid snapshots, and query failures
- Blinds configuration, connect/reconnect snapshots, live feedback ordering, position/tilt reactivity, invalid input, and presets
- Concierge configuration on connect/reconnect, HTTP requests and responses, logging, recovery, and page reactivity
- Current source on connect/reconnect, live feedback and power-off ordering, and stream status events

Run the regression suites without a processor:

```powershell
node --test scripts/crestron.test.mjs scripts/xpanel.test.mjs scripts/lights.test.mjs scripts/shades.test.mjs scripts/concierge.test.mjs scripts/sources.test.mjs scripts/source-events.test.mjs
```

Known test maintenance: the configuration tests in `concierge.test.mjs`,
`shades.test.mjs`, and `sources.test.mjs` still mock the old diagnostics store
instead of the current `./diagnostics` transport import, so those tests fail
during setup with `Unexpected import: ./diagnostics`. The preview tests in
`sources.test.mjs` also still expect the former `GetRoomConfiguration.displayPreviewUrl`
field and need updating for `GetPreviewUrl`.

### File structure

| Folder / file                   | Crestron? | Contents                                                                                        |
| ------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `src/lib/crestron`              | Yes       | WebXPanel bootstrap, native bridge globals, and serial join 1 subscription                      |
| `src/lib/stores`                | No        | Svelte 5 rune stores: configuration, runtime feedback, and local UI state                       |
| `src/lib/transport`             | No        | Shared SignalR connection, domain handlers and commands, diagnostics, and concierge HTTP client |
| `src/lib/components`            | No        | Layouts, pages, reusable UI, and icons                                                          |
| `src/App.svelte`, `src/main.ts` | No        | App shell and entry point                                                                       |
| `scripts/pack-ch5z.mjs`         | No        | Packages the Vite build as a `.ch5z`                                                            |
| `scripts/*.test.mjs`            | No        | Node regression tests for the native bridge, WebXPanel, lights, shades, concierge, and sources  |

- **Testability:** everything outside `src/lib/crestron` runs in a plain browser with no Crestron dependency; the Crestron folder only adapts joins to the rest of the app.
- **No hardcoded backend:** the room hub URL comes from serial join 1. Initial connection failures retry every 5 seconds; established connections use SignalR's reconnect policy. Commands do not update confirmed room state locally.

### Adding a new feature

1. Add a store in `src/lib/stores/`.
2. Add a transport module in `src/lib/transport/` that registers inbound hub handlers and exposes outbound commands.
3. Import the new transport module as a side effect near the top of `src/App.svelte` so its handlers register before the hub connects.
4. For a new page, add it to `PageKey`, `loaders` and `PAGES` in `src/lib/stores/navigation.svelte.ts`.

## Getting Going

Prerequisites: [Node.js](https://nodejs.org/) 20.19 or newer in the 20.x series, or 22.12 or newer; Git; and ideally [VS Code](https://code.visualstudio.com/) with the Svelte extension (VS Code will prompt for it). These Node versions match the installed Vite package's engine requirement.

```powershell
git clone https://github.com/grivera-crestron/crestron-ui-P709.git
cd crestron-ui-P709
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

For browser control of a processor, supply its WebXPanel connection settings in the project file below or use URL fallbacks, for example `http://localhost:5173/?host=<processor-ip>&ipid=0x03`. File settings take precedence over URL settings. The processor must publish the SignalR hub URL on serial join 1. Without that connection the UI shell can still be developed locally, but room commands need a running backend.

Edit `src/assets/data/project-config.json` to supply the Crestron Virtual Panel
connection settings. Vite serves it at `assets/data/project-config.json` during
development and copies it to `dist/assets/data/project-config.json` during the build.
The `.ch5` inside the `.ch5z` includes it at `assets/data/project-config.json`.
The checked-in file contains a placeholder; replace it with your connection
settings. This supplies the host, IP ID, and room ID without needing those
URL parameters:

```json
{
  "config": {
    "controlSystem": {
      "host": "172.16.17.15",
      "ipId": "0x03",
      "roomId": "MASTER2026P709"
    }
  }
}
```

WebXPanel loads this file before connecting. Non-empty string values for `host`,
`ipId`, and `roomId` take precedence over the corresponding URL parameters;
missing or invalid values use the URL parameters and existing defaults.
If the file is unavailable or invalid JSON, startup uses those fallbacks.
Authentication values continue to come from the URL parameters.

| Command                                   | What it does                               |
| ----------------------------------------- | ------------------------------------------ |
| `npm run dev`                             | Start the dev server with hot reload       |
| `npm run build`                           | Production build into `dist/`              |
| `npm run preview`                         | Serve the production build locally         |
| `npm run check`                           | Type-check Svelte and TypeScript           |
| `npm run lint` / `npm run lint:fix`       | Run ESLint (and auto-fix)                  |
| `npm run format` / `npm run format:check` | Run Prettier (write or check only)         |
| `npm run pack:ch5z`                       | Package an existing `dist/` into a `.ch5z` |
| `npm run package:ch5z`                    | Build, then package in one step            |

### Deploying to a panel

- Build and package in one step: `npm run package:ch5z` - the output is `release/crestron-ui-p709.ch5z` (`release/` and `dist/` are git-ignored, so each person builds their own).
- The packer ([scripts/pack-ch5z.mjs](scripts/pack-ch5z.mjs)) does not need the Crestron `ch5-cli`. Optional flags, passed after `--`: `npm run pack:ch5z -- --name my-project --out ./release`
- Load the resulting `.ch5z` onto the touch panel with your usual Crestron deployment tool (for example Crestron Toolbox).

### Contributing

Work on a branch and open a pull request instead of committing straight to `main`:

```powershell
git checkout -b my-change
# make changes, then:
npm run check
npm run lint
git add .
git commit -m "Describe the change"
git push -u origin my-change
```

## Labs

### Student task markers

Student tasks are identified by `TODO: UI Lab` comments beside the relevant code. Each task has a hint and a reference implementation:

```typescript
// TODO: UI Lab 1.1 - the aim of the task
// Hint: some guidance for the student
// UI Lab 1.1 - End

// REF: UI Lab 1.1
...the solution code...
// REF: UI Lab 1.1 - End
```

Svelte template tasks use HTML comments with the same lab identifier:

```svelte
<!-- TODO: UI Lab 3.1b - Display the SVG on the page -->
<!-- Hint: Read the decoded SVG from the room store. -->
<!-- UI Lab 3.1b - End -->

<!-- REF: UI Lab 3.1b -->
...the solution markup...
<!-- REF: UI Lab 3.1b - End -->
```

The tables below follow the identifiers in the source. Task 3.1c uses `TODO UI Lab` without the colon, and task 3.2 starts with `UI Lab` without `TODO:`; both have student and reference blocks and are included here.

### Teacher instructions

To prepare a student version, remove the reference implementation between each task's `REF` markers and keep its student block and hints. Students write the missing code in the student block. Leave the surrounding imports, stores, helpers, and worked examples in place.

Search by lab identifier, such as `UI Lab 1.4b`, and check the boundaries before removing a solution. Existing reference markers use several forms: `REF UI Lab`, `REF: UI Lab`, and `REF: Lab`. The 1.2 student end marker currently reads `UI Lab 2 - End`, and the 3.1b closing reference marker repeats the opening marker without `- End`.

The lab outline is specific to this UI repository. It keeps the existing task numbers: there is no marked UI task 1.3 or Lab 2 task in the current source. The lighting transport remains available as a worked example for the other domains.

### Main Lab Task Breakdown

#### Lab 1 - Connection, configuration, and room controls

Start by connecting to the processor's SignalR hub and loading room configuration. Then follow a complete feedback path through transport, store, and component using volume. The extra tasks add shade selection, a position slider, and system power feedback.

| Task  | Where                                                                                                   | Aim                                                                                                            | Why                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1.1   | `initSignalR` in [transport/signalr.svelte.ts](src/lib/transport/signalr.svelte.ts)                     | Assign a SignalR connection to `hub`, using the supplied URL, logging, and automatic reconnect options         | One shared connection keeps connection handling out of page components; handlers must be registered before it starts |
| 1.2   | `fetchRoomConfiguration` in [transport/signalr.svelte.ts](src/lib/transport/signalr.svelte.ts)          | Invoke `GetRoomConfiguration`, log the result, and pass it to `applyRoomConfiguration`                         | A query returns the configuration used to build the UI; each store receives its own part of that response            |
| 1.4a  | `applyVolume` in [stores/volume.svelte.ts](src/lib/stores/volume.svelte.ts)                             | Store the received volume level, rounded to an integer and clamped to 0-100                                    | Centralise the state write and keep the display within the supported range                                           |
| 1.4b  | `onHubReady` in [transport/volume.ts](src/lib/transport/volume.ts)                                      | Register `VolumeLevelChanged`, validate its numeric payload, and call `applyVolume`                            | Complete the server-to-store feedback path, using the mute handler as the worked example                             |
| 1.4c  | Footer controls in [layouts/Footer.svelte](src/lib/components/layouts/Footer.svelte)                    | Render the imported `VolumeControl` component without props                                                    | A component reads shared state and sends commands through the transport without the footer managing either           |
| 1.5aa | Shade list in [pages/Shades.svelte](src/lib/components/pages/Shades.svelte)                             | Render each shade's selection button, bind its active state to `selectedScope`, and call `setScope(shade.id)`  | Build selection from room configuration and connect the user's choice to the existing controls                       |
| 1.5ab | `slider` snippet in [pages/ShadeLevelControl.svelte](src/lib/components/pages/ShadeLevelControl.svelte) | Add a 0-100 range input that displays the current value, previews on input, and commits on change              | Keep dragging responsive while sending the command when the user releases the slider                                 |
| 1.5b  | Inbound handler in [transport/system.ts](src/lib/transport/system.ts)                                   | Handle `SystemPowerStateChanged`, validate the state, update the store, and clear the selected source when off | The server's asynchronous power sequence drives the existing progress overlay and shutdown behaviour                 |

Check the result against a running processor:

- The connection comes online and `GetRoomConfiguration` appears in the browser console.
- Volume commands produce a `VolumeLevelChanged` response and update the footer readout.
- Selecting a shade changes the control scope; releasing its slider sends a command and the returned position confirms the value.
- Power feedback moves the UI through `starting`, `on`, `stopping`, and `off` as the server reports each state.

### Connection already covered

A touch panel (XPanel, **IPID 03**) connects through CrComLib. **Serial join 1** returns the connection details for a custom SignalR connection:

```json
{ "hubUrl": "http://<processor-ip>:5000/hubs/room" }
```

[src/lib/crestron/xpanel.ts](src/lib/crestron/xpanel.ts) extracts `hubUrl` and passes it to [src/App.svelte](src/App.svelte) to start SignalR. The processor must publish this payload for each panel's IP ID, including after reconnect, and the hub address must be reachable from the panel.

## Front-end Integration Reference

The UI connects to the SignalR room hub at `/hubs/room`. The notes below describe the configuration, commands, and events used by the UI, along with the separate concierge HTTP API.

### Concierge HTTP API

The processor supplies concierge settings in `GetRoomConfiguration`:

```json
{
  "concierge": {
    "baseUrl": "http://<processor-ip>:5002",
    "roomId": "<room-id>",
    "token": "<auth-token>"
  }
}
```

Use the room ID from the concierge server's `rooms.json` and its configured
`authToken`. No Vite concierge environment variables are needed. The page
reacts when configuration arrives and when it changes on reconnect; an
unchanged configuration does not restart polling. Missing or malformed
settings disable concierge instead of retaining stale credentials.
The token is visible to panel/browser users and must not be treated as a secret. Do not
commit a real token. Configure the API's CORS allowed origins for the panel,
and ensure the API is reachable without browser mixed-content restrictions.
The concierge configuration is separate from the SignalR hub URL.

On the Concierge page the client polls unauthenticated `/health`, loads the
room's enabled services from `/services`, and sends requests to `/callService`
with bearer authentication. It retries health and service loading every 10
seconds after a failure while the page is open. An unconfigured or unavailable
API does not generate simulated requests.

HTTP communications are logged to the browser console with `[Concierge →]`
and `[Concierge ←]` prefixes, including method, URL, request body, HTTP status,
and response body. Authorization headers are not logged.

### Lighting presets (GetRoomConfiguration)

Lighting scenes come from `GetRoomConfiguration.lightingPresets` (not `presets`).
Each entry has `id`, `name`, and `levels: [{ lightId, levelPercent }]`.
Send an empty array when no lighting scenes are configured. The existing
`SelectPreset` command and `PresetSelected` event are unchanged.

### Blinds/Shades config fields (GetRoomConfiguration)

The client uses the documented Blinds API. `GetRoomConfiguration.shades`
contains entries in display order, with unique non-empty ids:

```json
{
  "shades": [
    { "id": "1", "name": "Window Blinds", "type": "roller" },
    { "id": "2", "name": "Curtains", "type": "curtain" },
    { "id": "3", "name": "Rear Venetian", "type": "venetian" }
  ]
}
```

`type` is `roller`, `curtain`, or `venetian`. The UI chooses a built-in icon
based on the shade type.
Positions are **runtime state**, not `initialPositionPercent` config fields:

```json
{
  "shadePositions": [
    { "shadeId": "1", "positionPercent": 65 },
    { "shadeId": "2", "positionPercent": 100 },
    { "shadeId": "3", "positionPercent": 40 }
  ]
}
```

This is the shades slice of `GetRoomState`, fetched on connect/reconnect.
Later `ShadePositionChanged(shadeId, positionPercent)` broadcasts update every
panel. The client sends `SetShadePosition(shadeId, positionPercent)` with an
integer from 0 to 100 (`0` closed, `100` open).
**All Blinds**, Close/Mid/Open and the position slider use this existing method;
All Blinds sends one command per configured shade. No new group endpoint is required.

Blinds sliders send on release (`change`), not on every drag (`input`).
The dragged target stays displayed until every selected shade confirms it,
preventing jumps to old values or partial group averages. Failed commands or
a 10-second confirmation timeout restore reported values and show an error.
Preset buttons send on click. Outgoing commands are logged as `[Shades →]`
and `[SignalR →]` with the method and arguments; rejected invokes log warnings.
Incoming position, tilt, and preset events are logged as `[SignalR ←]` with
their event name and payload, matching lighting feedback logs.
The controls are disabled only while SignalR is offline. They remain enabled
while commands are pending so a new target can be sent without waiting.
Failures from superseded commands do not clear a newer target.

#### Tilt and preset support

The tilt control and Quick Presets remain in the UI. They use the following
optional configuration and commands:

| Feature       | Config additions                                     | Hub method                           | Broadcast                                                      |
| ------------- | ---------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Slat tilt     | Optional `supportsTilt: true` on tilt-capable shades | `SetShadeTilt(shadeId, tiltPercent)` | `ShadeTiltChanged(shadeId, tiltPercent)`                       |
| Quick Presets | Top-level `shadePresets` catalogue (example below)   | `SelectShadePreset({ presetId })`    | `ShadePresetSelected(presetId)`; use `null` to clear selection |

Do not infer tilt capability from `type: "venetian"` alone: type selects the
icon, while `supportsTilt` advertises the additional command support.
Until this field is provided, the tilt control remains visible but unavailable
with an explanation. Quick Presets remains visible with configuration guidance
until the server supplies its catalogue.

Preset target `tiltPercent` can be omitted or `null` to mean no tilt target.
When provided as a number, it must be an integer from 0 to 100.

Example config:

```json
{
  "shades": [
    {
      "id": "3",
      "name": "Rear Venetian",
      "type": "venetian",
      "supportsTilt": true
    }
  ],
  "shadePresets": [
    {
      "id": "meeting",
      "name": "Meeting",
      "targets": [{ "shadeId": "3", "positionPercent": 65, "tiltPercent": 40 }]
    }
  ]
}
```

The server owns preset execution and should broadcast each resulting position
and tilt plus the selected preset id. For reconnect synchronization, supply
`GetRoomState` with `shadeTilts: [{ shadeId, tiltPercent }]` and
`activeShadePresetId: string | null`. All percentages must be integers from 0 to 100. The server should reject unknown ids, out-of-range values, and tilt commands
for shades without tilt support. The documented API does not specify whether
position feedback represents a target or measured hardware position, or expose
movement/stop state; that would be a separate server extension if needed.

### Display preview configuration

The Sources page reserves a 16:9 preview area above the source tiles. The
client invokes `GetPreviewUrl` on the room hub on each successful
connect/reconnect. Return an image path as a string, for example:

```json
"/nvx/preview"
```

The path resolves against the room hub URL supplied on serial join 1. For
example, `http://192.0.2.10:6001/hubs/room` plus `/nvx/preview` becomes
`http://192.0.2.10:6001/nvx/preview`. Absolute HTTP or HTTPS URLs are also
accepted. The endpoint must be reachable by the panel and return an image of
the room display's routed output. `GetRoomConfiguration.displayPreviewUrl`
is no longer read.

While the Sources page is open, the image refreshes every 5 seconds and
whenever the confirmed source changes, using a `refresh` query parameter to
bypass the cache. The image is shown only while system power is `on` and a
valid URL is available. Null, empty, or malformed query results clear the URL
and leave the preview placeholder visible. A failed `GetPreviewUrl` invocation
logs a warning and retains the previous URL. An image load failure shows
"Preview unavailable" with a Retry button; the next refresh also retries.

### Source selection and stream feedback

`GetRoomConfiguration.sources` supplies the source catalogue. The Sources
page is implemented in
[SourceSelection.svelte](src/lib/components/pages/SourceSelection.svelte).
Selecting a tile invokes `SelectSource(sourceId)` and waits for
`SelectedSourceChanged(sourceId)` before changing the confirmed selection.
If selecting a source requires system startup, the server owns that sequence.

On connect/reconnect, `GetRoomState.selectedSourceId` restores the selection;
use a non-empty string for a source ID or `null` to clear it. Newer selection
events, power-off feedback, and later snapshot requests take precedence over
an outstanding snapshot. `SystemPowerStateChanged("off")` clears the selection.

`StreamRunningChanged(isRunning)` accepts a boolean and updates stream status
independently. Stopping the stream keeps the source selected. Stream status
starts unknown and is populated by broadcasts, rather than `GetRoomState`.
The source-type panels currently provide information about the selected
device; they do not send device-specific controls.

### Support diagnostics

Supply an optional `mcpHubPath` in `GetRoomConfiguration`, for example:

```json
{
  "mcpHubPath": "/hubs/mcp"
}
```

The client resolves this path against the room hub URL and opens a separate
SignalR connection. Missing, empty, or invalid settings disable diagnostics;
changing the URL replaces the connection. On connect/reconnect, the client
queries `GetTroubleshootingState` and `GetMcpStatus`, then follows
`TroubleshootingStateChanged` and `McpStatusChanged` events.

The Support page automatically invokes `StartTroubleshooting` once per visit
when diagnostics is connected, available, and idle. Its Start/Restart button
uses the same command. Answer buttons invoke `AnswerTroubleshooting(optionIndex)`
with a zero-based index; server events update the displayed conversation.

## Troubleshooting

- **`npm install` or `npm run dev` fails on Node version:** use Node.js 20.19 or newer in the 20.x series, or 22.12 or newer.
- **UI stuck in offline mode:** check the browser/devtools console for bridge logs. Confirm serial join 1 supplies valid JSON with a `hubUrl` string, and that the panel can reach that backend.
- **Browser receives the URL but the panel does not:** ensure the deployed build includes the native `bridgeReceive*FromNative` globals from [src/lib/crestron/crestron.ts](src/lib/crestron/crestron.ts), and confirm the processor sends serial join 1 to the panel's IP ID (not only the browser's IP ID).
- **Old UI on the panel:** rebuild with `npm run package:ch5z` and reload the new `.ch5z`.
