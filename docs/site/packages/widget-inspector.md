---
title: '@deviltea/widget-inspector'
---

# @deviltea/widget-inspector

`@deviltea/widget-inspector` is the single published Inspector boundary for Widget: a read-only, versioned protocol, a client, a DOM agent, transports, and the inspect-anchor attribute contract. It is `0.x` experimental with a **protocol-major guarantee only**: while on `0.x` an npm minor release may break the TypeScript API, and cross-realm compatibility is governed by the protocol version.

For installation and a minimal example, see the
[package README](https://github.com/DevilTea/widget/tree/main/packages/inspector#readme).

## Shape

```text
Inspector UI -> InspectorClient -> InspectorTransport -> InspectorAgent
                                                          |
                              @deviltea/widget-core/inspection + inspected DOM
```

The Agent projects authoritative Core inspection facts into serializable DTOs and owns inspected-document hit testing, pointer suppression, and highlight chrome. The client never receives Runtime, Blueprint, or DOM objects. The boundary is read-only: no state mutation, Method invocation, eval, or generic object RPC.

`@deviltea/widget-core` is a **peer dependency**. A second bundled Core copy would make the Agent reject the host's Runtime as foreign.

## Public subpaths

There is no root entry. The public subpaths are exactly:

- `/protocol`: protocol version, DTO types, and message validators.
- `/client`: the inspecting-side client.
- `/transport`: the transport interface plus in-process and MessagePort transports.
- `/channel`: logical channels multiplexed over one MessagePort.
- `/frame-bootstrap`: the one-time frame bootstrap envelope.
- `/agent`: the Agent bound to one Runtime and one inspected DOM root.
- `/value`: the bounded `InspectableValue` display encoding.
- `/anchor`: `inspectAnchorAttributes` and the anchor attribute names.

Everything else in the package is internal.

## Two version axes

- **npm semver** governs the TypeScript API.
- **Protocol `major.minor`** governs cross-realm compatibility. Minors only add negotiated capabilities, so an older-minor peer never sees newer behaviour; a breaking DTO change bumps the major.

## Inspect anchors

A renderer marks its DOM for a Widget with `inspectAnchorAttributes({ widgetId, widgetType })` from `/anchor`.

- An anchor is any renderer-owned element carrying both attributes. Several elements may mark one Widget, and each contributes a rect to `rects[]` in document order. No wrapper element is required.
- The innermost resolvable anchor wins hit-testing.
- Anchors live and die with the renderer's DOM. There is no register or cleanup API.
- Anchors carry identity only. They never carry Runtime or root identity: the Agent binds one Runtime to one root and resolves the attributes against Core inspection, so stale values resolve to no target.

[`@deviltea/widget-vue`](./widget-vue) deliberately stamps no DOM attributes or directives. A Vue renderer projects `useWidget()` identity through `inspectAnchorAttributes` itself.

## Highlight and subscription cap

The highlight is drawn by the Agent in its own ShadowRoot overlay attached to the inspected document, from geometry rects. The Agent never mutates renderer elements, and a renderer re-render does not clear the highlight.

`createInspectorAgent({ maxSubscriptions })` optionally bounds live Runtime subscriptions. There is no default limit; `subscription-limit` is returned only when a cap is configured, and only to peers negotiated at protocol 0.3 or newer.

The private [Widget Lab](../lab/){target="_self"} consumes only these public subpaths for its Inspect mode.
