---
name: widget-vue-renderer
description: "Implement Vue renderers for @deviltea/widget-core widgets with @deviltea/widget-vue: registering one component per plugin type with createWidgetVueRenderer, mounting the root renderer with a Runtime, the useWidget() surface (config, State, Properties, Methods, Events, diagnostics), slots and WidgetSlot, testing a renderer with @deviltea/widget-vue/testing, and the integration errors."
---

# Implementing Widget renderers in Vue

`@deviltea/widget-vue` renders the widgets of a `@deviltea/widget-core` Runtime with Vue 3. It has three parts: a
renderer registry (`createWidgetVueRenderer`), the root renderer component it returns, and `useWidget(Plugin)`, which a
renderer calls to read and drive its own widget. `@deviltea/widget-vue/testing` renders one renderer in a test.

This skill ships with `@deviltea/widget-vue` and describes the version it was installed with; Core and the adapter
are released together under one version. Its code samples are compiled, and run where they can, against that
version before it is published. For the plugins themselves, see the `widget-plugin-authoring` skill of
`@deviltea/widget-core`.

## Registration

One Vue component per plugin type, registered once for the System:

<!-- sample: vue-renderer-registration run -->
```ts
import type { WidgetSlotScope } from '@deviltea/widget-vue'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { createWidgetVueRenderer, useWidget, WidgetVueIntegrationError } from '@deviltea/widget-vue'
import { defineComponent, h } from 'vue'

interface CounterInterfaces {
	slots: { labels: 'Label' }
	state: { count: number }
	methods: { increment: () => number }
}

const Counter = createWidgetPlugin('Counter')
	.description('A counter with labels.')
	.interfaces<CounterInterfaces>()
	.slots({ labels: { description: 'Labels shown next to the count.' } })
	.state(state => state.count({
		description: 'The current count.',
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.methods(methods => methods.increment({
		description: 'Adds one.',
		returns: { description: 'The new count.' },
		validateArgs: (args): args is [] => args.length === 0,
		registerDeps: ({ dep }) => ({ count: dep.self.state.get('count'), setCount: dep.self.state.set('count') }),
		execute: ({ deps }) => {
			const current = deps.count()
			const next = (current.ok ? current.value ?? 0 : 0) + 1
			deps.setCount(next)
			return next
		},
	}))
	.done()

interface LabelInterfaces {
	config: { raw: { text: string }, resolved: { text: string } }
}

const Label = createWidgetPlugin('Label')
	.description('A text label.')
	.interfaces<LabelInterfaces>()
	.config({
		description: 'The label\'s text.',
		raw: { fields: { text: { description: 'The text shown.' } } },
		resolved: { fields: { text: { description: 'The text shown.' } } },
		validate: (input): input is LabelInterfaces['config']['raw'] => typeof input === 'object' && input !== null && typeof (input as { text?: unknown }).text === 'string',
		resolve: raw => raw ?? { text: '' },
	})
	.done()

const system = createWidgetSystem({ plugins: [Counter, Label] as const })

const CounterRenderer = defineComponent({
	setup() {
		// Synchronously in setup(), with the exact plugin object.
		const { useState, useMethods, useMethodDiagnostics, WidgetSlot } = useWidget(Counter)
		const { count } = useState()
		const { increment } = useMethods()
		const { increment: incrementDiagnostics } = useMethodDiagnostics()
		function press() {
			// `null` means the call failed; its diagnostics say why.
			if (increment() === null)
				console.warn(incrementDiagnostics.value)
		}
		return () => h('section', [
			h('button', { onClick: press }, `Count: ${count.value ?? 0}`),
			h(WidgetSlot, { name: 'labels' }, {
				default: ({ Child, id }: WidgetSlotScope<'Label'>) => h('span', { key: id }, [h(Child)]),
			}),
		])
	},
})

const LabelRenderer = defineComponent({
	setup() {
		const { config } = useWidget(Label)
		return () => h('span', config.text)
	},
})

export const SystemRenderer = createWidgetVueRenderer(system, renderers => renderers
	.Counter(CounterRenderer)
	.Label(LabelRenderer))

// The registry is exhaustive. An untyped call site that leaves a type out fails at run time too.
try {
	createWidgetVueRenderer(system, renderers => (renderers as any).Counter(CounterRenderer))
}
catch (error) {
	if (error instanceof WidgetVueIntegrationError)
		console.log(error.code, error.missingTypes) // invalid-renderer-registry [ 'Label' ]
}
```

