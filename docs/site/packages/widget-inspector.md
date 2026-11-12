---
title: '@deviltea/widget-inspector'
---

# @deviltea/widget-inspector

`@deviltea/widget-inspector` is the single published Inspector boundary for Widget: a read-only, versioned protocol, a client, a DOM agent, transports, and the inspect-anchor attribute contract. It is `0.x` experimental with a **protocol-major guarantee only**: while on `0.x` an npm minor release may break the TypeScript API, and cross-realm compatibility is governed by the protocol version.

For installation and a minimal example, see the
[package README](https://github.com/DevilTea/widget/tree/main/packages/inspector#readme), which also carries the complete reference for everything summarized here.

## Shape

```text
Inspector UI -> InspectorClient -> InspectorTransport -> InspectorAgent
                                                          |
                              @deviltea/widget-core/inspection + inspected DOM
```

The Agent projects authoritative Core inspection facts into serializable DTOs and owns inspected-document hit testing, pointer suppression, and highlight chrome. The client never receives Runtime, Blueprint, or DOM objects. The boundary is read-only: no state mutation, Method invocation, eval, or generic object RPC.

`@deviltea/widget-core` is a **peer dependency**. A second bundled Core copy would make the Agent reject the host's Runtime as foreign. Only the Agent side (`/agent`) imports Core: the protocol, client, transports, channel, bootstrap, value and anchor modules import nothing from it, so a client-only consumer needs no Core, even for types.

**One Agent per transport per Runtime.** An Inspector transport has one peer, and that peer talks to one Agent; two Agents on one transport both answer every request. To replace a Runtime binding on a shared transport, dispose the old Agent first (`closeTransportOnDispose: false` keeps the transport open).

## Public subpaths

There is no root entry. The public subpaths are exactly:

- `/protocol`: protocol version, DTO types, and message validators.
- `/client`: the inspecting-side client.
- `/transport`: the transport interface plus in-process and MessagePort transports.
- `/channel`: logical channels multiplexed over one MessagePort.
- `/frame-bootstrap`: the one-time frame bootstrap envelope.
- `/agent`: the Agent bound to one Runtime and, optionally, one inspected DOM root.
- `/value`: the bounded `InspectableValue` display encoding.
- `/anchor`: `inspectAnchorAttributes` and the anchor attribute names.

Everything else in the package is internal.

An Agent created without `dom` serves the Runtime-level methods only. The DOM-dependent methods (`inspect.enable`, `inspect.disable`, `highlight.show`, `highlight.clear`, `inspect.hitTest`, `geometry.resolve`) are not advertised and answer `unknown-method`.

## Two version axes

- **npm semver** governs the TypeScript API.
- **Protocol `major.minor`** governs cross-realm compatibility. Minors only add negotiated capabilities, and every params validator ignores unknown extra fields, so a newer peer's additions never break an older one; a peer negotiated at an older minor sees exactly the wire shapes of that minor. A breaking DTO change bumps the major. Only the handshake sets the negotiated minor.

The protocol is currently `0.4`: 0.2 added event subscriptions and geometry, 0.3 the `subscription-limit` error code, and 0.4 the `authorWritable` / `valueContractId` member fields, the `runtime.disposed` event, the `runtime-disposed` error code and the `keyTruncated` marker.

The Core peer is published as `^0.N.0` (`workspace:^` in the workspace): a breaking change in Core's inspection surface bumps Core's minor, so an Inspector release works with the Core minor it was released against and that minor's patches.

## Cross-frame setup

Run the Runtime and the Agent in the frame that owns the inspected DOM and the Client in the host page. Only the one-time bootstrap message travels on the global window `message` bus; all Inspector traffic uses a dedicated `MessagePort`.

Host side:

```ts
import { createMessagePortChannelHub } from '@deviltea/widget-inspector/channel'
import { createInspectorClient } from '@deviltea/widget-inspector/client'
import { createInspectorFrameBootstrapRequest } from '@deviltea/widget-inspector/frame-bootstrap'

iframe.referrerPolicy = 'origin' // so the frame can learn this page's origin
iframe.src = `${frameUrl}?session=${sessionId}&generation=${generation}`
iframe.addEventListener('load', () => {
	const channel = new MessageChannel()
	const hub = createMessagePortChannelHub(channel.port1)
	const client = createInspectorClient(hub.openChannel('inspector'), { requestTimeoutMs: 5000 })
	iframe.contentWindow!.postMessage(
		createInspectorFrameBootstrapRequest(sessionId, generation),
		new URL(frameUrl).origin, // the exact frame origin, never '*'
		[channel.port2],
	)
}, { once: true })
```

Frame side:

```ts
import { createInspectorAgent } from '@deviltea/widget-inspector/agent'
import { createMessagePortChannelHub } from '@deviltea/widget-inspector/channel'
import { acceptInspectorFrameBootstrap } from '@deviltea/widget-inspector/frame-bootstrap'

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

- **Never post the bootstrap with a `'*'` target origin.** Port possession is the only authentication, so pass the exact frame origin; an opaque origin cannot be targeted.
- **`expectedOrigin`** must come from somewhere the sender cannot choose. The reference setup reads `document.referrer`, which is the embedding parent's origin when the iframe sets `referrerPolicy = 'origin'` before navigating; an empty or opaque referrer authorizes nothing. A frame served from a fixed host may hard-code the host's origin. The check pins the integration to its intended parent; it is not a frame-ancestors allowlist or a sandbox.
- **`sessionId`** identifies one host-owned connection attempt; the frame receives it out of band (the frame URL). **`generation`** counts reloads of the frame, so a bootstrap prepared for an earlier document is rejected.
- **Channel ordering.** Either side may send first. A message for a channel the other side has not opened yet is buffered (64 per channel, oldest dropped on overflow) and delivered in order to the first subscriber once it opens the channel; at most 16 unopened channel names hold state per peer, and further unknown names are dropped. `openChannel` after a close returns a fresh transport. Still set `requestTimeoutMs`: nothing else bounds a request to a peer that never appears.

## Client API

`createInspectorClient(transport, { requestTimeoutMs? })` returns:

- `handshake()` negotiates the protocol minor and resolves the Agent's `capabilities` (`methods` and `events` available at that minor; anything not listed answers `unknown-method`).
- `request(method, params)` resolves the typed result or rejects with `InspectorClientError`.
- `on(event, listener)` and `subscribe(listener)` return unsubscribe functions; a throwing listener does not affect the others.
- `close()` / `dispose()` (the same function) reject pending requests with `disconnected` and close the transport.

`InspectorClientError.code` is one of `invalid-message`, `unsupported-version`, `unknown-method`, `invalid-params`, `runtime-not-found`, `widget-not-found`, `member-not-found`, `event-not-found`, `disconnected`, `subscription-limit` (0.3+), `runtime-disposed` (0.4+), `internal-error`, the client-only `timeout`, or `unknown-error` for a code a newer Agent sends (the peer's code is in `peerCode`, its message preserved).

A `WidgetRef` is `{ runtimeId, nodeId }`: `runtime.list` gives each Runtime's `runtimeId` and `rootNodeId`, and `blueprint.getSnapshot` lists every node with its `nodeId`, `widgetId` and `widgetType`; `inspect.hitTest` and the `inspect.hovered` / `inspect.selected` events carry ready-made refs. `runtime.subscribeMember` / `runtime.subscribeEvent` return a `subscriptionId` that later `runtime.memberChanged` / `runtime.eventOccurred` events carry; release it with the matching unsubscribe request. The Agent releases everything when it is disposed or the transport closes.

## Lifecycle

Core has no disposal notification, so the Agent observes `runtime.dispose()` when a request arrives, before it emits another event, and when the Agent is disposed. From protocol 0.4 it sends one `runtime.disposed` event, `runtime.list` stops listing the Runtime, and requests addressed to it, plus `inspect.hitTest`, `inspect.enable` and `highlight.clear`, answer `runtime-disposed` (releasing calls such as `runtime.unsubscribe*` and `inspect.disable` stay answerable). Disposing the Agent while the transport stays open sends the same event with `reason: 'agent-disposed'`. Dispose the Agent when you dispose the Runtime.

## Inspect anchors

A renderer marks its DOM for a Widget with `inspectAnchorAttributes({ widgetId, widgetType })` from `/anchor`.

- An anchor is any renderer-owned element carrying both attributes. Several elements may mark one Widget, and each contributes a rect to `rects[]` in document order. No wrapper element is required.
- The innermost resolvable anchor wins hit-testing.
- Anchors live and die with the renderer's DOM. There is no register or cleanup API.
- Anchors carry identity only. They never carry Runtime or root identity: the Agent binds one Runtime to one root and resolves the attributes against Core inspection, so stale values resolve to no target.

[`@deviltea/widget-vue`](./widget-vue) deliberately stamps no DOM attributes or directives. A Vue renderer projects `useWidget()` identity through `inspectAnchorAttributes` itself.

## Highlight, geometry and subscription cap

The highlight is drawn by the Agent in its own ShadowRoot overlay attached to the inspected document, from geometry rects. The Agent never mutates renderer elements, and a renderer re-render does not clear the highlight.

Rects and points use the `preview-viewport` coordinate space: CSS pixels relative to the top-left of the inspected document's viewport (the frame's viewport when the Agent runs in an iframe), as `getClientRects()` reports them. Document-wide geometry observation starts on the first geometry, hit-test, inspect or highlight use. `visibility` is `visible`, `clipped`, `hidden` (no anchor currently has a rect, which also covers "no anchor element exists") or `missing`.

`createInspectorAgent({ maxSubscriptions })` optionally bounds live Runtime subscriptions. There is no default limit; `subscription-limit` is returned only when a cap is configured, and only to peers negotiated at protocol 0.3 or newer.

## Value encoding limits

Runtime values and event arguments are encoded as bounded, accessor-safe `InspectableValue`s. Defaults, overridable through the Agent's `valueLimits` option: `maxDepth` 4 (container nesting), `maxEntries` 50 (per array or object; objects keep their smallest keys in sorted order), `maxStringLength` 500 (string values and object keys; a cut key sets `keyTruncated: true` from 0.4), and `maxNodes` 1000 (total encoded values per value; once spent, remaining entries are left out and their container reports `truncated: true`). Truncation is always explicit. Config schema documents are transmitted whole, not through this encoder.

## Security model

- **Port possession is the only authentication.** Whoever holds the transport can issue every request; the bootstrap checks only decide who receives the port.
- **A peer can read** the full Blueprint structure, every State value, every Property result and diagnostic, and every event argument of the inspected Runtime, within the limits above. There is no redaction hook: do not attach an Agent to a Runtime holding secrets you would not show the Inspector's user.
- **A peer cannot** mutate State, invoke Methods, evaluate code, or reach Runtime, Blueprint or DOM objects: only JSON DTOs cross the boundary.
- **The Runtime is read-only; the page is not untouched.** While Inspect mode is enabled the Agent installs capture-phase `pointerdown`, `pointerup` and `click` handlers on the inspected root that stop activation of anchored elements, a capture-phase Escape `keydown` handler on the document, and a fixed overlay element in the inspected document. Renderer elements are never modified.
- Any failure while handling a request answers `internal-error` for that request and the Agent keeps serving. The peer never sees the cause; the Agent reports the original exception in its own realm with a queued rethrow (`queueMicrotask(() => { throw error })`), so it surfaces as an uncaught error in the host. A subscribe request whose success response cannot be sent is rolled back, leaving no subscription under an id the peer never learned.

## Known limitations

- **Single DOM root.** Anchors are only read inside the one `dom.root`; Teleport/portal content is not inspectable and its clicks are not suppressed in Inspect mode.
- **`hidden` is ambiguous**: it covers both "no layout rect" and "no anchor element".
- **Opaque class instances.** `Date`, `Map`, `Set`, `Error` and other class instances encode as `{ type: 'opaque', kind: 'class-instance' }`.
- **Not provided:** State/Method diagnostics on the wire, a redaction hook, new value kinds, multiple DOM roots, and any kind of mutation.

The private [Widget Lab](../lab/){target="_self"} consumes only these public subpaths for its Inspect mode.
