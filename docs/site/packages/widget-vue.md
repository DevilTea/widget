---
title: '@deviltea/widget-vue'
---

# @deviltea/widget-vue

`@deviltea/widget-vue` is a thin Vue 3 integration over
[`@deviltea/widget-core`](./widget-core) Runtime semantics. It owns exactly
three things — a keyed renderer registry, a recursive root renderer, and the
`useWidget(Plugin)` bridge — plus a small testing helper on the
`@deviltea/widget-vue/testing` subpath, and reimplements no core semantics of
its own.

This guide covers the full public surface. For installation and a minimal
end-to-end example, see the
[package README](https://github.com/DevilTea/widget/tree/main/packages/vue#readme).
Cross-cutting Diagnostic/Result/Failure/Error conventions are maintained in the
[Widget API conventions](https://github.com/DevilTea/widget/blob/main/docs/architecture/widget-api-conventions.md).
For an interactive playground built on this integration, see the
[Widget Lab](../lab/){target="_self"}.

## Core model

```text
createWidgetVueRenderer(system, build) -> WidgetRenderer component
    build: renderers => renderers.TypeA(ComponentA).TypeB(ComponentB)...

<WidgetRenderer :runtime="runtime" />
    -> recursive internal host tree, one host per rendered widget

useWidget(Plugin)  (called inside a registered renderer component)
    -> { widgetId, widgetType, useDiagnostics,                 always present
         config,                                               config capability
         useState, useStateDiagnostics,                        state capability
         useProperties, usePropertyDiagnostics,                properties capability
         useMethods, useMethodDiagnostics,                     methods capability
         emit,                                                 events capability
         WidgetSlot }                                          slots capability
    every other member is present only if Plugin declares that capability
```

## Installation

```bash
pnpm add @deviltea/widget-vue @deviltea/widget-core vue
```

`@deviltea/widget-core` and `vue` are peer dependencies. Core is a peer on
purpose: it recognizes its own Runtimes by module-local identity, so an
application with two copies of `@deviltea/widget-core` would build a Runtime
with one copy and hand it to an adapter importing the other. `WidgetRenderer`
detects that the first time it is given the Runtime and throws
`WidgetVueIntegrationError` with code `foreign-runtime`, rather than rendering
and failing at the first `emit`. Make your package manager resolve a single
copy of `@deviltea/widget-core`.

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
  sites): missing, unknown, or duplicate renderer registration, and a
  registered value that is not a Vue component (a component object or
  function), all throw `WidgetVueIntegrationError` (code
  `invalid-renderer-registry`) — a programmer/configuration exception, never a
  Widget Diagnostic.
- The returned component is bound to the exact `WidgetSystem` instance
  supplied; a `WidgetSystemRuntime` from a different (even structurally
  identical) `WidgetSystem` is rejected the same way.

## Root renderer contract

```vue
<WidgetRenderer :runtime="runtime" />
```

- `runtime: WidgetSystemRuntime<Plugins>` is the only semantic prop. There is
  no raw source, Blueprint, root-widget, fallback-renderer, or
  loading/error-slot prop.
- The first time the root renderer is given a Runtime it validates it: a
  non-object `runtime` throws `invalid-runtime`, a Runtime that was not
  produced by the `@deviltea/widget-core` instance this package imports (two
  copies installed) throws `foreign-runtime`, and then
  `runtime.blueprint.system === boundSystem` is validated
  (`runtime-system-mismatch`).
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
throws `WidgetVueIntegrationError` with code `widget-plugin-mismatch`).

## `useWidget(Plugin)`

```ts
const {
	config,
	useState,
	useProperties,
	useMethods,
	useStateDiagnostics,
	usePropertyDiagnostics,
	useMethodDiagnostics,
	useDiagnostics,
	emit,
	WidgetSlot,
	widgetId,
	widgetType,
} = useWidget(SectionPlugin)
```

Call `useWidget()` synchronously during `setup()`: in a hand-written
`async setup()`, call it before the first `await`, because Vue has no current
component instance after an `await` and `useWidget()` then throws
`outside-widget-renderer`. A top-level `await` in `<script setup>` is fine; Vue
restores the instance for the code after it.

Accessors mirror `@deviltea/widget-core`'s section names, not a naming scheme of
their own: `state` is `useState()`, `properties` is `useProperties()`, `methods`
is `useMethods()`, `events` is `emit`, `slots` is `WidgetSlot`, and `config` is
`config`. Each member-diagnostics accessor is the section accessor with
`Diagnostics` appended (`useStateDiagnostics()`, `usePropertyDiagnostics()`,
`useMethodDiagnostics()`), and `useDiagnostics()` is the widget-level aggregate.