- The chain names every plugin type of the System exactly once; it type-checks only when it is complete. There is no
  `register(type, component)` and the registry cannot change after it is built.
- Bracket access works for a type that is not an identifier: `renderers['some-type'](Component)`.
- The result is a component bound to that exact System. Mount it with a Runtime of that System:

  ```vue
  <SystemRenderer :runtime="runtime" />
  ```

  `runtime` is its only prop. A Runtime of another System, or from another copy of Core, throws
  `WidgetVueIntegrationError`; it is a programming error, not a diagnostic.
- Giving it a different Runtime unmounts and remounts the whole tree. It never disposes a Runtime: whoever created the
  Runtime (`blueprint.createRuntime()`) disposes it.
- Mount it on the client only: server rendering against a long-lived Runtime is unsupported and leaks subscriptions.

## The `useWidget()` surface

A renderer never receives a `widget` prop. It calls `useWidget(Plugin)` synchronously in `setup()` (in an
`async setup()`, before the first `await`; a top-level `await` in `<script setup>` is fine) with the exact plugin
object: it is the type witness and a run-time identity check. Only the accessors of the capabilities the plugin
declares are present.

| Accessor | Present when | What it gives |
| --- | --- | --- |
| `config` | config | The resolved config, typed deeply read-only (never the raw one). Not reactive: it never changes within one Runtime. |
| `useState()` | state | One writable `Ref<T \| null>` per State member. Assigning runs the member's `validate`; a rejected write is reported in `useStateDiagnostics()` and the ref shows the Runtime's value again. |
| `useProperties()` | properties | One read-only ref of `T \| null` per Property, computed lazily on first read. `null` means the Property failed; `usePropertyDiagnostics()` says why. |
| `useMethods()` | methods | One function per Method. It returns the Method's value on success and `null` on failure. It never returns a result object and does not throw for a refused call. |
| `emit` | events | One function per Event. Prefer letting Methods emit. |
| `useStateDiagnostics()`, `usePropertyDiagnostics()`, `useMethodDiagnostics()` | the capability | One read-only ref of diagnostics per member. |
| `useDiagnostics()` | always | One read-only ref of the widget's own diagnostics. |
| `WidgetSlot` | slots | The component that renders a slot's children. |
| `widgetId`, `widgetType` | always | The identity of the widget being rendered: plain values, not refs. |

- The keyed surfaces (`useState()`, `useProperties()`, `useMethods()`, `emit`, the diagnostics surfaces) are frozen
  objects with exactly the declared members. Destructure them (`const { count } = useState()`); `toRefs()` is not
  supported. Nothing reads or subscribes the Runtime until the first `.value` read or call.
- There is no `runtime`, `system` or `getWidget` on the surface. A widget reaches another widget only through the
  plugin's dependencies (`registerDeps`), never through renderer code.

## Rules

- Handle `null`: every State and Property ref may be `null`, and so may every Method call's return value.
- To learn why a Method call failed, read `useMethodDiagnostics().<method>.value` after the call: each diagnostic has a
  `code` (`invalid-method-arguments`, `invalid-method-result`), a `message` and, when the plugin gave one, a `reason`
  and its `details`. When the plugin declares `reasons`, the diagnostics of its State, Properties and Methods are a
  union discriminated by `reason`, so checking `diagnostic.reason === '...'` narrows `details`. A `null` return is the
  only signal on the call itself, so a Method whose successful value could be `null` must be told apart through its
  diagnostics.
- A failed Method call is not rolled back: State it wrote and Events it emitted before failing stay. Render from State
  and Properties after the call rather than assuming nothing changed.
- A renderer displays State and Properties and calls Methods. It does not keep a second copy of widget state.
- `authorWritable` State is meant to be set by an author or editor; other State is changed through Methods.
- Methods are synchronous. Async work belongs to the host: listen to the Event, wait, then call a Method.
- The adapter stamps no DOM attribute. A renderer may put `widgetId` and `widgetType` on its own root element (for
  inspection, `inspectAnchorAttributes` from `@deviltea/widget-inspector/anchor` gives the attributes).

