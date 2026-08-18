---
title: '@deviltea/widget-vue'
---

# @deviltea/widget-vue

`@deviltea/widget-vue` is a thin Vue 3 integration over
[`@deviltea/widget-core`](./widget-core) Runtime semantics. It owns exactly
three things — a keyed renderer registry, a recursive root renderer, and the
`useWidget(Plugin)` bridge — and reimplements no core semantics of its own.

This guide covers the full public surface. For installation and a minimal
end-to-end example, see the
[package README](https://github.com/DevilTea/deviltea-labs/tree/main/packages/widget/vue#readme).
For an interactive playground built on this integration, see the
[Widget Lab](/widget-lab/){target="_self"}.

## Core model

```text
createWidgetVueRenderer(system, build) -> WidgetRenderer component
    build: renderers => renderers.TypeA(ComponentA).TypeB(ComponentB)...

<WidgetRenderer :runtime="runtime" />
    -> recursive internal host tree, one host per rendered widget

useWidget(Plugin)  (called inside a registered renderer component)
    -> { useState, useProperties, useMethods,
         useStateIssues, usePropertyIssues, useMethodIssues,
         useIssues, WidgetSlot }
    each accessor present only if Plugin declares that capability
```

## Renderer registry

`createWidgetVueRenderer(system, build)` uses the same keyed section-typestate
model `@deviltea/widget-core` uses for `state`/`properties`/`methods`: the
callback receives a keyed-chain builder whose `Remaining` type parameter
starts as `system`'s exact plugin-type union and shrinks by one literal per
registered key. The callback can only type-check once every plugin type has
been registered exactly once — there is no `.register(type, component)`,
`.add(...)`, or mutable post-construction registry.

```ts
const WidgetRenderer = createWidgetVueRenderer(
	system,
	renderers =>
		renderers
			.Section(SectionRenderer)
			.Text(TextRenderer)
			.Input(InputRenderer),
)
```

- Builder keys cover the same arbitrary string-literal domain as registered
  `plugin.type` values, including non-identifier strings via bracket access
  (`renderers['some-weird-type'](Component)`) and collision-hazard names
  (`__proto__`, `constructor`).
- A system whose plugin-type union has been broadened to plain `string` can
  never produce a complete registry: `Exclude<string, AnyLiteral>` stays
  `string`, so the callback's return type can never satisfy the required
  `Remaining extends never` completion.
- Construction also validates coverage against the actual `system` instance at
  runtime (type-level completeness alone cannot stop `any`/untyped call
  sites): missing, unknown, or duplicate renderer registration all throw
  `WidgetVueIntegrationError` — a programmer/configuration exception, never a
  Widget Issue.
- The returned component is bound to the exact `WidgetSystem` instance
  supplied; a `WidgetSystemRuntime` from a different (even structurally
  identical) `WidgetSystem` is rejected the same way.

## Root renderer contract

```vue
<WidgetRenderer :runtime="runtime" />
```

- `runtime: WidgetSystemRuntime<Plugins>` is the only semantic prop. There is
  no raw-definition, Blueprint, root-widget, fallback-renderer, or
  loading/error-slot prop.
- Mount/render time validates `runtime.blueprint.system === boundSystem`.
- If the `runtime` prop's identity changes, the entire internal host/renderer
  tree fully unmounts and a fresh tree mounts — even when the root `id`/`type`
  are identical — so every Vue bridge subscription from the previous Runtime
  is guaranteed to be cleaned up.
- `WidgetRenderer` never calls `runtime.dispose()`, on unmount or replacement.
  Runtime lifetime is owned by the caller.

Internally, the package owns a private recursive host tree: `WidgetRenderer`
renders an internal host per widget, which provides the current `RuntimeWidget`
through a private Vue injection context and renders the registered component
for that widget's exact plugin type. Renderer components never receive a
`widget` prop — they call `useWidget(Plugin)`, and `Plugin` doubles as the
compile-time type witness and a runtime exact-identity assertion (a mismatch
throws `WidgetVueIntegrationError`).

## `useWidget(Plugin)`

```ts
const {
	useState,
	useProperties,
	useMethods,
	useStateIssues,
	usePropertyIssues,
	useMethodIssues,
	useIssues,
	WidgetSlot,
} = useWidget(SectionPlugin)
```

Every accessor is derived from `Plugin`'s declared `WidgetInterfaces`: an
absent capability drops the corresponding accessor entirely; an
explicitly-declared-empty capability (for example `state: Record<never, never>`
or the canonical explicit-empty slots spelling `slots: never`) keeps the
accessor present with an empty (or, for `WidgetSlot`, never-typed) keyed
surface. Presence is read from `plugin.capabilities` at runtime and from
`HasWidgetCapability<Interfaces, Key>` at the type level — both
declaration-presence facts, never a `[Payload] extends [never]` test, since a
legitimately-present capability can itself have payload `never`. `useIssues()`
and `WidgetSlot`'s gating aside, this mirrors exactly how
`@deviltea/widget-core`'s own `RuntimeStateSurface`/`RuntimePropertySurface`/
`RuntimeMethodSurface` gate `state`/`properties`/`methods` on the Runtime
widget itself.

Every `useXxx()` call returns a typed keyed Proxy-like surface. Obtaining the
surface, and accessing a member off it, never reads or subscribes the Runtime —
only materializes/caches that member's Vue wrapper. Both the capability-surface
object and each member wrapper are stable/cached within one `useWidget(Plugin)`
call.

### State

```ts
const { budget } = useState()

budget.value // T | null
budget.value = 100_000
budget.value = null
```

- Backed by a `customRef`-style projection with no authoritative mirrored
  cache. The first `.value` read activates exactly one Runtime subscription;
  the Runtime subscription's listener only `trigger()`s Vue — the next getter
  always re-reads the Runtime directly.
- The setter delegates to `RuntimeState.set()` and performs no optimistic
  local write. `null` is a legal Vue-boundary candidate; the Runtime's own
  `validate` remains authoritative and may reject it.
- If a candidate is rejected, the bridge explicitly invalidates Vue so
  consumers (in particular `v-model`) re-read the authoritative Runtime value
  instead of keeping the rejected candidate.

### Properties

```ts
const { estimatedCost } = useProperties()

estimatedCost.value // T | null, readonly
```

`ExecutionResult.success(value)` projects to `value`; `failure` projects to
`null`, with no last-successful fallback. `ExecutionResult` itself is never
exposed through this surface.

### Methods

```ts
const { submit } = useMethods()

submit(...args) // ReturnType<Fn> | null
```

`useMethods()` exposes lazy, stable callable wrappers shaped
`(...args: Parameters<Fn>) => ReturnType<Fn> | null` — not refs, and no
subscription is created merely by obtaining or calling one. Semantic success
projects to the returned value; semantic failure projects to `null`.
Implementation-contract exceptions and disposed-Runtime errors propagate
unchanged. Arbitrary legal method names, including JavaScript-special ones
such as `then`, receive no special handling.

### Diagnostics

```ts
const { budget: budgetIssues } = useStateIssues()
const { estimatedCost: estimatedCostIssues } = usePropertyIssues()
const { submit: submitIssues } = useMethodIssues()
const issues = useIssues()
```

`useStateIssues()` / `usePropertyIssues()` / `useMethodIssues()` mirror the
corresponding Runtime primitive's `getIssues()`/`subscribeIssues()` through
the same lazy keyed-Proxy model as their value counterpart, independently
lazy per member. `useIssues()` mirrors the widget-level aggregate —
`RuntimeWidget.getIssues()`/`subscribeIssues()` — never the Runtime-wide
`WidgetSystemRuntime.getCollectedIssues()`. Every projection preserves the
core snapshot objects and order exactly: no message parsing, no
reclassification, no invented aggregation.

### Slots

```vue
<WidgetSlot name="content" />
```

Present on the `useWidget()` surface only when the plugin declares a `slots`
capability, typed to its exact declared slot-name union. `WidgetSlot` is
syntactic sugar over one shared internal component identity — obtaining it
repeatedly, across widgets or `useWidget()` calls, never allocates a new
component definition. It renders the current widget's semantic slot children
recursively, in declaration order, with no filtering, sorting, or
fallback-renderer behavior of its own.

### What `useWidget()` deliberately does not expose

No `runtime`, `system`, or unrestricted `getWidget` escape hatch. Every
cross-widget interaction stays mediated by `@deviltea/widget-core`
dependencies (`registerDeps`); renderer code cannot reach across the widget
tree outside that mechanism.

## Design constraints

- **No domain widgets.** Survey/Product Prototype (or any other) domain
  widgets stay out of this package.
- **No editor-domain UI.** Lab inspectors, source editors, and similar
  editor-domain operations stay out of this package.
- **No persistence.** Persistence, versioning, and migration stay out of this
  package.
- **No showcase state.** Showcase-specific application state or business
  rules stay out of this package; they belong to the downstream consumer
  (`widget-lab`).
- **Core stays authoritative.** This package never reimplements or
  reinterprets `@deviltea/widget-core` semantics; it only projects the
  existing Runtime surface into Vue-native reactivity.

The canonical, authoritative decision log for this integration is
[GitHub issue #13](https://github.com/DevilTea/deviltea-labs/issues/13) —
"Widget Vue integration — Phase 3 decision log." Its checkpoints, together
with [issue #10](https://github.com/DevilTea/deviltea-labs/issues/10) for
core semantics, are authoritative over this guide.
