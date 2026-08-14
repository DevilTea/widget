# @deviltea/widget-vue

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

`vue` (^3.5) is a peer dependency; `@deviltea/widget-core` is a regular
dependency because this package's own published types are built on top of it.

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

const { useState, useProperties, useMethods, useStateIssues } = useWidget(TextInputPlugin)
const { value } = useState()
const { charCount } = useProperties()
const { clear } = useMethods()
const { value: valueIssues } = useStateIssues()
</script>

<template>
	<div>
		<input v-model="value">
		<span>{{ charCount }} characters</span>
		<button @click="clear()">
			Clear
		</button>
		<p v-if="valueIssues.length > 0">
			{{ valueIssues[0].message }}
		</p>
	</div>
</template>
```

- `useState()` returns writable `Ref<T | null>`s. The setter delegates to the
  Runtime; on rejection the ref rolls back to the Runtime's own value (a
  rejected `v-model` candidate is rolled back visually for free).
- `useProperties()` returns readonly `Ref<T | null>`s: `ExecutionResult`
  success projects to its value, failure projects to `null` — never a
  last-successful fallback.
- `useMethods()` returns stable callables shaped
  `(...args: Parameters<Fn>) => ReturnType<Fn> | null`. Semantic failure
  projects to `null`; implementation-contract/disposed-runtime exceptions
  propagate unchanged.
- `useStateIssues()` / `usePropertyIssues()` / `useMethodIssues()` mirror the
  corresponding Runtime primitive's `getIssues()`/`subscribeIssues()` as a
  separate reactive channel, keyed the same way as their value counterpart.
- `useIssues()` mirrors `RuntimeWidget.getIssues()`/`subscribeIssues()` — this
  widget's own aggregate, not the Runtime-wide collected aggregate.
- Every accessor is gated on the plugin's declared capabilities: an absent
  capability drops the accessor entirely; an explicitly-declared-empty
  capability keeps it present with an empty keyed surface.
- Everything is lazy: obtaining `useState()` or accessing a member never reads
  or subscribes the Runtime by itself — only the first `.value` read (or
  method call) does, and exactly one Runtime subscription is created per
  bridge member, cleaned up when the owning component unmounts.

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

### Root lifecycle

`WidgetRenderer`'s only semantic prop is `runtime`. It validates
`runtime.blueprint.system` against the exact `WidgetSystem` instance
`createWidgetVueRenderer` was bound to (a mismatch throws
`WidgetVueIntegrationError`, a programmer/configuration exception, never a
Widget Issue), fully unmounts and remounts its internal tree whenever the
`runtime` prop identity changes (even for a structurally identical root), and
never calls `runtime.dispose()` itself — Runtime lifetime stays owned by the
caller.

## License

[MIT](https://github.com/DevilTea/deviltea-labs/blob/main/LICENSE) License © 2023-PRESENT [DevilTea](https://github.com/DevilTea)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@deviltea/widget-vue?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/@deviltea/widget-vue
[npm-downloads-src]: https://img.shields.io/npm/dm/@deviltea/widget-vue?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/@deviltea/widget-vue
[bundle-src]: https://img.shields.io/bundlephobia/minzip/@deviltea/widget-vue?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=@deviltea/widget-vue
[license-src]: https://img.shields.io/github/license/DevilTea/deviltea-labs.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/DevilTea/deviltea-labs/blob/main/LICENSE