## Slots and `WidgetSlot`

`<WidgetSlot name="slotName" />` renders the slot's children in Blueprint order. Its `name` is typed to the slot
names. With a default scoped slot it calls the slot once per child with `{ Child, id, type, index }`, so the renderer
can wrap, decorate or skip each child:

```vue
<WidgetSlot name="labels">
	<template #default="{ Child, id, type, index }">
		<li :data-widget="id" :data-type="type" :data-index="index">
			<Child />
		</li>
	</template>
</WidgetSlot>
```

- `Child` renders that child through its own registered renderer and takes no props. It is the same component for a
  given child on every render, so re-rendering a stable wrapper never remounts the child.
- `index` is the child's position in the slot and counts the children the renderer skips. Render nothing to skip a
  child. An empty slot never calls the slot.
- `type` is narrowed to what the slot expects: the members of a plain union of plugin types, a `WidgetContract`'s
  `Types`, or `string` for a slot that takes any widget. In a template, `vue-tsc` infers it from `name`. In a render
  function, `h(WidgetSlot, { name }, …)` checks `name` but not the slot function, so a scope annotation such as
  `WidgetSlotScope<'Label'>` is an unchecked assertion.
- The expectation is not checked at run time: a child of another type is possible when the plugin does not refuse it
  in its structure validators.

## Testing a renderer

`createWidgetTestHost(runtime, widgetId, component, renderers?)` from `@deviltea/widget-vue/testing` returns a
component that renders `component` as the renderer of widget `widgetId`, with the same `useWidget()` context as under
the root renderer. The optional `renderers` map (by plugin type) decides how the widgets inside its slots render; an
unmapped type renders as nothing. It never disposes the Runtime.

<!-- sample: vue-renderer-testing after -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { useWidget } from '@deviltea/widget-vue'
import { createWidgetTestHost } from '@deviltea/widget-vue/testing'
import { createApp, defineComponent, h } from 'vue'

const Greeting = createWidgetPlugin('Greeting')
	.description('Says hello.')
	.interfaces<{ state: { name: string } }>()
	.state(state => state.name({
		description: 'Who is greeted.',
		validate: (input): input is string => typeof input === 'string',
		default: () => 'world',
	}))
	.done()

const GreetingRenderer = defineComponent({
	setup() {
		const { name } = useWidget(Greeting)
			.useState()
		return () => h('p', `Hello, ${name.value ?? ''}!`)
	},
})

const blueprint = createWidgetSystem({ plugins: [Greeting] as const })
	.createBlueprint({ id: 'greeting', type: 'Greeting' })
if (blueprint.status !== 'valid')
	throw new Error('invalid document')
const runtime = blueprint.createRuntime()

const element = document.createElement('div')
const app = createApp(createWidgetTestHost(runtime, 'greeting', GreetingRenderer))
app.mount(element)
// element.textContent is now 'Hello, world!'
app.unmount()
runtime.dispose()
```

## Integration errors

Misuse throws `WidgetVueIntegrationError`. Tell the cases apart by `code`, never by `message`:

| `code` | When |
| --- | --- |
| `invalid-renderer-registry` | The registry does not cover the System exactly once, or a registered value is not a component. `missingTypes`, `unknownTypes`, `duplicateTypes` and `invalidTypes` list the defects (`null` for every other code). |
| `invalid-runtime` | The `runtime` prop is not an object. |
| `foreign-runtime` | The Runtime comes from another copy of `@deviltea/widget-core`: make the application load one copy. |
| `runtime-system-mismatch` | The Runtime was not created from the bound System. |
| `unknown-widget` | `createWidgetTestHost()` was given an id the Runtime does not contain. |
| `outside-widget-renderer` | `useWidget()` or `WidgetSlot` is used outside a registered renderer, or after an `await` in `async setup()`. |
| `widget-plugin-mismatch` | `useWidget(Plugin)` was given another plugin than the rendered widget's. |
| `readonly-projection-write` | A Property or diagnostics ref was written. |
