# @deviltea/widget-vue

Cross-cutting Diagnostic/Result/Failure/Error conventions are maintained in
[Widget API conventions](https://github.com/DevilTea/widget/blob/main/docs/architecture/widget-api-conventions.md).

> ESM-only package.

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![License][license-src]][license-href]

A thin Vue 3 integration over [`@deviltea/widget-core`](https://www.npmjs.com/package/@deviltea/widget-core)
Runtime semantics: a keyed renderer registry, a recursive `WidgetRenderer` root
component, and the `useWidget(Plugin)` bridge that lazily projects a
`RuntimeWidget` into Vue-native `Ref`s and callables.

## Installation

To install the package, use either `npm`, `yarn`, or `pnpm`:

```bash
npm install @deviltea/widget-vue @deviltea/widget-core vue
```

```bash
yarn add @deviltea/widget-vue @deviltea/widget-core vue
```

```bash
pnpm add @deviltea/widget-vue @deviltea/widget-core vue
```

`vue` (^3.5) and `@deviltea/widget-core` are both peer dependencies, so install
them next to this package as shown above. Core must be a peer rather than a
nested dependency: it recognizes its own Runtimes by module-local identity, so
an application that ends up with two copies of `@deviltea/widget-core` (for
example through version skew) would build a Runtime with one copy and hand it to
an adapter that imports the other. `WidgetRenderer` detects this when it is
first given the Runtime and throws `WidgetVueIntegrationError` with code
`foreign-runtime`, instead of rendering and failing on the first `emit`. If you
see that error, make your package manager resolve a single
`@deviltea/widget-core` copy.

## Usage

Register one Vue renderer component per plugin type, then mount the root
component with a `WidgetSystemRuntime`:

```ts
// renderer.ts
import { createWidgetVueRenderer } from '@deviltea/widget-vue'
import { SectionRenderer, TextInputRenderer, TextRenderer } from './renderers'
import { system } from './system'

export const WidgetRenderer = createWidgetVueRenderer(
	system,
	renderers =>
		renderers
			.Text(TextRenderer)
			.TextInput(TextInputRenderer)
			.Section(SectionRenderer),
)
```

```vue
<!-- App.vue -->
<script setup lang="ts">
import { WidgetRenderer } from './renderer'
import { runtime } from './runtime'
</script>

<template>
	<WidgetRenderer :runtime="runtime" />
</template>
```

A renderer component receives no `widget` prop. It calls `useWidget(Plugin)`,
which is both the compile-time type witness (deriving the exact
state/property/method/slot surfaces from the plugin's declared interfaces) and
a runtime assertion that the currently rendered widget belongs to that exact
plugin instance:

```vue
<!-- TextInputRenderer.vue -->
<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { TextInputPlugin } from './plugins/text-input'

const { useState, useProperties, useMethods, useStateDiagnostics } = useWidget(TextInputPlugin)
const { value } = useState()
const { charCount } = useProperties()
const { clear } = useMethods()
const { value: valueDiagnostics } = useStateDiagnostics()
</script>

<template>
	<div>
		<input v-model="value">
		<span>{{ charCount }} characters</span>
		<button @click="clear()">
			Clear
		</button>
		<p v-if="valueDiagnostics.length > 0">
			{{ valueDiagnostics[0].message }}
		</p>
	</div>
</template>
```

- Accessors mirror `@deviltea/widget-core`'s section names: `state` is `useState()`,
  `properties` is `useProperties()`, `methods` is `useMethods()`, `events` is `emit`,
  `slots` is `WidgetSlot`, `config` is `config`; a member-diagnostics accessor is the
  section accessor plus `Diagnostics`.
- Call `useWidget()` synchronously during `setup()`: in a hand-written `async setup()`,
  call it before the first `await` (it throws `outside-widget-renderer` afterwards, because
  Vue has no current component instance). A top-level `await` in `<script setup>` is fine.
- `useState()` returns writable `Ref<T | null>`s. The setter delegates to the
  Runtime; on rejection the ref rolls back to the Runtime's own value (a
  rejected `v-model` candidate is rolled back visually for free).
- `useProperties()` returns readonly `Ref<T | null>`s: `ExecutionResult`
  success projects to its value, failure projects to `null` — never a
  last-successful fallback. Because failure is `null`, a member whose own type
  includes `null` cannot tell "failed" from a legitimate `null` through its value
  alone; read its diagnostics ref (`usePropertyDiagnostics()`) to distinguish them.
- `useMethods()` returns stable callables shaped
  `(...args: Parameters<Fn>) => ReturnType<Fn> | null`. Semantic failure
  projects to `null`; implementation-contract/disposed-runtime exceptions
  propagate unchanged.
- `useStateDiagnostics()` / `usePropertyDiagnostics()` / `useMethodDiagnostics()` mirror the
  corresponding Runtime primitive's `getDiagnostics()`/`subscribeDiagnostics()` as a
  separate reactive channel, keyed the same way as their value counterpart.
- `emit` (only when the plugin declares `events`) exposes one `void`-returning
  callable per declared event, typed from its arguments. Looking up a member is
  passive; the first call acquires the Core event emitter and forwards the
  arguments. An undeclared name yields `undefined`.
- `widgetId` / `widgetType` are always present, plain readonly values (not refs)
  identifying the current widget; the adapter stamps no DOM attributes from them.
- `config` (only when the plugin declares `config`) is the widget's resolved config: the
  Runtime widget's own object, neither cloned nor reactive (a widget's resolved config never
  changes within one Runtime). It is typed deeply read-only and renderers must not mutate it.
