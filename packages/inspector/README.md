# @deviltea/widget-inspector

> **Upgrading from 0.0.x?** Follow the [migration guide to 0.1](https://deviltea.github.io/widget/migration/0.1).

> ESM-only package. **0.x experimental, protocol-major guarantee only.**

A read-only, versioned Inspector boundary for [`@deviltea/widget-core`](https://www.npmjs.com/package/@deviltea/widget-core) Runtimes: a JSON-safe protocol, a client for the inspecting side, an agent that projects Core inspection into serializable DTOs and owns inspected-document interaction, transports, and the inspect-anchor attribute contract renderers use to mark their DOM.

```text
Inspector UI
    |
InspectorClient       (@deviltea/widget-inspector/client)
    |
InspectorTransport    (/transport, /channel; in-process or MessagePort, JSON-safe wire semantics)
    |
InspectorAgent        (/agent)
    |
@deviltea/widget-core/inspection + inspected DOM (anchors, /anchor)
```

## Installation

```bash
pnpm add @deviltea/widget-inspector @deviltea/widget-core
```

`@deviltea/widget-core` is a **peer dependency**: the Agent must see the very same Core copy that created the host's Runtime, or `inspectRuntime` rejects the Runtime as foreign. Only the Agent side (`/agent`) imports Core; `/protocol`, `/client`, `/transport`, `/channel`, `/frame-bootstrap`, `/value` and `/anchor` import nothing from it, so an inspecting UI that only talks to a remote Agent needs no Core at runtime or for types.

## Public subpaths

There is no root entry; import from exactly these subpaths.

| Subpath | Purpose |
| --- | --- |
| `/protocol` | Protocol version, DTO types, request/response/event validators and parsers. |
| `/client` | `createInspectorClient`, the inspecting side. |
| `/transport` | Transport interface plus in-process and MessagePort transports. |
| `/channel` | `createMessagePortChannelHub`: several logical transports over one MessagePort. |
| `/frame-bootstrap` | One-time, validated bootstrap envelope that transfers a dedicated MessagePort into a frame. |
| `/agent` | `createInspectorAgent`, bound to one Runtime and, optionally, one inspected DOM root. |
| `/value` | The bounded, accessor-safe `InspectableValue` display encoding. |
| `/anchor` | `inspectAnchorAttributes` and the anchor attribute names, for renderers. |

## Usage

```ts
import { createInspectorAgent } from '@deviltea/widget-inspector/agent'
import { createInspectorClient } from '@deviltea/widget-inspector/client'
import { createInProcessInspectorTransportPair } from '@deviltea/widget-inspector/transport'

const pair = createInProcessInspectorTransportPair()
const agent = createInspectorAgent({ runtime, transport: pair.agent, dom: { root: document.getElementById('app')! } })
const client = createInspectorClient(pair.client, { requestTimeoutMs: 5000 })

await client.handshake()
const { runtimes } = await client.request('runtime.list', {})
```

The boundary is read-only: no state mutation, Method invocation, eval, generic object RPC, or Runtime discovery global hook.

**One Agent per transport per Runtime.** An Inspector transport has exactly one peer, and that peer talks to one Agent. Two Agents on the same transport both answer every request, so the client sees duplicate, conflicting responses. To replace a Runtime binding on a shared transport, dispose the old Agent first (`closeTransportOnDispose: false` keeps the transport open for the replacement) and then create the new one; the client is told through `runtime.disposed` (see [Lifecycle](#lifecycle)).

`dom` is optional. An Agent without it serves the Runtime-level methods only; the DOM-dependent methods (`inspect.enable`, `inspect.disable`, `highlight.show`, `highlight.clear`, `inspect.hitTest`, `geometry.resolve`) are not advertised and answer `unknown-method`.

## Cross-frame setup

Run the Runtime and the Agent in the frame that owns the inspected DOM, and the Client in the host page. Nothing but the one-time bootstrap message ever travels on the global window `message` bus; all Inspector traffic goes over a dedicated `MessagePort`.

**Host side (the page embedding the frame):**

```ts
import { createMessagePortChannelHub } from '@deviltea/widget-inspector/channel'
import { createInspectorClient } from '@deviltea/widget-inspector/client'
import { createInspectorFrameBootstrapRequest } from '@deviltea/widget-inspector/frame-bootstrap'

const sessionId = crypto.randomUUID()
const generation = 0 // increase on every (re)load of the frame
const frameOrigin = new URL(frameUrl).origin // never 'null' and never '*'

// The frame learns this page's origin from its referrer; send the origin (not the path) as the referrer.
iframe.referrerPolicy = 'origin'
iframe.src = `${frameUrl}?session=${sessionId}&generation=${generation}`

iframe.addEventListener('load', () => {
	const channel = new MessageChannel()
	const hub = createMessagePortChannelHub(channel.port1)
	const client = createInspectorClient(hub.openChannel('inspector'), { requestTimeoutMs: 5000 })
	// Transfer port2 to the frame with the EXACT frame origin as the target origin.
	iframe.contentWindow!.postMessage(
		createInspectorFrameBootstrapRequest(sessionId, generation),
		frameOrigin,
		[channel.port2],
	)
}, { once: true })
```

**Frame side (the page that owns the Runtime):**

```ts
import { createInspectorAgent } from '@deviltea/widget-inspector/agent'
import { createMessagePortChannelHub } from '@deviltea/widget-inspector/channel'
import { acceptInspectorFrameBootstrap } from '@deviltea/widget-inspector/frame-bootstrap'

const params = new URLSearchParams(location.search)
const sessionId = params.get('session') ?? ''
const generation = Number(params.get('generation'))
// The origin of the actual embedding parent, from browser-owned navigation metadata.
const parentOrigin = document.referrer ? new URL(document.referrer).origin : null

window.addEventListener('message', (event) => {
	if (parentOrigin === null || parentOrigin === 'null')
		return
	const accepted = acceptInspectorFrameBootstrap(event, {
		expectedSource: window.parent,
		expectedOrigin: parentOrigin,
		sessionId,
		expectedGeneration: generation,
	})
	if (accepted === null)
		return
	const hub = createMessagePortChannelHub(accepted.port)
	createInspectorAgent({ runtime, transport: hub.openChannel('inspector'), dom: { root: appElement } })
})
```

Rules this pins:

- **Never post the bootstrap with a `'*'` target origin.** The transferred port is the only authentication (see [Security model](#security-model)); a `'*'` target lets whichever document currently occupies the frame (after a navigation, redirect or embed swap) receive it. Pass the exact frame origin. An opaque origin (`'null'`) cannot be targeted and must be rejected.
- **How the frame learns `expectedOrigin`.** Not from the message: `event.origin` is what is being checked, so the expected value must come from somewhere the sender cannot choose. The reference setup reads it from `document.referrer`, which is the embedding parent's origin when the iframe sets `referrerPolicy = 'origin'` before navigating (an empty or opaque referrer must authorize nothing). A frame served from a known fixed host may instead hard-code the host's origin. The check pins the integration to its intended parent; it is not a frame-ancestors allowlist or a sandbox.
- **`sessionId`** identifies one host-owned connection attempt and is generated by the host; the frame gets it out of band (the frame URL) and only accepts a bootstrap carrying it. **`generation`** counts reloads of the frame: the host increments it every time the frame loads, so a bootstrap prepared for a previous document (late, replayed or cached) is rejected by `expectedGeneration`.
- `acceptInspectorFrameBootstrap` returns `null` unless the message source is the expected window, its origin matches, the envelope validates, `sessionId` and `generation` match, and exactly one port was transferred. Ignore everything else; keep listening until one bootstrap is accepted, then stop.
- **Channel ordering.** The hub multiplexes logical channels by name. The two sides open their channels independently, so either side may send first: a message for a channel the other side has not opened yet is buffered (at most 64 messages per channel, **oldest dropped** on overflow) and delivered in order to the first subscriber after that side opens the channel. At most 16 not-yet-opened channel names hold state per peer; messages for further unknown names are dropped. Closing a channel is scoped to it; `openChannel` after a close returns a fresh transport; closing the hub (or the native port) disconnects every channel. Messages still in flight for a channel the local side has just closed are dropped until it is reopened locally.
- A client request sent before the Agent exists is therefore delivered once the Agent attaches, but still set `requestTimeoutMs`: nothing else bounds a request to a peer that never appears.

## Client API

```ts
const client = createInspectorClient(transport, { requestTimeoutMs: 5000 })
```

`createInspectorClient(transport, options?)` — `options.requestTimeoutMs` (positive finite number, no default) rejects a request that gets no response within that time with an `InspectorClientError` coded `timeout`; a late response is ignored, except that a late successful `runtime.subscribeMember` or `runtime.subscribeEvent` response makes the client send the matching unsubscribe (best effort, the last 256 timed-out subscribe requests are remembered), so the Agent does not keep a subscription whose id the caller never learned.

| Member | Behavior |
| --- | --- |
| `handshake()` | Sends the Client's protocol version and resolves `{ protocol, capabilities }`: the negotiated `major.minor` and the `methods`/`events` this Agent offers at it. The negotiated minor is only ever set by a handshake. |
| `request(method, params)` | Sends one typed request and resolves its typed result. Rejects with `InspectorClientError` for a protocol error, a malformed or incompatible response, a timeout, or disconnection. Standalone requests are valid before the first handshake. |
| `on(event, listener)` | Subscribes to one event by name; returns an unsubscribe function. |
| `subscribe(listener)` | Subscribes to every valid event message; returns an unsubscribe function. |
| `close()` / `dispose()` | Same function. Rejects pending requests with `disconnected`, drops listeners and closes the transport. A transport that closes underneath the client does the same. |

A listener that throws does not affect other listeners or the transport: the failure is rethrown in a microtask.

**`InspectorClientError`** has `code`, `message` and `protocolError`. Codes: `invalid-message` (malformed request or response), `unsupported-version` (protocol major mismatch), `unknown-method`, `invalid-params`, `runtime-not-found`, `widget-not-found`, `member-not-found`, `event-not-found`, `disconnected`, `subscription-limit` (0.3+), `runtime-disposed` (0.4+), `internal-error` (the Agent failed while handling the request; details stay in the Agent's realm) and the client-only `timeout`. An error code a newer Agent sends that this client does not define becomes `unknown-error` with the peer's code in `peerCode` and its message preserved.

**Getting a `WidgetRef`.** A `WidgetRef` is `{ runtimeId, nodeId }`. `runtime.list` returns each Runtime's `runtimeId` and `rootNodeId`; `blueprint.getSnapshot` for a `runtimeId` returns every node with its `nodeId`, `widgetId`, `widgetType`, slots and members. Node ids are stable only within one Agent/Runtime. The inspect events (`inspect.hovered`, `inspect.selected`) and `inspect.hitTest` carry ready-made refs.

**Subscribe/unsubscribe lifecycle.** `runtime.subscribeMember` (State or Property) and `runtime.subscribeEvent` return a `subscriptionId`; later `runtime.memberChanged` / `runtime.eventOccurred` events carry it. Release with `runtime.unsubscribeMember` / `runtime.unsubscribeEvent` (`{ removed }` is `false` for an unknown id). The Agent releases everything when it is disposed or the transport closes. Subscriptions are passive: subscribing never evaluates a Property.

**Capabilities.** The handshake result lists the methods and events available at the negotiated minor. Anything not listed is unavailable for the session and answers `unknown-method`. DOM-dependent methods and `geometry.invalidated` are only offered by an Agent created with `dom`; `runtime.disposed` only from 0.4. A peer that never performs the handshake is served at the Agent's highest minor for events (only the handshake sets the negotiated minor); its responses use the lower of that and the request envelope's minor.

### Events

`runtime.memberChanged`, `runtime.eventOccurred` (0.2), `inspect.hovered` (only when the hovered Widget changes), `inspect.selected`, `agent.status`, `geometry.invalidated` (0.2, DOM Agents), `runtime.disposed` (0.4).

## Agent options

| Option | Meaning |
| --- | --- |
| `runtime`, `transport` | Required. The Runtime to inspect and the transport to its single peer. |
| `runtimeId` | Optional opaque id for this Runtime on the wire; generated when omitted. |
| `dom` | `{ root }`: the inspected renderer root. Enables inspect mode, highlight, hit-testing and geometry. |
| `closeTransportOnDispose` | Default `true`. Set `false` to keep a host-owned shared transport open when only this Agent is replaced. |
| `maxSubscriptions` | Optional cap on live member and event subscriptions, counted together. No default. |
| `valueLimits` | Overrides for the `InspectableValue` limits below. |

### Lifecycle

The Agent does not subscribe to Runtime disposal; it observes `runtime.dispose()` when any request arrives, before it emits any other event, and when the Agent itself is disposed. From protocol 0.4 it then sends one `runtime.disposed` event (`reason: 'runtime-disposed'`), `runtime.list` stops listing the Runtime, and requests addressed to it, plus `inspect.hitTest`, `inspect.enable` and `highlight.clear`, answer `runtime-disposed` (releasing calls such as `runtime.unsubscribe*` and `inspect.disable` stay answerable). Disposing the Agent while the transport stays open (`closeTransportOnDispose: false`) sends the same event with `reason: 'agent-disposed'`. Dispose the Agent when you dispose the Runtime. Peers negotiated below 0.4 never see the event or code and keep the earlier behavior.

### Value encoding limits

Runtime values and event arguments are encoded as `InspectableValue` (see `/value`): JSON-safe, never executing accessors, `toJSON`, or Proxy traps. The limits, with their defaults, are:

| Limit | Default | Meaning |
| --- | --- | --- |
| `maxDepth` | 4 | Container nesting; deeper values become `{ type: 'truncated' }`. |
| `maxEntries` | 50 | Entries or items per array/object (objects keep their smallest keys, in sorted order). |
| `maxStringLength` | 500 | String values **and object keys** (a cut key sets `keyTruncated: true`, 0.4+; peers negotiated below 0.4 receive keys in full, never cut). |
| `maxNodes` | 1000 | Total encoded values per encoded value, leaves included. Once spent, remaining entries are left out and their container reports `truncated: true`. |

Truncation is always explicit in the encoding. Config schema documents are not encoded this way: they are transmitted whole as JSON metadata. The encoder lists an object's keys once (linear in the key count) but selects, sorts and describes only the entries it emits.

## Anchors

A renderer marks the DOM it renders for a Widget with `inspectAnchorAttributes`. `@deviltea/widget-vue` stamps no DOM attributes itself, so project `useWidget()` identity explicitly:

```ts
import { inspectAnchorAttributes } from '@deviltea/widget-inspector/anchor'

const { widgetId, widgetType } = useWidget(MyPlugin)
const anchor = inspectAnchorAttributes({ widgetId, widgetType })
// h('div', { ...anchor }) or <div v-bind="anchor">
```

- An anchor is any renderer-owned element carrying both attributes. Several elements may mark one Widget; each contributes to `rects[]` in document order. No wrapper element is needed.
- The innermost resolvable anchor wins hit-testing.
- Anchors live and die with the renderer's DOM. There is no register or cleanup API.
- Anchors carry identity only (`widgetId`, `widgetType`), never Runtime or root identity. The Agent binds one Runtime to one root and resolves the attributes against Core inspection, so stale values resolve to no target.

### Highlight

Inspect-mode highlight is drawn by the Agent in its own ShadowRoot overlay attached to the inspected document, from geometry rects. The Agent never mutates renderer elements, and a renderer re-render does not clear the highlight. Style it by setting `--widget-inspector-accent`, `--widget-inspector-accent-contrast`, and `--widget-inspector-fill` on `:root` or `body` of the inspected document.

### Geometry

Rects and points use the `preview-viewport` coordinate space: CSS pixels relative to the top-left of the **inspected document's viewport** (the frame's viewport when the Agent runs in an iframe), as `getClientRects()` reports them for the anchor elements. Document-wide observation (scroll, resize, mutation, fonts, loads) starts on the first geometry, hit-test, inspect or highlight use, not at Agent creation. `visibility` is `visible`, `clipped` (some rect leaves the viewport), `hidden` (no anchor currently has a rect, which also covers "no anchor element exists") or `missing` (the ref does not resolve).

### Subscription cap

`createInspectorAgent({ maxSubscriptions })` optionally bounds live Runtime member and event subscriptions. There is **no default limit**. When a configured cap is reached, further subscribe requests fail with `subscription-limit`.

## Security model

The Inspector is a read-only debugging boundary, not an access-control system.

- **Port possession is the only authentication.** Whoever holds the transport (the `MessagePort`, or the in-process pair) can issue every request. There is no credential, token or per-request authorization; the bootstrap origin/session/generation checks only decide who receives the port.
- **What a peer can read.** The full Blueprint structure (ids, types, slots, config schemas and descriptions, diagnostics, dependency graph), every State value, every Property result and diagnostic, and every event argument of the inspected Runtime, encoded within the limits above. There is no redaction hook: anything in a Runtime value is visible to the peer. Do not attach an Agent to a Runtime holding secrets you would not show the Inspector's user.
- **What a peer cannot do.** Mutate State, invoke Methods, evaluate code, or reach Runtime, Blueprint or DOM objects: only JSON DTOs cross the boundary.
- **The Runtime is read-only; the page is not untouched.** While Inspect mode is enabled the Agent installs capture-phase `pointerdown`, `pointerup` and `click` handlers on the inspected root that `preventDefault()` and `stopPropagation()` activation of anchored elements, a capture-phase `keydown` handler (Escape) on the document, and a fixed overlay element (open ShadowRoot) in the inspected document. Renderer elements themselves are never modified.
- Requests are validated defensively: any failure while handling one answers `internal-error` for that request id (the peer never sees the cause) and the Agent keeps serving, reporting the original exception in its own realm with a queued rethrow (`queueMicrotask(() => { throw error })`, like isolated listener failures), so it surfaces as an uncaught error in the host; response validation on the client is not recursive on peer-controlled depth.

## Known limitations

- **Single DOM root.** Anchors are only read inside the one `dom.root`. Content a renderer moves outside it (Teleport/portal, detached overlays) is not inspectable, and clicks on it are not suppressed in Inspect mode.
- **`hidden` is ambiguous.** `visibility: 'hidden'` covers both "anchors exist but have no layout rect" and "no anchor element exists for the Widget".
- **Opaque class instances.** Anything that is not a plain object or array (`Date`, `Map`, `Set`, `Error`, class instances) is encoded as `{ type: 'opaque', kind: 'class-instance' }` with no contents.
- **Display-only value encoding.** Values are bounded and lossy by design (see the limits above); the encoding is not a serialization format.
- **Disposal is observed lazily** (see Lifecycle); a peer that sends nothing may learn only when the Agent is disposed.
- **Not provided:** State/Method diagnostics on the wire, a redaction hook, new value kinds for `Date`/`Map`/`Set`, multiple DOM roots, and any kind of mutation.

## Versioning

Two independent axes:

- **npm semver** governs the TypeScript API. While on `0.x`, a minor release may break it.
- **Protocol `major.minor`** (`INSPECTOR_PROTOCOL_VERSION`) governs cross-realm compatibility. Minors only add negotiated capabilities, and every params validator ignores unknown extra fields, so a newer peer's additions never break an older one; a breaking DTO change bumps the major. An Agent and a Client on different package versions interoperate whenever the protocol major matches. A peer negotiated at an older minor sees exactly the wire shapes of that minor.

| Protocol minor | Added |
| --- | --- |
| 0.1 | Handshake, Runtime list, Blueprint/Widget snapshots, member subscriptions, inspect mode, highlight. |
| 0.2 | Event subscriptions, Blueprint config/events metadata, geometry and hit-testing. |
| 0.3 | `subscription-limit` error code. |
| 0.4 | `authorWritable` and `valueContractId` on member DTOs, `runtime.disposed` event, `runtime-disposed` error code, `keyTruncated` marker. |

The protocol is currently `0.4`.

**Core peer range.** `@deviltea/widget-core` is a peer dependency published as `^0.N.0` (the workspace uses `workspace:^`). A breaking change in Core's inspection surface bumps Core's minor, so a given Inspector release works with the Core minor it was released against. Once Core is `0.1.0` or newer that range also admits that minor's later patches; while Core is still `0.0.x`, `^0.0.N` pins exactly one Core patch, so the release scripts refuse to release the Inspector until Core is `0.1.0`.
