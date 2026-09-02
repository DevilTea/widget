# @deviltea/widget-core

Cross-cutting Diagnostic/Result/Failure/Error conventions are maintained in
[Widget API conventions](../../../docs/architecture/widget-api-conventions.md).

> ESM-only package.

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![License][license-src]][license-href]

A renderer-agnostic widget composition core: declare `WidgetPlugin`s with a
capability-phase builder, register them into a `WidgetSystem`, compile an
unknown/raw widget tree into a diagnosable `WidgetSystemBlueprint`, and run a
valid Blueprint as an `alien-signals`-backed `WidgetSystemRuntime`.

## Installation

To install the package, use either `npm`, `yarn`, or `pnpm`:

```bash
npm install @deviltea/widget-core
```

```bash
yarn add @deviltea/widget-core
```

```bash
pnpm add @deviltea/widget-core
```

## Core model

```text
WidgetPlugin              plugin semantic contract, built with createWidgetPlugin()
WidgetSystem               immutable registered plugin universe
WidgetSystemBlueprint      immutable compiled semantic snapshot of one source tree, valid | invalid
WidgetDocument             revisioned source + Blueprint coordinator with atomic SourcePatch commits
WidgetSystemRuntime        executable instance of a valid Blueprint
```

```text
createWidgetPlugin(type) -> builder -> WidgetPlugin
createWidgetSystem({ plugins }) -> WidgetSystem
system.createBlueprint(source: unknown) -> WidgetSystemBlueprint
blueprint.createRuntime() -> WidgetSystemRuntime   // only when blueprint.status === 'valid'
```