Every accessor is derived from `Plugin`'s declared `WidgetInterfaces`: an
absent capability drops the corresponding accessor entirely; an
explicitly-declared-empty capability (for example `state: Record<never, never>`
or the canonical explicit-empty slots spelling `slots: never`) keeps the
accessor present with an empty (or, for `WidgetSlot`, never-typed) keyed
surface. Presence is read from `plugin.capabilities` at runtime and from
`HasWidgetCapability<Interfaces, Key>` at the type level — both
declaration-presence facts, never a `[Payload] extends [never]` test, since a
legitimately-present capability can itself have payload `never`. `useDiagnostics()`
and `WidgetSlot`'s gating aside, this mirrors exactly how
`@deviltea/widget-core`'s own `RuntimeStateSurface`/`RuntimePropertySurface`/
`RuntimeMethodSurface` gate `state`/`properties`/`methods` on the Runtime
widget itself.

`useState()`, `useProperties()`, `useMethods()` and the three member-diagnostics
accessors each return a typed keyed Proxy-like surface (`emit` is the same kind
of surface); `useDiagnostics()` is different: it returns a single readonly ref
for the whole widget, not a keyed surface. Obtaining a surface, and accessing a
member off it, never reads or subscribes the Runtime — only materializes/caches
that member's Vue wrapper. Both the capability-surface object and each member
wrapper are stable/cached within one `useWidget(Plugin)` call.

A keyed surface is truthful about its members: `Object.keys(surface)`, spread,
`in` and `toRefs()` reflect exactly the members the plugin declared (and
nothing else), while enumerating keys still materializes nothing and
subscribes nothing. An undeclared name is `undefined` and absent from `in`.

Because a failed Property or Method projects to `null` (see below), a member
whose own type includes `null` cannot distinguish "failed" from a legitimate
`null` result through its value alone; read that member's diagnostics ref
(`usePropertyDiagnostics()` / `useMethodDiagnostics()`) to tell them apart.

### Config

```ts
const { config } = useWidget(SectionPlugin)

config.title // the resolved config value, typed deeply read-only
```

`config` is present only when the plugin declares the `config` capability. It
is the widget's resolved config — the value the plugin's `config.resolve`
returned — and is exactly the object the Runtime widget holds: neither cloned
nor reactive, because within one Runtime a widget's resolved config never
changes. Renderers must treat it as read-only; the type makes every level
readonly, but nothing freezes it at runtime.

### State

```ts
const { budget } = useState()

budget.value // T | null
budget.value = 100_000
budget.value = null
```

- Backed by a `customRef`-style projection with no authoritative mirrored
  cache. The first `.value` read activates exactly one Runtime subscription per
  bridge member **per `useWidget()` call** (two calls give two independent
  members, each with its own subscription); the Runtime subscription's listener
  only `trigger()`s Vue — the next getter always re-reads the Runtime directly.
  A subscription is released when the component that called `useWidget()`
  unmounts.
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

An `ExecutionResult` with `ok: true` projects its `value`; the `ok: false`
branch projects to `null`, with no last-successful fallback. The
`ExecutionResult` itself is never exposed through this surface. Core types a
successful value as exactly `T`; the `| null` in the Vue type exists only for
this failure projection, which is why a `T` that already includes `null` is
ambiguous without the member's diagnostics ref.

### Methods

```ts
const { submit } = useMethods()

submit(...args) // ReturnType<Fn> | null
```

`useMethods()` exposes lazy, stable callable wrappers shaped
`(...args: Parameters<Fn>) => ReturnType<Fn> | null` — not refs, and no
subscription is created merely by obtaining or calling one. Semantic ok
projects to the returned value; semantic failure projects to `null`.
Implementation-contract exceptions and disposed-Runtime errors propagate
unchanged. Arbitrary legal method names, including JavaScript-special ones
such as `then`, receive no special handling.

### Diagnostics

```ts
const { budget: budgetDiagnostics } = useStateDiagnostics()
const { estimatedCost: estimatedCostDiagnostics } = usePropertyDiagnostics()
const { submit: submitDiagnostics } = useMethodDiagnostics()
const diagnostics = useDiagnostics()
```

`useStateDiagnostics()` / `usePropertyDiagnostics()` / `useMethodDiagnostics()` mirror the
corresponding Runtime primitive's `getDiagnostics()`/`subscribeDiagnostics()` through
the same lazy keyed-Proxy model as their value counterpart, independently
lazy per member. `useDiagnostics()` mirrors the widget-level aggregate —
`RuntimeWidget.getDiagnostics()`/`subscribeDiagnostics()` — never the Runtime-wide
`WidgetSystemRuntime.getDiagnostics()`. Every projection preserves the
core snapshot objects and order exactly: no message parsing, no
reclassification, no invented aggregation.

