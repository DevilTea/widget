# @deviltea/widget-core

Cross-cutting Diagnostic/Result/Failure/Error conventions are maintained in
[Widget API conventions](https://github.com/DevilTea/widget/blob/main/docs/architecture/widget-api-conventions.md).

> **Upgrading from 0.0.x?** Follow the [migration guide to 0.1](https://deviltea.github.io/widget/migration/0.1).

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

Requires Node.js `>=22.14.0` (or any ES2022 runtime with a global
`queueMicrotask`).

While the package is `0.x`, a breaking change bumps the **minor** version
(`0.N.0`), so use a `^0.N.0` range. Core recognizes its own plugins, Blueprints
and Runtimes by brands private to one loaded copy of the module, so an
application must load exactly one copy. A library that ships plugins or a
renderer adapter must declare `@deviltea/widget-core` as a **peer dependency**
(not a regular dependency) and must not bundle it; `@deviltea/widget-vue` and
`@deviltea/widget-inspector` do the same.

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
[Design constraints](https://deviltea.github.io/widget/packages/widget-core#design-constraints)
in the full guide for the exact boundary.

Capability presence (`config`/`slots`/`state`/`properties`/`methods`/`events`)
is declaration presence, independent of whether a capability's own domain is
empty — a completed plugin exposes these facts at runtime as
`plugin.capabilities: { config, slots, state, properties, methods, events }`
(all `boolean`, immutable). See
[Reading capability presence at runtime](https://deviltea.github.io/widget/packages/widget-core#reading-capability-presence-at-runtime-plugin-capabilities)
in the full guide.

The phase order of `createWidgetPlugin` is
`description → interfaces → config? → slots? → structure? → state? → properties? → methods? → events? → done`.
`.structure(validateStructure)` is an optional plugin-level structure validator
available to every plugin (it is not a capability); `.slots(definitions)` takes
only the slot definitions. Declarations are validated when the plugin is built,
so a malformed member throws a `TypeError` naming the plugin, section, member
and field.

`createWidgetSystem` rejects invalid options and plugin registration with the
coded `WidgetSystemConfigurationError`: `invalid-options` (options not an
object, `plugins` not an array, or a non-function `validateStructure`),
`foreign-plugin` (entry not created by this loaded module instance; fields
`pluginIndex`, `pluginType`, with `firstPluginIndex` always `null`) and
`duplicate-plugin-type` (fields `pluginIndex`, `pluginType`,
`firstPluginIndex`). The System exposes `plugins`, `catalog`, `validateStructure`
and `getPlugin(type)`, which returns `null` for an unregistered type.
Inspection entries throw `WidgetInspectionError` (`@deviltea/widget-core/inspection`)
and `getWidgetEventEmitter` throws `WidgetIntegrationError`
(`@deviltea/widget-core/integration`, code `foreign-runtime`) for foreign inputs;
`assertCoreRuntime(runtime)` from the same subpath performs only that passive
provenance check, so a renderer adapter can fail fast at mount when it and the
application loaded two copies of Core.
See
[Plugin registration errors](https://deviltea.github.io/widget/packages/widget-core#plugin-registration-errors)
in the full guide.

A plugin with a config capability always runs `config.validate`. An omitted
raw `config` is validated as `null`, so required-ness comes from the raw config
type: declare `raw: Config | null` (and accept `null` in the validator) when
config may be omitted, or `raw: Config` to require it. A rejected config yields
`invalid-widget-config` and resolves through `resolve(null)`. See
[Config](https://deviltea.github.io/widget/packages/widget-core#config) in the
full guide.

Plugin, config, and slot descriptions are required intrinsic metadata. The
immutable `system.catalog` is a passive projection of registered widget types,
descriptions, and capability descriptions; it does not contain Blueprint or
Runtime state.

## Usage

Here is a complete widget: one plugin with `state`, `properties`, and
`methods`, registered into a system, compiled, and run. The
[full guide](https://deviltea.github.io/widget/packages/widget-core#quick-start)
has a larger end-to-end example with config, slots, an Event, and a container
that aggregates its children.

<!-- sample: usage run -->
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
produces an inspectable Blueprint. `createBlueprintFromJson(text)` is equivalent
to `createBlueprint(JSON.parse(text))`, including its diagnostics (an
overflowing literal such as `1e400` is still diagnosed as
`json-incompatible-value`); it only replaces the full JSON-domain inspection
with a cheaper scan, because Core parsed the value itself. Every diagnostic has
top-level `code`, `location`, and `message` fields. Variant-specific facts are
direct fields; structured `path` and `related` fields are not hidden behind a
`source` object. Codes are stable lowercase kebab-case values such as
`invalid-widget-id`, `duplicate-widget-id`, `unexpected-widget-field`,
`invalid-widget-config`, `invalid-widget-structure`, and
`missing-dependency-target`. Whole-source JSON inspection adds aggregate-only
`json-incompatible-value` diagnostics with a source-rooted `path` and closed
`reason`, while `source-access-failed` means Core could not safely complete the
inspection. These source-level facts do not appear in a node's `.diagnostics`.
The full code tables are in the
[guide](https://deviltea.github.io/widget/packages/widget-core#diagnostics).

A widget node has exactly the own keys `id`, `type`, `config`, `slots` and
`meta`. Any other key is reported as `unexpected-widget-field` and makes the
Blueprint invalid; `meta` is the reserved extension key (any JSON value,
preserved and never interpreted). An `id` is any string, including `''`.
Authored source may nest at most `MAX_JSON_DEPTH` (256) containers deep.
`blueprint.getSourcePath(node)` returns the structured `SourcePath` of a node
inside `blueprint.source`, usable directly as a `SourcePatch` path — also for the
node recovery stops at for depth, whose path has at most `MAX_JSON_DEPTH + 2`
segments, the longest path a `SourcePatch` accepts.

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

<!-- sample: document-patch run -->
```typescript
import { createWidgetDocument, createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

interface CounterInterfaces {
	config: {
		raw: { step: number }
		resolved: { step: number }
	}
}

const counterPlugin = createWidgetPlugin('counter')
	.description('A counter widget')
	.interfaces<CounterInterfaces>()
	.config({
		description: 'Counter configuration',
		validate: (input): input is { step: number } =>
			typeof input === 'object' && input !== null && typeof (input as { step?: unknown }).step === 'number',
		resolve: rawConfig => ({ step: rawConfig?.step ?? 1 }),
	})
	.done()

const system = createWidgetSystem({ plugins: [counterPlugin] })

const document = createWidgetDocument({
	system,
	source: { id: 'counter-1', type: 'counter', config: { step: 1 } },
})

const unsubscribe = document.subscribe((snapshot, { previous, patch }) => {
	console.log(`revision ${previous.revision} -> ${snapshot.revision}`, patch)
})

// Success: `/config/step` exists, so the replace commits revision 1.
const result = document.applyPatch([
	{ op: 'replace', path: '/config/step', value: 2 },
], { expectedRevision: 0 })

if (result.ok && result.changed)
	console.log(document.getSnapshot().revision) // 1

// Failure: a path that does not exist, a stale revision, and a malformed operation.
const missing = document.applyPatch([{ op: 'replace', path: '/config/missing', value: 1 }])
if (!missing.ok)
	console.log(missing.failure.code) // path-not-found

const stale = document.applyPatch([{ op: 'replace', path: '/config/step', value: 3 }], { expectedRevision: 0 })
if (!stale.ok && stale.failure.code === 'document-revision-conflict')
	console.log(stale.failure.expectedRevision, stale.failure.actualRevision) // 0 1

const malformed = document.applyPatch([{ op: 'frobnicate', path: '/config' }] as never)
if (!malformed.ok)
	console.log(malformed.failure.code) // invalid-operation

console.log(document.getSnapshot().revision) // 1: a failed patch changes nothing
unsubscribe()
```

A patch is an array of `{ op: 'add' | 'replace' | 'test', path, value }`,
`{ op: 'remove', path }` and `{ op: 'move' | 'copy', from, path }` operations
(`SourcePatchOperation`).

Authored source is handed to Core **by reference**: `createBlueprint`,
`recompile` and `createWidgetDocument` keep `source` as given, so
`blueprint.source` is the exact input and Core never clones or freezes it.
Passing source transfers ownership; do not mutate it afterwards (behavior is
unspecified), and pass a copy such as `structuredClone` if you keep editing
your own object. "Immutable" Blueprint describes Core's API, not a defensive
copy. `applyPatch` never mutates the accepted source, but copy-on-write
revisions share untouched subtrees with the previous revision and so with the
original input. See the
[Core model](https://deviltea.github.io/widget/packages/widget-core#core-model)
ownership rules.

`applyPatch(patch, options?)` returns `{ ok: true, changed }` or
`{ ok: false, failure }`. A patch that leaves the source structurally equal
returns `{ ok: true, changed: false }`: the revision does not advance and
subscribers are not notified. A changing patch compiles the next Blueprint once
after all operations succeed, commits it at `revision + 1`, then notifies
subscribers. `failure.code` is one of:

- `reentrant-apply`: `applyPatch()` was called while the Document was applying
  or notifying (for example from a subscriber). It is checked first.
- `document-revision-conflict`: `options.expectedRevision` was supplied and
  differs from the current revision. The failure carries `expectedRevision` and
  `actualRevision`. Omitting `options` skips this check, and the check runs
  before any operation is evaluated.
- An operation failure `{ code, operationIndex, message }`, where `code` is
  `invalid-operation`, `invalid-path`, `max-depth-exceeded`, `path-not-found`,
  `path-not-traversable`, `invalid-array-index`, `invalid-move-target`,
  `test-failed`, `json-incompatible-value`, or `source-access-failed`, and
  `operationIndex` is the failing operation's position in the patch. A failed
  patch leaves the committed source and revision unchanged.

  | `code` | Meaning |
  | --- | --- |
  | `invalid-operation` | the patch is not an array, an operation is not an object, or its `op` is unknown |
  | `invalid-path` | a malformed path only |
  | `max-depth-exceeded` | a path longer than `MAX_JSON_DEPTH + 2` segments (the longest source path of a node a Blueprint materializes), or a `copy`/`move` source nested deeper than `MAX_JSON_DEPTH` |
  | `path-not-found` | the path does not identify an existing location |
  | `path-not-traversable` | the path passes through a non-traversable value |
  | `invalid-array-index` | an Array parent was addressed by anything other than an in-bounds canonical index (see below) |
  | `invalid-move-target` | a `move` into its own descendant |
  | `test-failed` | a `test` operand did not match the addressed value |
  | `json-incompatible-value` | an `add`/`replace`/`test` `value` is outside Core's JSON domain (missing or `undefined`, functions, `bigint`, symbols, `NaN`/`±Infinity`, cycles, non-plain prototypes, sparse or extra-property Arrays, accessors, symbol keys, nesting deeper than `MAX_JSON_DEPTH`, or reflection that throws); checked after path parsing and before the operation is evaluated. The failure carries an optional operand-relative `path` and a `reason` |
  | `source-access-failed` | unsafe access to the *source* material only |

Three edge semantics apply to every operation:

- **Arrays have only index members.** After path normalization, any segment on
  an Array parent that is not a canonical index (`'length'`, `'foo'`, `'01'`, or a
  structured `'-'`) fails `invalid-array-index`, at every position (traversal,
  target, and `from`) and in both path forms. Append remains JSON-Pointer-only
  (`/items/-`); a structured `'-'` never appends and is an ordinary key on
  objects. Non-index properties already present on a recovery Array are repaired
  by replacing that Array or an ancestor.
- **Numbers compare by SameValueZero.** `test` and no-op detection treat `0` and
  `-0` as equal, so replacing `0` with `-0` (or the reverse) returns
  `{ ok: true, changed: false }` and the source keeps its original value.
  Explicit `add`/`replace` operands are copied with `-0` written as `+0` at
  every depth; `copy`/`move` relocate existing material unchanged.
- **Operands must be JSON values.** A non-JSON operand fails with
  `json-incompatible-value`, not `source-access-failed`.

`document.subscribe(listener)` registers `listener` and returns an idempotent
unsubscribe function. The listener is not called on subscription; after each
committed (`changed: true`) patch it receives `(snapshot, { previous, patch })`,
in subscription order, over the subscriber list as it stood when notification
began. No-op detection is JSON-domain equality. An
exception thrown by a listener does not fail `applyPatch()` or stop the
remaining listeners, and it is reported outside `applyPatch()`; the reporting
mechanism is not part of the contract.

### SeparatedWidgetSource tooling

`WidgetSource` is the only canonical nested authored representation. The explicit
`SeparatedWidgetSource` projection contains a nested structural tree and a flat
`widgets` data list; it is useful for authoring tools and normalization, but it
is not another `createBlueprint` or `WidgetDocument` input mode.

<!-- sample: separated-source run -->
```typescript
import { normalizeSeparatedWidgetSource, separateWidgetSource } from '@deviltea/widget-core'

const canonical = {
	id: 'panel-1',
	type: 'panel',
	meta: { note: 'kept' },
	slots: { content: [{ id: 'counter-1', type: 'counter', config: { step: 2 } }] },
}

// `separateWidgetSource(source: unknown)` never throws: it returns `{ separated, diagnostics }`.
// `separated` is null only when the root cannot be projected; an empty `diagnostics` guarantees
// a lossless round trip through `normalizeSeparatedWidgetSource`.
const { separated, diagnostics } = separateWidgetSource(canonical)
console.log(diagnostics.length) // 0: nothing was lost

if (separated !== null) {
	const normalized = normalizeSeparatedWidgetSource(separated)
	console.log(normalized.diagnostics.length) // 0, representation diagnostics (separate from Blueprint diagnostics)
	console.log(JSON.stringify(normalized.source) === JSON.stringify(canonical)) // true: best-effort nested source
}
```

Normalization is deterministic and non-destructive: the first flat data entry
for an ID wins, missing data produces a partial nested node, unused data is not
guessed into the tree, and repeated structural IDs are diagnosed while the
later occurrence is de-identified with its available subtree preserved.

### Runtime semantics

- Declared `events` are public notifications: subscribe through
  `widget.events[name].subscribe(listener)`. Delivery is synchronous and
  depth-first for nested emits; a throwing public listener is isolated like every
  other listener (the remaining listeners and the emitting Method still run, and
  the error is reported asynchronously). A runaway loop (a listener that keeps
  re-invoking the emitting Method) is cut off once one Runtime's emits nest more
  than 128 deep: `WidgetSystemRuntimeReentrancyError` (a `RangeError`, code
  `emit-depth-exceeded`) unwinds to the call that started the loop. Events are
  host-facing and cannot be dependency targets. Emit authority belongs
  to Method `execute` (`emit`) and, for renderers, `@deviltea/widget-core/integration`.
  See [Events](https://deviltea.github.io/widget/packages/widget-core#events).
- `widget.state[key].get()` returns `T | null` directly — it is not an
  `ExecutionResult`.
- `widget.properties[name].get()` / `.subscribe(listener)` and
  `widget.methods[name](...)` all return an `ExecutionResult<T, D>` (`D` is the member's diagnostic union)
  with `T` exactly as declared (never `T | null`):
  `{ ok: true, value }` or `{ ok: false, failure: { diagnostics: [...] } }`.
  A `void` Method returns `{ ok: true, value: undefined }`.
- State values are immutable by contract: change detection is identity-based, so
  mutating a value in place and setting the same reference notifies nobody.
  Always `set()` a new value.
- A throwing Property `compute` never makes a writer (`state.set`, a Method call,
  `resetState()`) throw and never suppresses other subscribers; it is reported
  asynchronously, while `get()` and dependency reads still rethrow. The exception
  stays cached until a dependency changes — except a stack overflow (a first
  read of a chain of on the order of a thousand Properties), which the next read
  evaluates again, so a long chain can be warmed bottom-up.
- `runtime.snapshotState()` returns the current State as a plain
  `Record<WidgetId, Record<string, unknown>>` (`null` members omitted) that is
  directly usable as `overrideStateDefaults`; `widget.resetState()` resets one
  widget. See
  [Reusing a Runtime](https://deviltea.github.io/widget/packages/widget-core#reusing-a-runtime-resetstate).
- `deps.*` and `emit` callables are valid only while their own callback is the
  innermost running callback. A retained callable, a timer or promise
  continuation, a nested callback, or a listener or `validate`-style callback
  running inside the Method gets a `TypeError` (and
  `WidgetSystemRuntimeDisposedError` after dispose). A Property can never write
  State. Core is synchronous by design; see
  [Async work](https://deviltea.github.io/widget/packages/widget-core#async-work)
  for the host recipe.
- Properties are lazily evaluated and cached through `alien-signals`; a
  subscription has no immediate emission and notifies once per actual
  completed recompute.
- Every `RuntimeMethod` invocation batches its dependency/state writes; the
  batch flushes once the method returns, so partial writes from nested method
  calls are not observed mid-flight by outside subscribers.
- A failed dependency call adds a consumer-local `dependency-target-failed` /
  `dependency-value-rejected` diagnostic to the calling Property or Method's
  active diagnostic collector. Computing a fallback value after the failure
  does not make the operation succeed: the result is still `ok: false`. See
  [Dependency failures fail the consumer](https://deviltea.github.io/widget/packages/widget-core#dependency-failures-fail-the-consumer).
- `runtime.resetState()` restores every State member to its initialization
  outcome (value and diagnostic snapshot) in one batch without re-running
  `validate`, so one Runtime can evaluate many independent inputs. See
  [Reusing a Runtime](https://deviltea.github.io/widget/packages/widget-core#reusing-a-runtime-resetstate).
- A callback's `addDiagnostic` / `hasAnyDiagnostic` throw a `TypeError` when
  called after that callback returned.
- Every state write, property evaluation, and method invocation keeps the
  **latest completed** diagnostic snapshot only (`getDiagnostics()` /
  `subscribeDiagnostics()`), never a history.
- Every `RuntimeWidget` also exposes an aggregate `getDiagnostics()` /
  `subscribeDiagnostics()`: the union of only that widget's own primitive-owned
  diagnostics (state members -> property members -> method members, declaration
  order within each capability, each primitive's own local diagnostic order),
  never Runtime-level diagnostics even when a diagnostic mentions the same
  `widgetId`. `runtime.getDiagnostics()` is the aggregate over the whole Runtime:
  Runtime-boundary diagnostics first, followed by each
  `RuntimeWidget.getDiagnostics()` in Blueprint semantic widget order;
  `subscribeDiagnostics()` observes that same aggregate, and none of these
  reads/subscriptions activate Property evaluation. Because Properties are lazy,
  the aggregate only contains diagnostics of Properties that have been
  evaluated, and `resetState()` does not clear retained Property or Method
  diagnostics. To validate a Runtime headlessly, read every Property you rely on
  before reading the aggregate (a runnable recipe is in
  [Runtime diagnostics](https://deviltea.github.io/widget/packages/widget-core#runtime-diagnostics)).
- `runtime.dispose()` is idempotent. After disposal, `runtime.isDisposed` and
  `runtime.blueprint` stay readable, but every live query/operation
  (including `snapshotState()`, `resetState()` and
  `RuntimeWidget.getDiagnostics()`) and every new subscription
  (including `RuntimeWidget.subscribeDiagnostics()`) throws
  `WidgetSystemRuntimeDisposedError`; unsubscribe functions obtained before
  disposal remain safe idempotent no-ops.

### Inspection

A dedicated, strictly readonly subpath is a supported observation surface for
any host (DevTools, prototype players, test harnesses). It exposes
compiler/runtime facts, including passive Event occurrence observation through
`getEvent(name).subscribe(...)`, and never mutates state, invokes methods, or
forces Property evaluation. `inspectPlugin(plugin)` is a superset of the
plugin's `system.catalog` entry (type, description, capabilities, config
metadata, slots, and the State/Property/Event member facts):

```typescript
import { inspectBlueprint, inspectPlugin, inspectRuntime } from '@deviltea/widget-core/inspection'
```

`@deviltea/widget-core`'s root entrypoint does not export this surface. See
[Inspection](https://deviltea.github.io/widget/packages/widget-core#inspection)
in the full guide for the exact contract, including the Event inspection
delivery guarantees.

### Host requirements

The current implementation needs an ES2022 engine and a global
`queueMicrotask` whose jobs the host actually runs: a throwing State, Property,
diagnostic, Event, inspection or `WidgetDocument` listener, and a Property
`compute` that throws during a subscription's re-evaluation, is isolated and
rethrown in a microtask. Embedded engines such as QuickJS (`rquickjs`) must
drain their pending jobs, or those errors never surface. See
[Host requirements](https://deviltea.github.io/widget/packages/widget-core#host-requirements).

The full guide at
[docs/site/packages/widget-core.md](https://deviltea.github.io/widget/packages/widget-core)
covers the dependency grammar, the compile pipeline, every Runtime primitive,
the complete diagnostic and error tables, and guides for async work, persisted
documents, generic plugin factories and renderer adapters.

## License

[MIT](https://github.com/DevilTea/widget/blob/main/LICENSE) License © 2023-PRESENT [DevilTea](https://github.com/DevilTea)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@deviltea/widget-core?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/@deviltea/widget-core
[npm-downloads-src]: https://img.shields.io/npm/dm/@deviltea/widget-core?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/@deviltea/widget-core
[bundle-src]: https://img.shields.io/bundlephobia/minzip/@deviltea/widget-core?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=@deviltea/widget-core
[license-src]: https://img.shields.io/github/license/DevilTea/widget.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/DevilTea/widget/blob/main/LICENSE