A renderer/integration layer consumes the Runtime; the core itself knows
nothing about rendering, persistence versioning, or metadata. Source editing
is limited to the revisioned `WidgetDocument` and JSON-domain `SourcePatch`
contract described below. See
[Design constraints](https://deviltea.github.io/deviltea-labs/packages/widget-core#design-constraints)
in the full guide for the exact boundary.

Capability presence (`config`/`slots`/`state`/`properties`/`methods`) is
declaration presence, independent of whether a capability's own domain is
empty — a completed plugin exposes these facts at runtime as
`plugin.capabilities: { config, slots, state, properties, methods }`
(all `boolean`, immutable). See
[Reading capability presence at runtime](https://deviltea.github.io/deviltea-labs/packages/widget-core#reading-capability-presence-at-runtime-plugin-capabilities)
in the full guide.

Plugin, config, and slot descriptions are required intrinsic metadata. The
immutable `system.catalog` is a passive projection of registered widget types,
descriptions, and capability descriptions; it does not contain Blueprint or
Runtime state.

## Usage

Here is a complete widget: one plugin with `state`, `properties`, and
`methods`, registered into a system, compiled, and run.

```typescript
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

// 1. Declare the plugin's capabilities.
interface CounterInterfaces {
	state: {
		count: number
	}
	properties: {
		doubled: number
	}
	methods: {
		increment: (step: number) => number
		reset: () => void
	}
}

// 2. Build the plugin through the capability-phase builder.
const counterPlugin = createWidgetPlugin('counter')
	.description('A counter widget')
	.interfaces<CounterInterfaces>()
	.state(state =>
		state.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}),
	)
	.properties(properties =>
		properties.doubled({
			registerDeps: ({ dep }) => ({
				count: dep.self.state.get('count'),
			}),
			compute: ({ deps }) => {
				const count = deps.count()
				return (count.ok ? count.value ?? 0 : 0) * 2
			},
		}),
	)
	.methods(methods =>
		methods
			.increment({
				validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
				registerDeps: ({ dep }) => ({
					count: dep.self.state.get('count'),
					setCount: dep.self.state.set('count'),
				}),
				execute: ({ args: [step], deps }) => {
					const current = deps.count()
					const value = (current.ok ? current.value ?? 0 : 0) + step
					deps.setCount(value)
					return value
				},
			})
			.reset({
				validateArgs: (args): args is [] => args.length === 0,
				registerDeps: ({ dep }) => ({
					setCount: dep.self.state.set('count'),
				}),
				execute: ({ deps }) => {
					deps.setCount(0)
				},
			}),
	)
	.done()

// 3. Register plugins into an immutable system.
const system = createWidgetSystem({
	plugins: [counterPlugin],
})

// 4. Compile an unknown/raw widget tree into a Blueprint.
const blueprint = system.createBlueprint({
	id: 'counter-1',
	type: 'counter',
})

// 5. Only a `valid` Blueprint can create a Runtime.
if (blueprint.status !== 'valid')
	throw new Error('invalid widget definition')

const runtime = blueprint.createRuntime()
const widget = runtime.getWidget('counter-1')
if (widget === null)
	throw new Error('widget not found')

// 6. Operate/subscribe through the Runtime primitives.
const unsubscribe = widget.properties.doubled.subscribe((result) => {
	console.log('doubled changed ->', result) // { ok: true, value: ... }
})

widget.methods.increment(5) // -> { ok: true, value: 5 }
widget.state.count.get() // -> 5
widget.properties.doubled.get() // -> { ok: true, value: 10 }

widget.methods.reset()
widget.state.count.get() // -> 0

unsubscribe()
runtime.dispose()
```

### Blueprint diagnostics

`createBlueprint` accepts `unknown`; malformed input never throws — it always
produces an inspectable Blueprint. Every diagnostic has top-level `code`,
`location`, and `message` fields. Variant-specific facts are direct fields;
structured `path` and `related` fields are not hidden behind a `source` object.
Codes are stable lowercase kebab-case values such as
`invalid-widget-id`, `invalid-widget-config`, `invalid-widget-structure`, and
`missing-dependency-target`. Whole-source JSON inspection adds aggregate-only
`json-incompatible-value` diagnostics with a source-rooted `path` and closed
`reason`, while `source-access-failed` means Core could not safely complete the
inspection. These source-level facts do not appear in a node's `.diagnostics`.

Recovery is best-effort: even invalid input still yields a navigable root and
node tree via `blueprint.getWidget` / `getParent` / `getChildren` /
`.diagnostics`. Editing means recompiling a new source, not mutating
the Blueprint:

```typescript
const nextBlueprint = blueprint.recompile(nextSource)
```

Only `blueprint.status === 'valid'` narrows to a Blueprint exposing
`createRuntime`; an `'invalid'` Blueprint remains inspectable but cannot
create a Runtime.

`sourceJsonCompatible` is the proof for the authored JSON domain. When it is
`true`, `blueprint.source` and source fragments on recovered navigation nodes
are `JsonValue`; when it is `false`, the source remains `unknown`. The false
branch covers either confirmed JSON-domain incompatibility or an unproven safe
inspection; `blueprint.diagnostics` distinguishes those causes. A valid
Blueprint requires both semantic validity and this proof, so Runtime creation
never promotes non-JSON authored material.

### WidgetDocument and SourcePatch

`createWidgetDocument({ system, source })` keeps the current source and its
compiled Blueprint together behind a monotonically increasing revision. A
`SourcePatch` is one JSON-domain RFC6901/RFC6902 patch language: paths may be
JSON Pointer strings or structured string/number segments, operands are
`JsonValue`, and successful patches are applied copy-on-write. Mechanical
failure is atomic; a successful patch may still commit a semantically invalid
Blueprint for inspection.

```typescript
import { createWidgetDocument } from '@deviltea/widget-core'

const document = createWidgetDocument({
	system,
	source: { id: 'counter-1', type: 'counter' },
})

const result = document.applyPatch([
	{ op: 'replace', path: '/config/step', value: 2 },
], { expectedRevision: 0 })

if (result.ok && result.changed)
	console.log(document.getSnapshot().revision) // 1
```

### SeparatedWidgetSource tooling

`WidgetSource` is the only canonical nested authored representation. The explicit
`SeparatedWidgetSource` projection contains a nested structural tree and a flat
`widgets` data list; it is useful for authoring tools and normalization, but it
is not another `createBlueprint` or `WidgetDocument` input mode.

```typescript
import {
	normalizeSeparatedWidgetSource,
	separateWidgetSource,
} from '@deviltea/widget-core'

const separated = separateWidgetSource(canonicalSource)
const normalized = normalizeSeparatedWidgetSource(separated)

normalized.source // best-effort nested source, still unknown for recovery
normalized.diagnostics // representation diagnostics, separate from Blueprint diagnostics
```

Normalization is deterministic and non-destructive: the first flat data entry
for an ID wins, missing data produces a partial nested node, unused data is not
guessed into the tree, and repeated structural IDs are diagnosed while the
later occurrence is de-identified with its available subtree preserved.

### Runtime semantics

- `widget.state[key].get()` returns `T | null` directly — it is not an
  `ExecutionResult`.
- `widget.properties[name].get()` / `.subscribe(listener)` and
  `widget.methods[name](...)` all return an `ExecutionResult<T, Diagnostic>`:
	  `{ ok: true, value }` or `{ ok: false, failure: { diagnostics: [...] } }`.
- Properties are lazily evaluated and cached through `alien-signals`; a
  subscription has no immediate emission and notifies once per actual
  completed recompute.
- Every `RuntimeMethod` invocation batches its dependency/state writes; the
  batch flushes once the method returns, so partial writes from nested method
  calls are not observed mid-flight by outside subscribers.
- Every state write, property evaluation, and method invocation keeps the
  **latest completed** diagnostic snapshot only (`getDiagnostics()` /
  `subscribeDiagnostics()`), never a history.
- Every `RuntimeWidget` also exposes an aggregate `getDiagnostics()` /
  `subscribeDiagnostics()`: the union of only that widget's own primitive-owned
  diagnostics (state members -> property members -> method members, declaration
  order within each capability, each primitive's own local diagnostic order),
	  never Runtime-level diagnostics even when a diagnostic mentions the same
	  `widgetId`. `runtime.getDiagnostics()` is the complete aggregate: Runtime-
	  boundary diagnostics first, followed by each `RuntimeWidget.getDiagnostics()`
	  in Blueprint semantic widget order; `subscribeDiagnostics()` observes that same
  aggregate, and none of these reads/subscriptions activate Property
  evaluation.
- `runtime.dispose()` is idempotent. After disposal, `runtime.isDisposed` and
  `runtime.blueprint` stay readable, but every live query/operation
  (including `RuntimeWidget.getDiagnostics()`) and every new subscription
  (including `RuntimeWidget.subscribeDiagnostics()`) throws
  `WidgetSystemRuntimeDisposedError`; unsubscribe functions obtained before
  disposal remain safe idempotent no-ops.

### Inspection (DevTools)

A dedicated, strictly readonly subpath exposes compiler/runtime facts for
building inspectors — it never mutates state, invokes methods, or forces
Property evaluation:

```typescript
import { inspectBlueprint, inspectRuntime } from '@deviltea/widget-core/inspection'
```

`@deviltea/widget-core`'s root entrypoint does not export this surface. See
[Inspection](https://deviltea.github.io/deviltea-labs/packages/widget-core#inspection-devtools)
in the full guide for the exact contract.

The full guide at
[docs/site/packages/widget-core.md](https://deviltea.github.io/deviltea-labs/packages/widget-core)
covers the dependency grammar, the compile pipeline, and every Runtime
primitive in detail.

## License

[MIT](https://github.com/DevilTea/deviltea-labs/blob/main/LICENSE) License © 2023-PRESENT [DevilTea](https://github.com/DevilTea)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@deviltea/widget-core?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/@deviltea/widget-core
[npm-downloads-src]: https://img.shields.io/npm/dm/@deviltea/widget-core?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/@deviltea/widget-core
[bundle-src]: https://img.shields.io/bundlephobia/minzip/@deviltea/widget-core?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=@deviltea/widget-core
[license-src]: https://img.shields.io/github/license/DevilTea/deviltea-labs.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/DevilTea/deviltea-labs/blob/main/LICENSE