### Events

```ts
const { emit } = useWidget(SectionPlugin)

emit.saved(...args) // void
```

`emit` is present only when the plugin declares an `events` capability. Each
member is a callable typed from the declared event arguments and returning
`void`. Looking up or materializing a member is passive: it neither subscribes
nor acquires emit authority, and a name that is not a declared event yields
`undefined`. The first call acquires the widget's Core event emitter and
forwards the arguments to it.

### Identity

`widgetId` and `widgetType` are always present on the `useWidget()` result,
regardless of declared capabilities. They are plain readonly values (not refs)
projected once from the current rendered widget: `widgetId` is its
semantic/Blueprint id (`string`) and `widgetType` is its plugin type. The
adapter itself stamps no DOM attributes from them; a renderer may project them
onto its own markup.

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

#### Scoped slot

Without a default slot, `<WidgetSlot name="…" />` behaves exactly as above. With
a default scoped slot, it calls the slot once per child, in Blueprint order,
with `{ Child, id, type, index }`, so the renderer can wrap, decorate or skip
each child:

```vue
<WidgetSlot name="content">
	<template #default="{ Child, id, type, index }">
		<li :data-widget="id" :data-type="type" :data-index="index">
			<Child />
		</li>
	</template>
</WidgetSlot>
```

- `Child` is a component that renders that child widget through the normal
  host, so its registered renderer, its own `useWidget()` context, its
  subscriptions and its nested slots behave exactly as in the unscoped form.
- `id` is the child's widget id, `type` its plugin type (both `string`), and
  `index` its position in the slot; `index` counts children the renderer
  skips. No Runtime handle is exposed.
- The renderer decides the wrapping markup and whether to render a child at
  all (render nothing to skip it). An empty slot never calls the slot.
- `Child` is the same component for a given child on every re-render, so
  changing the wrapper markup or skipping a sibling never remounts the child
  widget. The slot props are typed publicly as `WidgetSlotScope`
  (`Child: WidgetSlotChildComponent`).

### What `useWidget()` deliberately does not expose

No `runtime`, `system`, or unrestricted `getWidget` escape hatch. Every
cross-widget interaction stays mediated by `@deviltea/widget-core`
dependencies (`registerDeps`); renderer code cannot reach across the widget
tree outside that mechanism.

## Inspecting widgets

This package never stamps DOM attributes, so a rendered widget is not
inspectable by default. A renderer that wants to be inspectable stamps the
anchor attributes onto its own root element, using the identity
`useWidget()` already exposes:

```ts
import { inspectAnchorAttributes } from '@deviltea/widget-inspector/anchor'
import { useWidget } from '@deviltea/widget-vue'

const { widgetId, widgetType } = useWidget(SectionPlugin)
const anchor = inspectAnchorAttributes({ widgetId, widgetType })
// bind on the renderer's root element, e.g. <section v-bind="anchor">
```

The attribute contract (names, identity-only shape, nesting) is owned by
[`@deviltea/widget-inspector`](./widget-inspector).

## Testing a renderer

`@deviltea/widget-vue/testing` renders ONE renderer component against a real
Runtime without building a full registry, using plain Vue (no
`@vue/test-utils` dependency):

```ts
import { createWidgetTestHost } from '@deviltea/widget-vue/testing'
import { createApp } from 'vue'

const host = createWidgetTestHost(runtime, 'section-1', SectionRenderer, {
	Text: TextRenderer,
})

const element = document.createElement('div')
createApp(host)
	.mount(element)
```

