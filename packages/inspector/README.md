# @deviltea/widget-inspector

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

`@deviltea/widget-core` is a **peer dependency**: the Agent must see the very same Core copy that created the host's Runtime, or `inspectRuntime` rejects the Runtime as foreign.

## Public subpaths

There is no root entry; import from exactly these subpaths.

| Subpath | Purpose |
| --- | --- |
| `/protocol` | Protocol version, DTO types, request/response/event validators and parsers. |
| `/client` | `createInspectorClient`, the inspecting side. |
| `/transport` | Transport interface plus in-process and MessagePort transports. |
| `/channel` | `createMessagePortChannelHub`: several logical transports over one MessagePort. |
| `/frame-bootstrap` | One-time, validated bootstrap envelope that transfers a dedicated MessagePort into a frame. |
| `/agent` | `createInspectorAgent`, bound to one Runtime and (optionally) one inspected DOM root. |
| `/value` | The bounded, accessor-safe `InspectableValue` display encoding. |
| `/anchor` | `inspectAnchorAttributes` and the anchor attribute names, for renderers. |

## Usage

```ts
import { createInspectorAgent } from '@deviltea/widget-inspector/agent'
import { createInspectorClient } from '@deviltea/widget-inspector/client'
import { createInProcessInspectorTransportPair } from '@deviltea/widget-inspector/transport'

const pair = createInProcessInspectorTransportPair()
const agent = createInspectorAgent({ runtime, transport: pair.agent, dom: { root: document.getElementById('app')! } })
const client = createInspectorClient(pair.client)

await client.handshake()
const { runtimes } = await client.request('runtime.list', {})
```

The boundary is read-only: no state mutation, Method invocation, eval, generic object RPC, or Runtime discovery global hook.

### Anchors

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

### Subscription cap

`createInspectorAgent({ maxSubscriptions })` optionally bounds live Runtime member and event subscriptions. There is **no default limit**. When a configured cap is reached, further subscribe requests fail with `subscription-limit`.

## Versioning

Two independent axes:

- **npm semver** governs the TypeScript API. While on `0.x`, a minor release may break it.
- **Protocol `major.minor`** (`INSPECTOR_PROTOCOL_VERSION`) governs cross-realm compatibility. Minors only add negotiated capabilities; a breaking DTO change bumps the major. An Agent and a Client on different package versions interoperate whenever the protocol major matches.

The protocol is currently `0.3`; `subscription-limit` requires `0.3`, and peers negotiated at an older minor never receive it.