- `useDiagnostics()` mirrors `RuntimeWidget.getDiagnostics()`/`subscribeDiagnostics()` — this
  widget's own aggregate, not the Runtime-wide collected aggregate. Unlike the keyed
  `useXxx()` surfaces it returns a single readonly ref.
- Every accessor is gated on the plugin's declared capabilities: an absent
  capability drops the accessor entirely; an explicitly-declared-empty
  capability keeps it present with an empty keyed surface.
- Everything is lazy: obtaining `useState()` or accessing a member never reads
  or subscribes the Runtime by itself — only the first `.value` read (or
  method call) does, and exactly one Runtime subscription is created per
  bridge member per `useWidget()` call, cleaned up when the owning component
  unmounts. A keyed surface lists exactly the declared members through
  `Object.keys`, spread, `in` and `toRefs()`, without subscribing anything.

### Slots

A widget with a `slots` capability exposes `WidgetSlot` from `useWidget()`,
typed to its exact declared slot-name union:

```vue
<!-- SectionRenderer.vue -->
<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { SectionPlugin } from './plugins/section'

const { WidgetSlot } = useWidget(SectionPlugin)
</script>

<template>
	<section>
		<header>
			<WidgetSlot name="header" />
		</header>
		<WidgetSlot name="content" />
	</section>
</template>
```

`WidgetSlot` is one shared internal component identity across the whole
package — using it never allocates a new component definition — and it
renders the current widget's semantic slot children recursively, in
declaration order, with no filtering/sorting/fallback semantics of its own.

Give `WidgetSlot` a default scoped slot to wrap, decorate or skip each child. It is called
once per child, in Blueprint order, with `{ Child, id, type, index }`:

```vue
<WidgetSlot name="content">
	<template #default="{ Child, id, type, index }">
		<li :data-widget="id" :data-type="type" :data-index="index">
			<Child />
		</li>
	</template>
</WidgetSlot>
```

`Child` renders that child widget through the normal host (same renderer, `useWidget()`
context, subscriptions and nesting as the unscoped form) and is the same component on every
re-render, so wrapping it never remounts the child. `id` and `type` are the child's widget id
and plugin type, `index` its position in the slot. No Runtime handle is exposed; render
nothing for a child to skip it. Without a default slot `WidgetSlot` is unchanged.

### Root lifecycle

`WidgetRenderer`'s only semantic prop is `runtime`. The first time it is given a
Runtime it rejects a non-object (`invalid-runtime`) and a Runtime from another
copy of `@deviltea/widget-core` (`foreign-runtime`), then validates
`runtime.blueprint.system` against the exact `WidgetSystem` instance
`createWidgetVueRenderer` was bound to (a mismatch throws
`WidgetVueIntegrationError` with code `runtime-system-mismatch`; all are
programmer/configuration exceptions, never a Widget Diagnostic). It fully unmounts and remounts its internal tree whenever the
`runtime` prop identity changes (even for a structurally identical root), and
never calls `runtime.dispose()` itself — Runtime lifetime stays owned by the
caller. Registering something that is not a component is rejected when the
registry is built (`invalid-renderer-registry`, listed in `invalidTypes`).

## Inspecting widgets

This package never stamps DOM attributes. To make a rendered widget inspectable, stamp the
anchor attributes from your own renderer's root element with
`inspectAnchorAttributes({ widgetId, widgetType })` from
`@deviltea/widget-inspector/anchor`, using the identity `useWidget()` exposes.

## Testing a renderer

`@deviltea/widget-vue/testing` mounts ONE renderer component against a real Runtime without
a full registry, using plain Vue (no `@vue/test-utils` needed):

```ts
import { createWidgetTestHost } from '@deviltea/widget-vue/testing'
import { createApp } from 'vue'

const host = createWidgetTestHost(runtime, 'section-1', SectionRenderer, {
	Text: TextRenderer,
})

createApp(host)
	.mount(document.createElement('div'))
```

`createWidgetTestHost(runtime, widgetId, component, renderers?)` renders `component` as that
widget's renderer in its real context. The optional `renderers` map (by plugin type) renders the
widgets inside its slots; unmapped types render as nothing. It validates the Runtime like the
root renderer does and throws `unknown-widget` for an unknown widget id.

## Server rendering

Server rendering of the renderer against a long-lived or shared Runtime is
**unsupported** and leaks subscriptions (a declared non-goal, not a bug to be
fixed). `useWidget()` activates Core subscriptions
lazily on the first `.value` read and releases them only through Vue's
`onScopeDispose`; Vue's server renderer never stops component effect scopes, so
every server render would leave subscriptions registered on the Runtime until
`runtime.dispose()`, accumulating on each request. There is no SSR-specific
code path, flag, or hydration guarantee. Mount `WidgetRenderer` on the client only
(client-only components inside an SSR application are fine). See
[Server rendering](https://deviltea.github.io/widget/packages/widget-vue#server-rendering)
in the full guide for the reasoning and open prerequisites.

## License

[MIT](https://github.com/DevilTea/widget/blob/main/LICENSE) License © 2023-PRESENT [DevilTea](https://github.com/DevilTea)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@deviltea/widget-vue?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/@deviltea/widget-vue
[npm-downloads-src]: https://img.shields.io/npm/dm/@deviltea/widget-vue?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/@deviltea/widget-vue
[bundle-src]: https://img.shields.io/bundlephobia/minzip/@deviltea/widget-vue?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=@deviltea/widget-vue
[license-src]: https://img.shields.io/github/license/DevilTea/widget.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/DevilTea/widget/blob/main/LICENSE
