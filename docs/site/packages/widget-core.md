---
title: '@deviltea/widget-core'
---

# @deviltea/widget-core

`@deviltea/widget-core` is a renderer-agnostic widget composition core. It
defines four cooperating layers — `WidgetPlugin`, `WidgetSystem`,
`WidgetSystemBlueprint`, and `WidgetSystemRuntime` — and nothing else:
persistence versioning, editor operations, metadata, and rendering all live
outside the core.

This guide covers the full public surface. For installation and a minimal
end-to-end example, see the
[package README](https://github.com/DevilTea/deviltea-labs/tree/main/packages/widget/core#readme).

## Core model

```text
WidgetPlugin
    plugin semantic contract, built with createWidgetPlugin(type)

WidgetSystem
    instance-scoped, immutable registered plugin universe

WidgetSystemBlueprint
    immutable compiled semantic snapshot of one unknown/raw widget tree
    status: 'valid' | 'invalid'

WidgetSystemRuntime
    executable instance of a valid Blueprint
```

```text
createWidgetPlugin(type) -> builder chain -> WidgetPlugin
createWidgetSystem({ plugins, validateStructure? }) -> WidgetSystem
system.createBlueprint(rawDefinition: unknown) -> WidgetSystemBlueprint
blueprint.createRuntime(options?) -> WidgetSystemRuntime   // only when status === 'valid'
```

Ownership rules that shape everything below:

- `WidgetSystem` is instance-scoped and immutable; the registered plugin tuple
  defines that instance's TypeScript universe. There is no global/module
  augmentation, and a duplicate `plugin.type` is rejected at construction.
- A Blueprint is an immutable semantic snapshot. Editing a widget tree means
  compiling different source through `system.createBlueprint()` or
  `blueprint.recompile()`, never mutating a Blueprint in place.
- A Runtime can only be created from a Blueprint whose `status` is `'valid'`.
- Runtime state is never part of a persisted/raw widget definition.
- Runtime-changing interactions (reading another widget's state/property,
  invoking another widget's method) are only reachable through dependencies
  declared with `registerDeps`.
- Properties are transitively side-effect free: a property may read state,
  read other properties, and invoke methods, but only methods that are
  themselves transitively read-only.
- [`alien-signals`](https://github.com/stackblitz/alien-signals) owns
  dependency tracking, laziness, caching, invalidation, and batching. The
  core only defines the observable semantics layered on top of it.

## Defining a plugin

### Capability interfaces

A plugin's shape is declared once, as a `WidgetInterfaces`:

```ts
interface WidgetInterfaces {
	config?: { raw: Record<any, any>, resolved: Record<any, any> }
	slots?: string
	state?: Record<any, any>
	properties?: Record<any, any>
	methods?: Record<any, (...args: any[]) => any>
}
```

Every section is a capability:

- absent (the key is not declared) → that capability does not exist, and its
  builder phase is skipped entirely
- present → the builder requires that capability to be implemented completely

There is no `pluginConfig` / `globalConfig`. Plugin-specific integration
options are ordinary factory options captured by closure around
`createWidgetPlugin(...)`, not a framework-owned config layer.

### Builder phase order

```ts
createWidgetPlugin('counter')
	.interfaces<CounterInterfaces>()
	.config({ /* ... */ }) // only if `config` is declared
	.slots({ /* ... */ }) // only if `slots` is declared
	.state(state => state /* ... */) // only if `state` is declared
	.properties(properties => properties /* ... */) // only if `properties` is declared
	.methods(methods => methods /* ... */) // only if `methods` is declared
	.done()
```

Each phase only exists on the builder chain when its capability was declared,
so a plugin with no `slots` never exposes a `.slots()` step.

`state`, `properties`, and `methods` are **not** object-map sections. Each one
is a keyed-chain builder: every declared member key becomes a chainable
method on the section object, and calling it consumes that key. The section
callback can only return once every declared key has been called exactly
once — there is no `.define()`, `.add()`, or a framework-owned `.done()` for
these three sections specifically (only the outer builder has `.done()`).

```ts
createWidgetPlugin('example')
	.interfaces<ExampleInterfaces>()
	.state(state =>
		state
			.count({ /* ... */ })
			.enabled({ /* ... */ }),
	)
```

### Config

```ts
interface BadgeInterfaces {
	config: {
		raw: { label?: string }
		resolved: { label: string }
	}
}

createWidgetPlugin('badge')
	.interfaces<BadgeInterfaces>()
	.config({
		validate: (input): input is { label?: string } =>
			typeof input === 'object' && input !== null,
		resolve: rawConfig => ({ label: rawConfig?.label ?? 'Badge' }),
	})
	// ...
```

- `resolve` is required and has no Blueprint/topology access — it is pure
  normalization from raw to resolved config.
- Raw config presence is own-property based: an omitted raw `config` field
  resolves as `resolve(null)`.
- An explicitly present but invalid raw config produces a Blueprint `config`
  issue, the typed raw config becomes unavailable, and the semantic config
  still resolves through `resolve(null)` so the invalid Blueprint stays
  inspectable.
- `validate` is an authoritative predicate (`input is RawConfig`), not a
  coercion step.

### Slots

Unlike `state` / `properties` / `methods`, `slots` is supplied as one
complete object map — every declared slot key must be present:

```ts
interface ContainerInterfaces {
	slots: 'header' | 'content'
}

createWidgetPlugin('container')
	.interfaces<ContainerInterfaces>()
	.slots({
		header: {
			validateStructure: ({ children, addIssue }) => {
				if (children.length > 1)
					addIssue({ message: 'header accepts at most one widget', index: 1 })
			},
		},
		content: {},
	})
	// an optional second argument adds a plugin-level validateStructure
	// ...
```

- A resolved node's semantic `.slots` map always contains exactly the
  declared slots, each a complete (possibly empty) array — an omitted or
  malformed raw slot resolves to `[]`.
- Structural validation runs slot-level → plugin-level → system-level (see
  [Compiling a blueprint](#compiling-a-blueprint)).
- Unknown raw slot keys are excluded from the semantic slot map but remain
  navigable through the Blueprint's recovered source topology.

### State

```ts
createWidgetPlugin('counter')
	.interfaces<CounterInterfaces>()
	.state(state =>
		state.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}),
	)
```

- `validate` is the authoritative predicate for every candidate: initial
  defaults, `overrideStateDefaults`, and every `RuntimeState.set()` call.
- `default` is optional; when absent, state starts as `null` until a
  successful write. Its declared return type is not runtime authority — the
  produced value is still run through `validate`.

### Properties

```ts
createWidgetPlugin('counter')
	.interfaces<CounterInterfaces>()
	.properties(properties =>
		properties.doubled({
			registerDeps: ({ dep }) => ({
				count: dep.self.state.get('count'),
			}),
			compute: ({ deps }) => {
				const count = deps.count()
				return (count.success ? count.value ?? 0 : 0) * 2
			},
		}),
	)
```

- `registerDeps` is optional and runs once per Blueprint snapshot (not per
  runtime evaluation); recompiling produces a new Blueprint and may register a
  different dependency graph.
- `compute` receives the materialized `deps` (executed dependency callables),
  the current widget's Blueprint node, a valid-Blueprint view, and an issue
  collector.
- A property's dependency grammar has no `state.set` at the type level —
  properties cannot write state, directly or transitively.

### Methods

```ts
createWidgetPlugin('counter')
	.interfaces<CounterInterfaces>()
	.methods(methods =>
		methods
			.increment({
				validateArgs: (args): args is [number] =>
					args.length === 1 && typeof args[0] === 'number',
				registerDeps: ({ dep }) => ({
					count: dep.self.state.get('count'),
					setCount: dep.self.state.set('count'),
				}),
				execute: ({ args: [step], deps }) => {
					const current = deps.count()
					const value = (current.success ? current.value ?? 0 : 0) + step
					deps.setCount(value)
					return value
				},
			})
			.reset({
				validateArgs: (args): args is [] => args.length === 0,
				registerDeps: ({ dep }) => ({ setCount: dep.self.state.set('count') }),
				execute: ({ deps }) => { deps.setCount(0) },
			}),
	)
```

- `validateArgs` is required for every method, including zero-argument
  methods (`args is []`), and is the authoritative boundary for the
  invocation's arguments.
- Method dependency registration never binds invocation arguments — a
  registered `methods.invoke('name')` dependency is a callable that accepts
  runtime arguments when the consumer calls it, validated by the *target*
  method's own `validateArgs`.
- Unlike properties, a method's dependency grammar includes `state.set`.

### Dependency grammar

`registerDeps` receives a `dep` builder. Its return value (`RegisteredDeps`)
may be an arbitrary readonly object/array/tuple whose leaves are dependency
expressions — the container shape is free organization, not a static data
transport.

| Target | Existence | Typing | `.optional()` |
|---|---|---|---|
| `dep.self` | guaranteed | precise, capability-aware for the current plugin | not applicable |
| `dep.root` | guaranteed | unknown (refine with `.validate()`) | not applicable |
| `dep.parent` | may be absent | unknown | available at the target stage |
| `dep.widget(id)` | may be absent | unknown | available at the target stage |

Operations available per target, by consumer:

| Operation | Property consumer | Method consumer |
|---|---|---|
| `state.get(key)` | yes | yes |
| `state.set(key)` | no (not on the type surface) | yes |
| `properties.get(name)` | yes | yes |
| `methods.invoke(name)` | yes, only if the target method is transitively read-only | yes |

```ts
dep.parent
	.optional()
	.properties.get('label')
	.validate((value): value is string => typeof value === 'string')
```

- `.optional()` only changes target *existence*; it never suppresses
  ambiguity, an unresolved target, a missing capability/member, a refinement
  failure, or a target operation failure.
- When an optional target is absent at runtime: `state.get` / `property.get`
  / `method.invoke` succeed with `null` (skipping `.validate()` entirely),
  and `state.set` is a silent no-op that still succeeds with the original
  candidate — never `T | null`.
- `.validate()` is available only on readable leaves (`state.get`,
  `property.get`, `method.invoke`'s return value), is pure and repeatable,
  and only narrows; it is never available on `state.set` or on method
  invocation arguments.
- Reads/invokes materialize as zero/variadic-argument callables returning an
  `ExecutionResult`; a target's own failure is wrapped one-to-one into a
  consumer-local `property-dependency` / `method-dependency` issue rather
  than exposed as the target's own issue type.

## Compiling a blueprint

### Compilation boundary and recovery

```ts
const blueprint = system.createBlueprint(rawDefinition) // rawDefinition: unknown
```

The input is `unknown` on purpose — JSON-parsed or otherwise untrusted
document data is the real boundary. Compilation never throws merely because
the input is malformed; it always produces an inspectable Blueprint through
best-effort recovery, down to a recovered root.

A node becomes **resolved** once its `WidgetId`, plugin `type`, and a
matching registered plugin are all established. After that point, config,
slot, structure, or dependency errors keep the node resolved while the
Blueprint as a whole becomes invalid — only a genuinely unrecoverable
identity (missing/invalid id or type, unknown plugin type) produces an
**unresolved** node.

Navigation works on both valid and invalid Blueprints:

```ts
blueprint.root
blueprint.getWidget(id)
blueprint.getParent(node)
blueprint.getLocation(node)
blueprint.getChildren(node)
blueprint.getChildrenAt(node, slot)
blueprint.getCollectedIssues()
```

`getChildren` / `getChildrenAt` walk the recovered *source* topology; a
resolved node's `.slots` field is the separate, complete *semantic* topology
(only declared slots, every declared slot present).

### Diagnostics

Every issue is `{ source, message }` — `source.type` is the discriminator,
`message` is human-readable only and is never meant to be parsed as a machine
protocol. Blueprint issues use four coarse `source.type` categories:

| `source.type` | Owns |
|---|---|
| `definition` | malformed widget identity/shape: missing/invalid `id`/`type`, duplicate ids, unknown plugin type, malformed/unknown slots |
| `config` | `config.validate` failures on a resolved node |
| `structure` | slot-level / plugin-level / system-level `validateStructure` failures |
| `dependency` | unresolved dependency targets/members, Property purity violations (a Property depending on a writeful Method), Property-containing evaluation cycles |

```ts
for (const issue of blueprint.getCollectedIssues()) {
	console.log(issue.source.type, issue.message)
}
```

### Status and recompilation

```ts
type WidgetSystemBlueprintStatus = 'valid' | 'invalid'
```

Only `status === 'valid'`:

- narrows every node query to resolved nodes
- narrows `getCollectedIssues()` to an empty array
- exposes `createRuntime(options?)`

```ts
if (blueprint.status !== 'valid') {
	// inspect blueprint.getCollectedIssues() — no createRuntime here
}
else {
	const runtime = blueprint.createRuntime()
}
```

Editing is recompiling, not mutating:

```ts
const next = blueprint.recompile(nextRawDefinition)
// observably equivalent to: blueprint.system.createBlueprint(nextRawDefinition)
```

## Running a runtime

### Creating a runtime

```ts
const runtime = blueprint.createRuntime({
	overrideStateDefaults: {
		'counter-1': { count: 10 },
	},
})
```

`overrideStateDefaults` is an initialization-only candidate map, not a patch
API — it never mutates a running Runtime. Precedence per state member is
`override > plugin default > null`, and every candidate (override or
default) is still run through that member's `validate`. An invalid override
never falls back to the plugin default; it leaves the state `null` with an
ordinary `state-validation` issue. `createRuntime` never fails: malformed
override input (unknown widget, unknown key, wrong shape) still produces a
Runtime, recorded as runtime-level `state-override` issues.

`runtime.getWidget(id)` returns a `RuntimeWidget | null` distributed over the
registered plugin tuple. When more than one plugin is registered, narrow on
`widget.type` before accessing plugin-specific `state` / `properties` /
`methods` — there is no `getWidget(id, type)` helper.

### State

```ts
widget.state.count.get() // T | null — a direct read, not an ExecutionResult
widget.state.count.set(5) // ExecutionResult<number, RuntimeStateIssue>
widget.state.count.subscribe(listener) // listener: (value: T | null) => void
widget.state.count.getIssues()
widget.state.count.subscribeIssues(listener)
```

- An invalid `set()` preserves the previously accepted value and returns
  `{ success: false, issues }`; a successful `set()` commits the candidate
  and clears the latest issue snapshot.
- Change detection is strict `!==`: writing `NaN` again still counts as
  changed (`NaN !== NaN` is `true`), while `+0` and `-0` count as unchanged.
- Subscriptions never emit immediately upon subscribing.

### Properties

```ts
widget.properties.doubled.get() // ExecutionResult<T | null, RuntimePropertyIssue>
widget.properties.doubled.subscribe(listener) // listener: (result) => void
widget.properties.doubled.getIssues()
widget.properties.doubled.subscribeIssues(listener)
```

Properties are lazily evaluated and cached through `alien-signals`.
`subscribe()` activates observation but never emits immediately; every
*actual* completed recompute notifies exactly once, even when the recomputed
value compares equal to the previous one. `subscribeIssues()` observes a
separate diagnostic channel and never triggers a property evaluation.

### Methods

```ts
widget.methods.increment(5) // ExecutionResult<number, RuntimeMethodIssue>
widget.methods.increment.getIssues()
widget.methods.increment.subscribeIssues(listener)
```

Every invocation runs `validateArgs` before `execute`; on failure, `execute`
never runs and the result carries a `method-args` issue. A successful
`execute` whose plugin/dependency diagnostics were still recorded becomes a
failure with a `method-result` issue attached — the returned value in that
case is diagnostic context only, never a degraded success value.

Every `RuntimeMethod` invocation opens a batch boundary around its
dependency/state writes (including dependency-invoked methods, which nest);
only the outermost invocation flushes propagation. Batching means
propagation atomicity, not a transaction: writes performed before a later
failure or a thrown callback remain committed, and the batch still ends via
`finally`.

### Issues

Every state write, property evaluation, and method invocation keeps only its
**latest completed** operation's issue snapshot — never a history. A
callback throw discards the in-progress collector and preserves the previous
completed snapshot; it is an implementation exception, not an `Issue` and not
an `ExecutionResult.failure`.

Every `RuntimeWidget` also exposes its own aggregate, present regardless of
declared capabilities:

```ts
widget.getIssues() // readonly RuntimeWidgetIssue[]
widget.subscribeIssues(listener)
```

`RuntimeWidgetIssue` is the union of only that widget's own primitive-owned
issues (`RuntimeStateIssue | RuntimePropertyIssue | RuntimeMethodIssue`) —
never a Runtime-level issue, even when its source carries the same
`widgetId`. The snapshot order is deterministic: state members -> property
members -> method members, plugin declaration order within each capability,
and each primitive's own local issue order preserved. A widget with no
capabilities, or with every primitive currently succeeding, aggregates to
`[]`.

```ts
runtime.getIssues() // runtime-level issues only (e.g. state-override problems)
runtime.getCollectedIssues() // runtime.getIssues() + every RuntimeWidget.getIssues(), in Blueprint semantic widget order
runtime.subscribeCollectedIssues(listener)
```

`getIssues()` / `subscribeIssues()` (on both `RuntimeWidget` and
`WidgetSystemRuntime`) and `getCollectedIssues()` /
`subscribeCollectedIssues()` read issue signals only and never activate
property evaluation. The aggregate may legitimately list both a failing
primitive's own issue and a consumer's wrapped `property-dependency` /
`method-dependency` issue that points back at it — that is causal context,
not duplication.

### Disposal

```ts
runtime.dispose() // idempotent
```

After disposal, `runtime.isDisposed` and `runtime.blueprint` remain readable,
and previously obtained `RuntimeWidget.id` / `.type` / `.blueprint` stay
readable. Every live query/operation (`runtime.getWidget`, state/property
reads and writes, method invocations, `RuntimeWidget.getIssues()`) and every
*new* subscription (including `RuntimeWidget.subscribeIssues()`) throws
`WidgetSystemRuntimeDisposedError`; previously returned unsubscribe functions
remain safe, idempotent no-ops. Disposal itself emits no notification and
creates no issue.

```ts
import { WidgetSystemRuntimeDisposedError } from '@deviltea/widget-core'

try {
	runtime.getWidget('counter-1')
}
catch (error) {
	if (error instanceof WidgetSystemRuntimeDisposedError) {
		// `instanceof` is the stable discriminator; the message text is not.
	}
}
```

## Design constraints

- **Synchronous boundary.** Every framework-owned semantic callback
  (`validate`, `resolve`, `default`, `validateStructure`, `registerDeps`,
  `compute`, `validateArgs`, `execute`) is synchronous. A returned
  Promise/thenable is a contract violation on the plugin author's side, not
  an `Issue` and not an `ExecutionResult.failure`.
- **Renderer-agnostic.** The core has no concept of an editor, a document
  envelope, persistence versioning/migration, or UI. A `WidgetSystemRuntime`
  is the only thing an integration/renderer layer consumes; how it's drawn is
  entirely outside this package.
- **Dependency-mediated interaction.** All cross-widget reads/writes go
  through dependencies declared in `registerDeps`; there is no ambient way
  for one widget's callback to reach into another widget's state.
- **Reactive ownership.** `alien-signals` owns dependency tracking, laziness,
  caching, invalidation, and batching; this package only builds observable
  semantics on top of it and does not implement a second reactive engine.

The canonical, authoritative decision log for this architecture is
[GitHub issue #10](https://github.com/DevilTea/deviltea-labs/issues/10) —
"Widget composition core architecture — canonical decision log." Its
consolidated implementation handoff comment, together with any later accepted
amendment, is authoritative over this guide.