`createWidgetTestHost(runtime, widgetId, component, renderers?)` returns a
component that renders `component` as the renderer of widget `widgetId`: inside
it `useWidget(SectionPlugin)` resolves that widget exactly as under a real
`WidgetRenderer`, including the exact-plugin check. `component` always renders
that widget itself. The optional `renderers` map (keyed by plugin type, typed
from the Runtime's System) only decides how the widgets inside its slots render,
through `WidgetSlot` to any depth: a mapped type renders with its component and
every unmapped type renders as nothing. The Runtime is validated like the root
renderer's `runtime` prop, and an unknown `widgetId` throws
`WidgetVueIntegrationError` with code `unknown-widget`. The helper provides the
same widget context the real renderer provides, through the same construction;
it does not expose the private injection key, and it never disposes the
Runtime.

## Integration errors

Caller-reachable misuse throws `WidgetVueIntegrationError` (exported from the
root). Discriminate by class and `code`; `message` is descriptive only. The
code union is exported as the type `WidgetVueIntegrationErrorCode`.

| `code` | Condition |
|---|---|
| `invalid-renderer-registry` | `createWidgetVueRenderer` coverage is not exactly-once against the bound System, or a registered value is not a Vue component |
| `invalid-runtime` | the `runtime` prop is not an object (for example `null` or `undefined`) |
| `foreign-runtime` | the `runtime` prop was not produced by the `@deviltea/widget-core` instance this package imports (two copies installed) |
| `unknown-widget` | `createWidgetTestHost()` was given a widget id the Runtime does not contain |
| `runtime-system-mismatch` | the `runtime` prop was not created from the exact bound System |
| `outside-widget-renderer` | `useWidget()` or `WidgetSlot` is used without a current widget host, or `useWidget()` runs after an `await` in `async setup()` |
| `widget-plugin-mismatch` | `useWidget(Plugin)` and the current widget's exact plugin instance differ |
| `readonly-projection-write` | a Property or Diagnostics ref is written |

`invalid-renderer-registry` reports every defect together in four fields:
`missingTypes` (in System plugin order), `unknownTypes`, `duplicateTypes` and
`invalidTypes` (registered values that are not components), each in
first-registration order. They are frozen arrays for this code (possibly empty)
and `null` for every other code. The other codes carry no extra fields.

`WidgetVueIntegrationError` is an ordinary exported class extending `Error`
(`instanceof` works and it can be subclassed). The four lists are always typed
`readonly string[] | null`; they are non-null exactly when `code` is
`invalid-renderer-registry`, but the type does not narrow by `code`, so handle
`null` explicitly:

```ts
import { createWidgetVueRenderer, WidgetVueIntegrationError } from '@deviltea/widget-vue'

try {
	createWidgetVueRenderer(system, build)
}
catch (error) {
	if (error instanceof WidgetVueIntegrationError
		&& error.code === 'invalid-renderer-registry') {
		console.error(
			(error.missingTypes ?? []).join(', '),
			error.invalidTypes?.length ?? 0,
		)
	}
}
```

On the root renderer the checks run in this order: `invalid-runtime`,
`foreign-runtime`, then `runtime-system-mismatch`. Core errors (for example `WidgetSystemRuntimeDisposedError` and the `/integration`
errors) and exceptions thrown by your own callbacks propagate unchanged.

States that the exact-plugin, registry and System-identity checks make
impossible are internal invariants. They throw a plain `Error`, not
`WidgetVueIntegrationError`, and are not part of the contract. Only an object
that imitates a Runtime can reach them.

## Server rendering

Server rendering of the renderer against a long-lived or shared
`WidgetSystemRuntime` is **unsupported** and leaks subscriptions (see below).
This is a declared non-goal, not a bridge bug awaiting a fix; there is no
SSR-specific code path, flag, or hydration guarantee. Client-only mounting is
the supported pattern, including renderers mounted only on the client inside an
SSR application.

Why: the first `.value` read of a State, Property, or Diagnostics ref
activates one Core subscription, and each `useWidget()` bridge releases all of
its subscriptions together in `onScopeDispose`. Vue's server renderer runs
`setup()` and render but never stops component effect scopes, so those cleanup
callbacks never run. Every server render therefore leaves its activated
subscriptions registered with the Runtime until `runtime.dispose()`. With a
long-lived Runtime they accumulate on each request, growing memory without
bound and fanning every later change out into stale `customRef` triggers.

Creating a Runtime per request and disposing it after rendering does release
these subscriptions, because the Runtime owns their teardown. That is a
workaround rather than a supported pattern: the package still defines no SSR
code path, flag, or hydration guarantee, because the open gaps below remain.

A future SSR design would need, and this guide does not decide:

- an explicit render lifetime (snapshot-only reads with no Core subscription
  activation during SSR, or request-scoped cleanup owned by the adapter);
- a Runtime ownership model (per request or shared) consistent with
  "`WidgetRenderer` never disposes the Runtime";
- a hydration contract for how client Runtime state matches server output,
  given that Runtime state is never part of authored source, and how mismatches
  are handled;
- defined `emit` and Method semantics during server render;
- conformance tests under `@vue/server-renderer`, including subscription-count
  assertions across repeated renders against one Runtime.

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

The current canonical Widget architecture authority is
[DevilTea/widget Discussion #12](https://github.com/DevilTea/widget/discussions/12).
It contains the migrated historical Vue integration (`diagnostic #13`) and Core
(`diagnostic #10`) decisions together with current accepted amendments; those
current Discussion #12 decisions are authoritative over this guide.
