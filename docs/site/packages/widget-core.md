---
title: '@deviltea/widget-core'
---

# @deviltea/widget-core

`@deviltea/widget-core` is a renderer-agnostic widget composition core. It
defines the cooperating `WidgetPlugin`, `WidgetSystem`,
`WidgetSystemBlueprint`, `WidgetDocument`, and `WidgetSystemRuntime` layers.
Persistence versioning, metadata, and rendering live outside the core;
source editing is limited to the revisioned `WidgetDocument` and its
JSON-domain `SourcePatch` contract.

This guide covers the public surface of the root entry and of the
`@deviltea/widget-core/inspection` and `@deviltea/widget-core/integration`
subpaths. For installation, see the
[package README](https://github.com/DevilTea/widget/tree/main/packages/core#readme).
Cross-cutting Diagnostic/Result/Failure/Error conventions are maintained in the
[Widget API conventions](https://github.com/DevilTea/widget/blob/main/docs/architecture/widget-api-conventions.md).

## Quick start

One complete, runnable example: two plugins (a `counter` with config, State, a
Property, Methods and an Event, and a `panel` that sums the counters in its
slot), registered into a system, compiled from a raw source tree, and run. The
rest of this guide explains each step; its fragments use these two plugins
where a plugin is needed.

<!-- sample: core-quick-start run -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

// 1. Declare each plugin's capabilities. `counter` has every runtime
//    capability; `panel` is a container with one slot and one Property.
interface CounterInterfaces {
	config: {
		raw: { step?: number } | null
		resolved: { step: number }
	}
	state: { count: number }
	properties: { doubled: number }
	methods: {
		increment: () => number
		reset: () => void
	}
	events: { changed: [count: number] }
}

interface PanelInterfaces {
	slots: 'content'
	properties: { total: number }
}

// 2. Build the plugins through the capability-phase builder.
const counterPlugin = createWidgetPlugin('counter')
	.description('A counter widget')
	.interfaces<CounterInterfaces>()
	.config({
		description: 'Counter configuration',
		validate: (input): input is { step?: number } | null =>
			input === null
			|| (typeof input === 'object' && !Array.isArray(input)
				&& (!('step' in input) || typeof input.step === 'number')),
		resolve: rawConfig => ({ step: rawConfig?.step ?? 1 }),
	})
	.state(state =>
		state.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}),
	)
	.properties(properties =>
		properties.doubled({
			registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
			compute: ({ deps }) => {
				const count = deps.count()
				return (count.ok ? count.value ?? 0 : 0) * 2
			},
		}),
	)
	.methods(methods =>
		methods
			.increment({
				validateArgs: (args): args is [] => args.length === 0,
				registerDeps: ({ dep }) => ({
					count: dep.self.state.get('count'),
					setCount: dep.self.state.set('count'),
				}),
				// `emits` declares the Events this Method may publish; `emit` carries exactly those.
				emits: ['changed'],
				// `config` is the resolved config.
				execute: ({ config, deps, emit }) => {
					const current = deps.count()
					const value = (current.ok ? current.value ?? 0 : 0) + config.step
					deps.setCount(value)
					emit.changed(value)
					return value
				},
			})
			.reset({
				validateArgs: (args): args is [] => args.length === 0,
				registerDeps: ({ dep }) => ({ setCount: dep.self.state.set('count') }),
				execute: ({ deps }) => {
					deps.setCount(0)
				},
			}),
	)
	.events(events => events.changed({ description: 'The count changed' }))
	.done()

const panelPlugin = createWidgetPlugin('panel')
	.description('A panel that sums the counters in its content slot')
	.interfaces<PanelInterfaces>()
	.slots({ content: { description: 'Counter widgets' } })
	.properties(properties =>
		properties.total({
			// Runs once per Blueprint. `widget` and `blueprint` are the
			// compile-time view of this panel and of the whole tree.
			registerDeps: ({ widget, blueprint, dep }) => ({
				counts: blueprint.getChildrenAt(widget, 'content')
					.flatMap(child => child.resolved
						? [dep.widget(child.id).state.get('count')
								.validate((value): value is number => typeof value === 'number')]
						: []),
			}),
			compute: ({ deps }) => deps.counts.reduce((sum, count) => {
				const result = count()
				return sum + (result.ok ? result.value ?? 0 : 0)
			}, 0),
		}),
	)
	.done()

// 3. Register plugins into an immutable system.
const system = createWidgetSystem({ plugins: [counterPlugin, panelPlugin] })

// 4. Compile an unknown/raw widget tree into a Blueprint.
const blueprint = system.createBlueprint({
	id: 'panel-1',
	type: 'panel',
	slots: {
		content: [
			{ id: 'counter-1', type: 'counter', config: { step: 2 } },
			{ id: 'counter-2', type: 'counter' },
		],
	},
})

// 5. Only a `valid` Blueprint can create a Runtime.
if (blueprint.status !== 'valid') {
	throw new Error(`invalid: ${blueprint.diagnostics.map(d => d.code)
		.join(', ')}`)
}

const runtime = blueprint.createRuntime()

// 6. `getWidget` returns a union over the registered plugins: narrow on `type`.
const counter1 = runtime.getWidget('counter-1')
const counter2 = runtime.getWidget('counter-2')
const panel = runtime.getWidget('panel-1')
if (counter1?.type !== 'counter' || counter2?.type !== 'counter' || panel?.type !== 'panel')
	throw new Error('widget not found')

// 7. Operate and observe through the Runtime primitives.
const stopTotal = panel.properties.total.subscribe((result) => {
	console.log('total ->', result) // { ok: true, value: ... }
})
const stopChanged = counter1.events.changed.subscribe((count) => {
	console.log('counter-1 changed ->', count)
})

counter1.methods.increment() // { ok: true, value: 2 } (step 2 from config)
counter2.methods.increment() // { ok: true, value: 1 } (default step)
counter1.state.count.get() // 2
counter1.properties.doubled.get() // { ok: true, value: 4 }
panel.properties.total.get() // { ok: true, value: 3 }

stopTotal()
stopChanged()
runtime.dispose()
```

## Core model

```text
WidgetPlugin
    plugin semantic contract, built with createWidgetPlugin(type)

WidgetSystem
    instance-scoped, immutable registered plugin universe

WidgetSystemBlueprint
    immutable compiled semantic snapshot of one unknown/raw widget tree
    status: 'valid' | 'invalid'

WidgetDocument
    revisioned source + Blueprint coordinator with atomic SourcePatch commits

WidgetSystemRuntime
    executable instance of a valid Blueprint
```

```text
createWidgetPlugin(type) -> builder chain -> WidgetPlugin
createWidgetSystem({ plugins, validateStructure? }) -> WidgetSystem
system.createBlueprint(source: unknown) -> WidgetSystemBlueprint
blueprint.createRuntime(options?) -> WidgetSystemRuntime   // only when status === 'valid'
```

Ownership rules that shape everything below:

- `WidgetSystem` is instance-scoped and immutable; the registered plugin tuple
  defines that instance's TypeScript universe. There is no global/module
  augmentation. Invalid plugin registration is rejected at construction with a
  coded `WidgetSystemConfigurationError` (see
  [Plugin registration errors](#plugin-registration-errors)).
- A Blueprint is an immutable semantic snapshot. Editing a widget tree means
  compiling different source through `system.createBlueprint()` or
  `blueprint.recompile()`, never mutating a Blueprint in place. "Immutable"
  describes Core's API: Core exposes no mutation operation and never mutates a
  Blueprint or its source. It is not a defensive copy against someone else
  mutating a graph they still hold (see the next rule).
- Authored source is handed to Core by reference. `system.createBlueprint(source)`,
  `blueprint.recompile(source)` and `createWidgetDocument({ system, source })`
  retain `source` as given: `blueprint.source` is the exact value passed in,
  and each recovered node's `source` is a reference into that same graph. Core
  does not clone, freeze, or Proxy-wrap it. Handing source to Core transfers
  semantic ownership, so after the call neither the caller nor any reader of
  `blueprint.source` or a node's `source` may mutate that graph or anything
  inside it; behavior after such a mutation is unspecified. Core does not
  re-derive compiled status, Diagnostics, resolved config, Runtime facts, or
  the `sourceJsonCompatible` proof, so a `JsonValue` narrowing can stop being
  true. A caller that wants to keep editing its own object should pass Core a
  copy (for example `structuredClone` for JSON-domain data). Opaque values in
  recovery input (class instances, functions, and similar) are terminal leaves
  and keep their identity.
- A Runtime can only be created from a Blueprint whose `status` is `'valid'`.
- Runtime state is never part of a persisted/raw widget definition.
- Runtime-changing interactions (reading another widget's state/property,
  invoking another widget's method) are only reachable through dependencies
  declared with `registerDeps`.
- Properties are transitively side-effect free: a property may read state,
  read other properties, and invoke methods, but only methods that are
  themselves transitively read-only. A Method is read-only when it neither
  writes State nor emits an Event, itself or through the Methods it invokes. A
  Property that depends on any other Method makes the Blueprint invalid (see
  [Methods](#methods)).
- [`alien-signals`](https://github.com/stackblitz/alien-signals) owns
  dependency tracking, laziness, caching, invalidation, and batching. The
  core only defines the observable semantics layered on top of it.

## Defining a plugin

### Capability interfaces

A plugin's shape is declared once, as a `WidgetInterfaces`:

```ts
import type { JsonValue } from '@deviltea/widget-core'

interface WidgetInterfaces {
	config?: { raw: Record<string, JsonValue> | null, resolved: Record<any, any> }
	slots?: string
	state?: Record<any, any>
	properties?: Record<any, any>
	methods?: Record<any, (...args: any[]) => any>
	events?: Record<any, readonly any[]>
}
```

`RawConfig` is authored JSON data: its values must stay within `JsonValue`
(including nested arrays and objects with string keys). Include `null` in it
when the config may be omitted (see [Config](#config)). Resolved config is a
runtime domain and may use richer values. A RawConfig type that contains a class
instance such as `Date`, `Map` or `Set` is rejected at `.interfaces()` with a
reason saying authored JSON objects must be plain objects.

An optional RawConfig field such as `{ label?: string }` and
`exactOptionalPropertyTypes`: with the flag off, TypeScript accepts an explicit
`label: undefined` for a typed source (`WidgetSourceFor`), but `undefined` is
outside the JSON domain, so `createBlueprint` reports `json-incompatible-value`
(reason `undefined`, path `['config', 'label']`) and the Blueprint is invalid.
With the flag on, the typed source rejects it at compile time. Either way,
omit the key instead of assigning `undefined`.

Every section is a capability:

- absent (the key is not declared as a required property) → that capability
  does not exist, and its builder phase is skipped entirely
- present (the key is declared as a required property) → the builder requires
  that capability to be implemented completely

Presence is a declaration fact, independent of whether the capability's own
member/name domain is empty. `slots: never` (zero declared slot names),
`state: Record<never, never>` (zero declared state keys) and their
`properties`/`methods` equivalents are all **present, explicitly-empty**
capabilities — distinct from not declaring the section at all — and each
still requires (and exposes) its builder phase, completed with an empty
argument (`.slots({})`, `.state(state => state)`, ...).

There is no `pluginConfig` / `globalConfig`. Plugin-specific integration
options are ordinary factory options captured by closure around
`createWidgetPlugin(...)`, not a framework-owned config layer.

### Reading capability presence at runtime: `plugin.capabilities`

A completed `WidgetPlugin` exposes its own declaration-presence facts as a
plain, immutable object — renderer-agnostic core metadata, not an
inspection/DevTools API:

<!-- sample: capabilities run -->
```ts
import { createWidgetPlugin } from '@deviltea/widget-core'

interface LabelInterfaces {
	state: { text: string }
}

const plugin = createWidgetPlugin('label')
	.description('A label widget')
	.interfaces<LabelInterfaces>()
	.state(state => state.text({
		validate: (input): input is string => typeof input === 'string',
		default: () => '',
	}))
	.done()

console.log(plugin.capabilities)
// { config: false, slots: false, state: true, properties: false, methods: false, events: false }
```

The type is `WidgetPluginCapabilities`:

```ts
interface WidgetPluginCapabilities {
	readonly config: boolean
	readonly slots: boolean
	readonly state: boolean
	readonly properties: boolean
	readonly methods: boolean
	readonly events: boolean
}
```

A consumer that already holds the exact plugin object (for example a renderer
adapter's `useWidget(plugin)`) reads `plugin.capabilities` for capability
presence instead of inferring it from Blueprint object shape or importing
`@deviltea/widget-core/inspection`. The shape intentionally matches the
inspection subpath's `BlueprintInspectionCapabilities`, but no object-identity
relationship between the two is part of the contract.

Plugin, config, and slot descriptions are required intrinsic metadata.
`system.catalog` is an immutable passive projection of the registered widget
types and their capability descriptions; it contains no Blueprint or Runtime
state.

### Builder phase order

```text
description -> interfaces -> config? -> slots? -> structure? -> state? -> properties? -> methods? -> events? -> done
```

```ts
createWidgetPlugin('counter')
	.description('A counter widget')
	.interfaces<CounterInterfaces>()
	.config({ /* ... */ }) // only if `config` is declared
	.slots({ /* ... */ }) // only if `slots` is declared
	.structure((ctx) => { /* ... */ }) // optional for every plugin; not a capability
	.state(state => state /* ... */) // only if `state` is declared
	.properties(properties => properties /* ... */) // only if `properties` is declared
	.methods(methods => methods /* ... */) // only if `methods` is declared
	.events(events => events /* ... */) // only if `events` is declared
	.done()
```

Each capability phase only exists on the builder chain when its capability was
declared, so a plugin with no `slots` never exposes a `.slots()` step.
`.structure(validateStructure)` is different: it is available to **every**
plugin, including a leaf widget with no slots, so a leaf widget can validate
its own placement. The types allow one call, after `.slots()` and before
`.state()`. It registers the plugin-level
structural validator (see [Structure validation](#structure-validation)). It
is not a capability: it does not appear in `plugin.capabilities`, the
catalog, or inspection. The exported type of that phase is
`WidgetPluginStructurePhase`.

The order is fixed: a declared phase called too early, after its position, or twice fails
type-checking at the misplaced call with an order-specific diagnostic that names the phase
and what must come first, instead of a bare "property does not exist" error. A misplaced
call never advances the chain, so `.done()` does not become available because of it.
Calling a phase whose capability was **not** declared keeps the ordinary "does not exist"
error. Because declared-but-misplaced phases appear as type-only order markers on the
builder type, editor completion can list them next to the phase that is actually callable.

The order check is type-only: the runtime builder accepts any order and cannot tell which
capabilities were declared. The shape of what you declare is checked at runtime, though
(see [Runtime validation of declarations](#runtime-validation-of-declarations)), so a
dynamically loaded or transpile-only plugin module still fails when it is built
rather than at its first use.

`state`, `properties`, `methods`, and `events` are **not** object-map sections. Each one
is a keyed-chain builder: every declared member key becomes a chainable
method on the section object, and calling it consumes that key. The section
callback can only return once every declared key has been called exactly
once — there is no `.define()`, `.add()`, or a framework-owned `.done()` for
these member sections specifically (only the outer builder has `.done()`).

```ts
createWidgetPlugin('example')
	.description('An example widget')
	.interfaces<ExampleInterfaces>()
	.state(state =>
		state
			.count({ /* ... */ })
			.enabled({ /* ... */ }),
	)
```

#### Runtime validation of declarations

Section builders are sealed, and every definition is checked when the plugin
is built, so a malformed plugin fails at construction instead of at its first
interaction:

- A member must be declared by calling its method with a definition object.
  Probing the section object itself (`JSON.stringify(section)`, a template
  interpolation, `Promise.resolve(section)`) is rejected with a `TypeError`,
  and so is calling a member after the section callback has returned.
  Member names that are special in JavaScript (`constructor`, `__proto__`, and
  similar) remain legal.
- Definitions are captured by value (a shallow copy of the definition's own
  enumerable fields) when they are registered. Mutating the object you passed
  in afterwards, or a retained section, does not change the plugin.
- A missing or ill-typed required callback or description (for example a
  `compute` that is not a function, or a slot without a `description`) throws a
  `TypeError` that names the plugin type, the section, the member and the field.
  Optional fields are checked only when present.

Plugin and callback contract violations are uncoded `TypeError`s: they are
implementation bugs, not Diagnostics (see
[Error taxonomy](#error-taxonomy)). Hosts no longer need to re-validate an
untyped plugin themselves.

### Member declaration facts and value contracts

The keyed member definitions are also the single source of passive declaration
facts that integration tooling may inspect. These facts live beside the
executable semantics rather than in a second metadata registry.

For example, State can mark itself `authorWritable`, and a Property can declare
a stable semantic value contract:

<!-- sample: value-contract run -->
```ts
import { createWidgetPlugin, createWidgetValueContract } from '@deviltea/widget-core'
import { inspectPlugin } from '@deviltea/widget-core/inspection'

// A semantic-contract owner normally defines and exports the typed token once.
const stringValueContract = createWidgetValueContract<string>('example/string@1')

interface ExampleInterfaces {
	state: { count: number }
	properties: { label: string }
}

const plugin = createWidgetPlugin('example')
	.description('An example widget')
	.interfaces<ExampleInterfaces>()
	.state(state => state
		.count({
			authorWritable: true,
			validate: (input): input is number => typeof input === 'number',
		}))
	.properties(properties => properties
		.label({
			valueContract: stringValueContract,
			compute: () => 'Example',
		}))
	.done()

console.log(inspectPlugin(plugin).state?.get('count')) // { type: 'state', name: 'count', authorWritable: true }
console.log(inspectPlugin(plugin).properties?.get('label')) // { type: 'property', name: 'label', valueContractId: 'example/string@1' }
```

`authorWritable` is passive authoring-policy metadata for editors and other
tooling: it states that the plugin author intends authors to be able to supply
this State member's initial value. Core does **not** enforce it.
`overrideStateDefaults` accepts a candidate for any declared State member
whether or not it is `authorWritable` (every candidate is still run through the
member's `validate`), so a host that wants the policy enforced must check it
itself, for example against `inspectPlugin(plugin).state`.

Plugin authors import a shared contract token instead of recreating it locally.
`createWidgetValueContract<T>(id)` is the low-level typed definition
primitive. A contract for `T` describes every value of type `T`, so it can be
attached to a Property whose value type is the same as `T` or narrower (a
`WidgetValueContract<string>` fits a `'small' | 'large'` Property); a wider
Property type, or a nullable Property with a non-nullable contract, is rejected
by the compiler. The runtime/integration identity remains only the stable
string `id`. Core does not interpret, register, validate, or schema-check
contract IDs, and Property values do not become JSON-only. Omitting
`valueContract` simply means there is no declared inspectable value contract.

A value contract is not a Plugin capability and does not have its own builder
phase. It describes the external semantic contract claimed by one Property;
ownership therefore belongs to the integration/protocol that defines that
contract, while the Plugin Builder remains the declaration site that opts a
Property into it.

The same declaration facts can be projected through the readonly inspection
subpath without exposing `validate`, `default`, `registerDeps`, `compute`,
or other executable callbacks.

### Config

<!-- sample: config run -->
```ts
import { createWidgetPlugin, createWidgetSystem, WIDGET_CONFIG_JSON_SCHEMA_DIALECT } from '@deviltea/widget-core'

interface BadgeInterfaces {
	config: {
		raw: { label?: string } | null
		resolved: { label: string }
	}
}

const badgePlugin = createWidgetPlugin('badge')
	.description('A badge widget')
	.interfaces<BadgeInterfaces>()
	.config({
		description: 'Badge configuration',
		// Optional, passive authoring metadata (Draft 2020-12); Core never executes it.
		schema: {
			$schema: WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
			type: 'object',
			properties: { label: { type: 'string' } },
		},
		validate: (input): input is { label?: string } | null =>
			input === null || (typeof input === 'object' && !Array.isArray(input)),
		resolve: rawConfig => ({ label: rawConfig?.label ?? 'Badge' }),
	})
	.done()

const system = createWidgetSystem({ plugins: [badgePlugin] })
const catalogEntry = system.catalog.widgets[0]
console.log(catalogEntry?.config?.description) // 'Badge configuration'
console.log(catalogEntry?.config?.schema) // the schema above (null when none was given)
console.log(badgePlugin.config?.schema === catalogEntry?.config?.schema) // true
console.log(badgePlugin.descriptions.config) // 'Badge configuration'
```

- `config.validate` always runs when the plugin declares a config capability.
  Raw config presence is own-property based, and an omitted raw `config` field
  is validated as the candidate `null` — the same as an explicit
  `config: null`. An explicit `config: undefined` is not omission; it is
  validated as `undefined`.
- Required-ness is expressed by the raw config type and the validator, not by
  a separate flag:

  | Raw config type | Validator accepts `null` | Omitted config |
  |---|---|---|
  | `Config` | no | invalid: `invalid-widget-config` |
  | `Config \| null` | yes | valid: `rawConfig = null`, `resolve(null)` |

  The typed authored source (`WidgetSourceFor`) follows the same rule: its
  `config` field is optional only when the raw config type admits `null`.
- A validator may report why the `null` candidate is rejected, for example
  `ctx.addDiagnostic({ message: 'A title is required.', path: ['title'] })`.
  Without its own diagnostic, a `false` result gets a framework fallback
  diagnostic.
- Validation fails when `validate` returns `false` or reports any
  diagnostic. Then the node gets `invalid-widget-config` diagnostics, the typed
  raw config becomes `null`, and the semantic config still resolves through
  `resolve(null)` so the invalid Blueprint stays inspectable. `resolve(null)`
  therefore runs both for an accepted omission and for recovery; validity is
  carried by Blueprint status and diagnostics, not by the resolved value.
- A raw `config` that cannot be inspected safely (an accessor, or a
  descriptor read that throws) gets a config diagnostic and resolves through
  `resolve(null)` without calling `validate`.
- `resolve` is required and has no Blueprint/topology access — it is pure
  normalization from raw to resolved config.
- `validate` is an authoritative predicate (`input is RawConfig`), not a
  coercion step.
- `schema` is optional, passive authoring metadata: a JSON Schema document
  (type `WidgetConfigJsonSchema`, Draft 2020-12; the dialect URI is exported as
  `WIDGET_CONFIG_JSON_SCHEMA_DIALECT`). Core never validates against it or
  executes it. It reaches tooling through `plugin.config` (`{ description,
  schema }`, `null` when the plugin has no config capability, and a `schema` of
  `null` when none was given), through the matching `system.catalog` entry's
  `config`, and through `inspectPlugin(plugin).config`. The description is also
  available as `plugin.descriptions.config`.
- The resolved config that callbacks receive as `ctx.config` (the same
  object as `node.config` on the Blueprint) is resolved once at compile time and
  shared: every callback of that widget, in every Runtime created from that
  Blueprint, receives the same reference. Treat it as read-only and never
  mutate it; Core does not copy it for each call.

### Slots

Unlike `state` / `properties` / `methods`, `slots` is supplied as one
complete object map — every declared slot key must be present. `.slots()` takes
that map as its only argument; a plugin-level structural validator is declared
with `.structure()` (see [Structure validation](#structure-validation)).

```ts
interface ContainerInterfaces {
	slots: 'header' | 'content'
}

createWidgetPlugin('container')
	.description('A container widget')
	.interfaces<ContainerInterfaces>()
	.slots({
		header: {
			description: 'Header widgets',
			validateStructure: ({ children, addDiagnostic }) => {
				if (children.length > 1)
					addDiagnostic({ message: 'header accepts at most one widget', index: 1 })
			},
		},
		content: { description: 'Content widgets' },
	})
	// ...
```

- A resolved node's semantic `.slots` map always contains exactly the
  declared slots, each a complete (possibly empty) array — an omitted or
  malformed raw slot resolves to `[]`.
- Structural validation runs slot-level → plugin-level → system-level (see
  [Structure validation](#structure-validation)).
- Unknown raw slot keys are excluded from the semantic slot map but remain
  navigable through the Blueprint's recovered source topology.

### Structure validation

Three optional validators check how widgets are arranged. They run in this
order for every resolved node, and each reports through its own collector:

| Level | Declared with | Context fields | May report against |
|---|---|---|---|
| Slot | `validateStructure` in a slot definition | `widget`, `slot`, `children`, `blueprint`, `addDiagnostic`, `hasAnyDiagnostic`, and `config` when the plugin has config | the slot, or one child by `index` |
| Plugin | `.structure(validateStructure)` | `widget`, `blueprint`, the collector, and `config` when the plugin has config | the widget itself, one of its declared slots (`slot`), or one slot child (`slot` and `index`) |
| System | `createWidgetSystem({ validateStructure })` | `blueprint` and the collector | any location in the Blueprint, as `location` (and optional `related` locations) |

`widget` is this widget's compile-time node view, and `blueprint` is the
read-only compile view (`root`, `getWidget`, `getParent`, `getLocation`,
`getChildren`, `getChildrenAt`). Every diagnostic input has a `message` and an
optional `reason` string, which is carried onto the resulting
`invalid-widget-structure` diagnostic. Each validator must be synchronous. Written
into the builder (`.slots()`, `.structure()`) or into `createWidgetSystem`'s
options, an `async` validator, or one returning anything with a callable `then`,
is a type error, while any synchronous return value type-checks. A validator
typed only through a standalone annotation (`WidgetPluginValidateStructure`,
`WidgetSlotDefinition`, `WidgetSystemValidateStructure`) is not checked this way,
because the annotation cannot see the function's own return type; the runtime
guard still throws a `TypeError` for a thenable result.

A validator that reports a location that does not exist in the Blueprint (for
example a `slot` the widget never declared, or a node that is not part of this
Blueprint) is an implementation bug and throws a `TypeError` instead of
producing a diagnostic.

`.structure()` is available to every plugin, so a widget with no slots can
validate its own placement:

<!-- sample: structure run -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

interface ContainerInterfaces {
	slots: 'header' | 'content'
}
interface LeafInterfaces {
	state: { text: string }
}

const containerPlugin = createWidgetPlugin('container')
	.description('A container widget')
	.interfaces<ContainerInterfaces>()
	.slots({
		header: {
			description: 'Header widgets',
			// Slot-level: `widget`, `slot`, `children`, `blueprint` and the collector.
			validateStructure: ({ children, addDiagnostic }) => {
				if (children.length > 1)
					addDiagnostic({ message: 'header accepts at most one widget', index: 1 })
			},
		},
		content: { description: 'Content widgets' },
	})
	// Plugin-level: `widget`, `blueprint` and the collector; may target a slot or a slot child.
	.structure(({ widget, addDiagnostic }) => {
		if (widget.slots.header.length === 0 && widget.slots.content.length === 0)
			addDiagnostic({ message: 'a container must not be empty', reason: 'empty-container' })
	})
	.done()

const leafPlugin = createWidgetPlugin('leaf')
	.description('A leaf widget that must live in a container')
	.interfaces<LeafInterfaces>()
	// Available to every plugin, even one without slots: a leaf validates its own placement.
	.structure(({ widget, blueprint, addDiagnostic }) => {
		if (blueprint.getParent(widget) === null)
			addDiagnostic({ message: 'a leaf cannot be the root', reason: 'leaf-at-root' })
	})
	.state(state => state.text({
		validate: (input): input is string => typeof input === 'string',
		default: () => '',
	}))
	.done()

const system = createWidgetSystem({
	plugins: [containerPlugin, leafPlugin],
	// System-level: runs last; reports against a location that exists in the Blueprint.
	validateStructure: ({ blueprint, addDiagnostic }) => {
		if (blueprint.root.resolved && blueprint.root.type !== 'container')
			addDiagnostic({ message: 'the root must be a container', location: { type: 'widget', node: blueprint.root } })
	},
})

const blueprint = system.createBlueprint({
	id: 'box',
	type: 'container',
	slots: { header: [{ id: 'a', type: 'leaf' }, { id: 'b', type: 'leaf' }] },
})
console.log(blueprint.status)
for (const diagnostic of blueprint.diagnostics)
	console.log(diagnostic.code, diagnostic.location.type, 'reason' in diagnostic ? diagnostic.reason : undefined)

const rootLeaf = system.createBlueprint({ id: 'solo', type: 'leaf' })
console.log(rootLeaf.diagnostics.map(d => [d.code, 'reason' in d ? d.reason : undefined]))
```

### State

```ts
createWidgetPlugin('counter')
	.description('A counter widget')
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
- `validate` receives a diagnostic collector (and the resolved `config` when the
  plugin has config); `default` receives only the resolved `config`.
- `authorWritable` is passive authoring metadata that Core does not enforce
  (see [Member declaration facts](#member-declaration-facts-and-value-contracts)).

State values are immutable by contract. Change detection compares by identity
(`!==`), so a write that stores the same reference notifies nobody: mutating an
object or array in place and then calling `set()` with that same object
changes what `get()` returns but notifies no subscriber and recomputes no
dependent Property. Always `set()` a new value (`set({ ...value, n: 1 })`,
`set([...items, item])`). `resetState()` restores the captured initialization
outcome — the same value reference the member started with — so a value that was
mutated in place is *not* restored to what it looked like at creation. Core
does not freeze values written through `state.set`.

### Properties

```ts
createWidgetPlugin('counter')
	.description('A counter widget')
	.interfaces<CounterInterfaces>()
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
```

- `registerDeps` is optional and runs once per Blueprint snapshot (not per
  runtime evaluation); recompiling produces a new Blueprint and may register a
  different dependency graph.
- `registerDeps` receives `widget` (this widget's compile-time node view),
  `blueprint` (the read-only compile view of the whole tree), `dep` (the
  builder), and the resolved `config` when the plugin has config. Because it
  can walk the tree, it is where a widget aggregates its children: the
  `panel` in the [Quick start](#quick-start) reads
  `blueprint.getChildrenAt(widget, 'content')` and registers one
  `dep.widget(child.id).state.get('count')` dependency per child. `registerDeps`
  has no diagnostic collector and no runtime values.
- `compute` receives the materialized `deps` (executed dependency callables),
  `widget` (this widget's resolved Blueprint node), `blueprint` (a read-only
  view of the valid Blueprint: `root`, `getWidget`, `getParent`, `getLocation`,
  `getChildren`, `getChildrenAt`), the diagnostic collector (`addDiagnostic`,
  `hasAnyDiagnostic`), and the resolved `config` when the plugin has config.
- A property's dependency grammar has no `state.set` at the type level —
  properties cannot write state, directly or transitively. At runtime a
  Property can never write State either: a setter retained from a Method does
  not work while a Property is evaluating (see
  [Callback context lifetime](#callback-context-lifetime)). A `compute` that
  writes through a Runtime it holds by closure is not supported (see
  [When Property inspection listeners run](#when-property-inspection-listeners-run)).
- A Property may declare a dependency on a Method only if that Method is
  read-only: it neither writes State nor emits an Event, itself or through the
  Methods it invokes. Otherwise the Blueprint is `invalid` (see
  [Methods](#methods)), so evaluating a Property never emits an Event.
- `valueContract` may be attached to a Property; see
  [Member declaration facts](#member-declaration-facts-and-value-contracts).
- A Property's completed result is typed exactly as declared (`T`, not
  `T | null`).

### Methods

```ts
createWidgetPlugin('counter')
	.description('A counter widget')
	.interfaces<CounterInterfaces>()
	.methods(methods =>
		methods
			.increment({
				validateArgs: (args): args is [] => args.length === 0,
				registerDeps: ({ dep }) => ({
					count: dep.self.state.get('count'),
					setCount: dep.self.state.set('count'),
				}),
				emits: ['changed'],
				execute: ({ config, deps, emit }) => {
					const current = deps.count()
					const value = (current.ok ? current.value ?? 0 : 0) + config.step
					deps.setCount(value)
					emit.changed(value)
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
  invocation's arguments. A method declared as `add: (step: number) => number`
  would use `validateArgs: (args): args is [number] => args.length === 1 &&
  typeof args[0] === 'number'` and read `args: [step]` in `execute`.
- `execute` receives `args`, `widget`, `blueprint` (as for `compute`), `deps`,
  the diagnostic collector, the resolved `config` when the plugin has config,
  and `emit` when the plugin declares events. `validateArgs` receives a
  diagnostic collector and the resolved `config` when the plugin has config.
- `emits` is an optional array of the Event names this Method may emit, for
  example `emits: ['changed']`. Only an Event listed there is a member of the
  `emit` the Method's `execute` receives, with its declared argument tuple; any
  other Event is a type error (`emit.cleared()` when `cleared` is not listed),
  and a name that is not an Event of the plugin is a type error in `emits`
  itself. A Method without `emits`, or with `emits: []`, emits nothing, and
  its `emit` has no members. A plugin without an events capability has no
  `emit` and cannot declare `emits`. Each Method declares its own Events: a
  Method that emits only through another Method it invokes declares nothing,
  because the emit belongs to the invoked Method. The Events are those of the
  Method's own widget; a Method cannot emit an Event of another widget.
- A Method that emits, itself or through the Methods it invokes, is not
  read-only, exactly like a Method that writes State. A Property that declares a
  dependency on such a Method is rejected when the Blueprint is compiled: the
  Blueprint is `invalid` and carries a `property-dependency-has-side-effects`
  diagnostic on the Property (see [Diagnostics](#diagnostics)).
  A Method may still invoke an emitting Method, and so may the host.
- The `emits` list is validated when the plugin is built: it must be an array of
  strings, each naming an Event of the plugin's `events` section (declared after
  the Methods), with no name repeated; otherwise `done()` throws a `TypeError`
  that names the plugin, the Method and the Event. The list is captured by value.
- Untyped code (JavaScript, a cast) that emits an Event the running Method did
  not declare gets a `TypeError` naming the Method and the Event, and nothing is
  delivered: no listener runs and no inspection occurrence is published.
- A Method's success value is typed exactly as declared (`T`, never
  `T | null`); a `void` Method returns `{ ok: true, value: undefined }`, typed
  `ExecutionResult<void, …>`, so there is nothing meaningful to read from it.
  An `execute` written into the builder that returns a thenable (an `async`
  function, or anything with a callable `then`) is a compile-time error even
  when the Method is declared to return `void` or `unknown`, while any
  synchronous value — an `unknown`-typed dependency read included — type-checks.
  A standalone `WidgetMethodDefinition` annotation cannot see the function's own
  return type, so there only the runtime guard rejects a thenable. Async work is
  not part of Core (see [Async work](#async-work)).
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
| `methods.invoke(name)` | yes, only if the target method is transitively read-only: it neither writes State nor emits an Event, itself or through the Methods it invokes | yes |

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
  consumer-local `dependency-target-failed` / `dependency-value-rejected`
  diagnostic rather than exposed as the target's own diagnostic type.
- Only Method and Property results are frozen. The result of `state.set` and the
  results of dependency callables are fresh per call and are not frozen.

### Callback context lifetime

Every semantic callback runs synchronously, and everything its context hands it
is valid only for that call:

- `addDiagnostic` / `hasAnyDiagnostic` throw a `TypeError` when called after
  the callback returned or threw (the operation's diagnostics are already
  final).
- The dependency callables in `deps` and the `emit` callables of a Method are
  valid only while **their own callback is the innermost running callback**: a
  Method's `emit` belongs to that Method, not to its widget, so it does not
  work while a different Method of the same widget runs either, even one that
  declares the same Event.
  Called any other time — after the callback returned or threw, from a
  `setTimeout` or promise continuation, or from a different callback running
  inside it — they throw a `TypeError` and do nothing. After the Runtime is
  disposed they throw `WidgetSystemRuntimeDisposedError` instead.
- Code that is not such a callback never counts as one, even while it runs
  inside one. While an external listener (State, Property, diagnostics, Event,
  `WidgetDocument` or inspection) or a plugin callback that receives no
  dependency callables (`validate`, `validateArgs`, `default`, a dependency
  `.validate()` refinement, config and structure callbacks) runs, no callback is
  open, so a callable retained from the Method that triggered it throws. The
  Method's own callables work again once that code has returned or thrown.

Consequences, stated plainly:

- A dependency callable you retained (in a closure, a variable, a timer) does
  not work later. Nothing asynchronous can call `deps.*` or `emit.*`.
- In an `async` function only the part that runs synchronously before the
  first `await` is inside the callback; the tail after an `await` cannot write
  State, invoke Methods, or emit Events.
- A Property can never write State, even through a setter that a Method
  retained: while a Property computes it is the innermost callback, so the
  Method's setter is rejected.
- An Event listener notified by a Method's `emit`, or a State `validate` run by
  the Method's own write, cannot use that Method's `deps` or `emit` either.

One case is not detected: the check compares members, not invocations, so a
callable a Method retained from an earlier invocation still works while a later
invocation of the same Method is running. Do not rely on it.

To do work later, return from the callback and perform the later step from the
host through the public Runtime surface (see [Async work](#async-work)).

### The System

`createWidgetSystem({ plugins, validateStructure? })` returns an immutable
`WidgetSystem` with these members:

| Member | Meaning |
|---|---|
| `system.plugins` | the registered plugin tuple (frozen); it defines the System's TypeScript universe |
| `system.validateStructure` | the system-level structural validator, or `null` (see [Structure validation](#structure-validation)) |
| `system.catalog` | passive projection of the registered widget types (`type`, `description`, `config`, `descriptions`); contains no Blueprint or Runtime state |
| `system.getPlugin(type)` | the registered plugin of that `type`, or `null` when none is registered |
| `system.createBlueprint(source)` / `system.createBlueprintFromJson(text)` | the compilation boundary (see [Compiling a blueprint](#compiling-a-blueprint)) |

`getPlugin` returns `null` (never `undefined`) for an unregistered type. On a
precisely typed System, a literal that names a registered type returns exactly
that plugin type; a type that is not registered is a compile-time error for a
literal, and a broad `string` (or a loosely typed `WidgetSystem`) returns
`AnyWidgetPlugin | null`.

### Plugin registration errors

Plugins, Blueprints, and Runtimes are recognized by brands private to one loaded
`@deviltea/widget-core` module instance. An object produced by another module
instance (duplicate install, version skew, inlined copy) or a structural
look-alike is *foreign*. Core does not distinguish "another widget-core copy"
from "not a widget object"; provenance is capability separation, not a security
sandbox. This is why plugin and renderer libraries must declare
`@deviltea/widget-core` as a **peer dependency**, never a regular dependency:
exactly one copy of Core must exist in an application for its plugins, Systems
and Runtimes to recognize each other.

`createWidgetSystem` first checks the options, then validates the `plugins`
tuple in order, and throws `WidgetSystemConfigurationError` (exported from the
root) for the first problem, before any System exists:

| `code` | Meaning | Fields |
|---|---|---|
| `invalid-options` | `options` is not an object, `options.plugins` is not an array, or `options.validateStructure` is present but not a function | `pluginIndex`, `pluginType` and `firstPluginIndex` are all `null` |
| `foreign-plugin` | the entry was not completed by this module instance | `pluginIndex`, `pluginType` (the entry's `type` when a string, else `null`) |
| `duplicate-plugin-type` | the entry repeats an earlier plugin's `type` | `pluginIndex`, `pluginType`, `firstPluginIndex` |

The options check runs before any plugin entry is inspected, and provenance is
checked before the duplicate check. `pluginIndex` is `number | null` (`null`
only for `invalid-options`), and `firstPluginIndex` is `null` for every code
except `duplicate-plugin-type`.

<!-- sample: registration-errors run -->
```ts
import { createWidgetPlugin, createWidgetSystem, WidgetSystemConfigurationError } from '@deviltea/widget-core'

const plugin = createWidgetPlugin('note')
	.description('A note widget')
	.interfaces<Record<never, never>>()
	.done()

const system = createWidgetSystem({ plugins: [plugin] })
console.log(system.getPlugin('note') === plugin) // true
console.log((system as { getPlugin: (type: string) => unknown }).getPlugin('missing')) // null

for (const options of [
	{ plugins: [plugin, plugin] }, // duplicate-plugin-type
	{ plugins: [{ type: 'look-alike' }] }, // foreign-plugin
	{ plugins: 'note' }, // invalid-options
]) {
	try {
		createWidgetSystem(options as never)
	}
	catch (error) {
		if (error instanceof WidgetSystemConfigurationError)
			console.log(error.code, error.pluginIndex, error.pluginType, error.firstPluginIndex)
	}
}
```

There is no boolean `isWidgetPlugin` guard; hosts validate a candidate adapter
export with `inspectPlugin(candidate)` (coded `foreign-plugin`) or through
`pluginIndex` at construction. Consumers discriminate by class and `code`; the
`message` is descriptive only. Reusing a code string across classes is
intentional.

## Compiling a blueprint

### Authored source

A widget tree is authored as nested JSON-domain objects. Each widget node has
exactly these recognized own keys:

| Key | Meaning |
|---|---|
| `id` | the widget's identity: a string, unique within the tree |
| `type` | the `type` of a registered plugin |
| `config` | the plugin's raw config (only for a plugin with a config capability) |
| `slots` | an object mapping a declared slot name to an array of child widget nodes (only for a plugin with a slots capability) |
| `meta` | the reserved extension key |

```json
{
	"id": "panel-1",
	"type": "panel",
	"slots": { "content": [{ "id": "counter-1", "type": "counter", "config": { "step": 2 } }] },
	"meta": { "label": "anything the host wants to keep" }
}
```

- Any **other** own key on a widget node (for example `"label"` or a typo such
  as `"slot"`) is reported as `unexpected-widget-field` with `path: [key]` and
  makes the Blueprint invalid. Extra fields are not silently preserved or
  ignored.
- `meta` is the one place for host-owned data. Its value may be any JSON value.
  Core preserves it in `source`, carries it through separated-source tooling,
  and never interprets it.
- An `id` is any string, including the empty string `''`; Core imposes no
  format. Ids only have to be unique: a repeated id is `duplicate-widget-id`
  (on every occurrence, with `related` pointing at the others), while
  `invalid-widget-id` means the `id` is missing or not a string.
- The typed form of a node is `WidgetSource<Plugins>` / `WidgetSourceFor`
  (`meta?: JsonValue` included). `createBlueprint` still takes `unknown`
  because the real input is untrusted data. A valid Blueprint's `source` is
  typed as the System's `WidgetSource`.
- Authored source and `SourcePatch` operands may nest at most
  `MAX_JSON_DEPTH` (256, exported) containers deep. A widget node uses three
  containers per tree level (the node, `slots`, and the slot array), so that is
  roughly 85 levels of widgets. Deeper input is reported as
  `json-incompatible-value` with reason `max-depth-exceeded`, and the
  over-deep node as `invalid-widget-definition`; no entry point throws a
  `RangeError` for deep input, nor for wide input (a node with hundreds of
  thousands of unknown keys, or an array with as many invalid elements, yields
  one diagnostic per problem).
- `isJsonValue(value)` (exported from the root) is the type guard for the same
  JSON domain: finite numbers, strings, booleans, `null`, plain objects and
  dense arrays, within `MAX_JSON_DEPTH`, with no cycles. It answers at the first
  value outside the domain without inspecting the rest.

### Compilation boundary and recovery

```ts
const blueprint = system.createBlueprint(source) // source: unknown
```

The input is `unknown` on purpose — JSON-parsed or otherwise untrusted
document data is the real boundary. Compilation never throws merely because
the input is malformed; it always produces an inspectable Blueprint through
best-effort recovery, down to a recovered root.

When the source is JSON text, `system.createBlueprintFromJson(text)` is
equivalent to `system.createBlueprint(JSON.parse(text))`, including its
diagnostics, but cheaper: Core parsed the value itself, so it replaces the
full JSON-domain inspection with a scan for the only two ways a parsed value
can leave that domain — a number literal that overflows to `Infinity` (for
example `1e400`, diagnosed as `json-incompatible-value` / `non-finite-number`)
and nesting deeper than `MAX_JSON_DEPTH`. Invalid JSON text throws the
`SyntaxError` from `JSON.parse` unchanged. There is no option to skip the
inspection for an arbitrary value: `sourceJsonCompatible` is a proof, and
`createBlueprint` stays fail-closed for untrusted input.

A node becomes **resolved** once its `WidgetId`, plugin `type`, and a
matching registered plugin are all established. After that point, config,
slot, structure, or dependency errors keep the node resolved while the
Blueprint as a whole becomes invalid — only a genuinely unrecoverable
identity (missing/invalid id or type, unknown plugin type) produces an
**unresolved** node. An unresolved node still exposes best-effort hints:
`id: string | null` (the authored `id` when it is a string) and
`type: string | null` (the authored `type` when it is a string, even an
unknown one). That includes the node at which recovery stops because it is
nested too deep and a node that repeats an ancestor's object in a cycle. An
unresolved node with an `id` hint is found by `getWidget` and takes part in
`duplicate-widget-id` like any other node, except a cyclic repeat, which is the
same authored object as its ancestor and is not indexed again.

Navigation works on both valid and invalid Blueprints:

```ts
blueprint.root
blueprint.getWidget(id)
blueprint.getParent(node)
blueprint.getLocation(node)
blueprint.getSourcePath(node)
blueprint.getChildren(node)
blueprint.getChildrenAt(node, slot)
blueprint.diagnostics
```

`getChildren` / `getChildrenAt` walk the recovered *source* topology; a
resolved node's `.slots` field is the separate, complete *semantic* topology
(only declared slots, every declared slot present).

`getSourcePath(node)` returns the structured `SourcePath` of that node's object
inside `blueprint.source` (`[]` for the root, `['slots', 'content', 0]` for the
first child in `content`), or `null` for a node that does not belong to this
Blueprint. The path is usable verbatim as a `SourcePatch` path against the same
source, which is how a diagnostic's `location.node` becomes an edit (see
[Persisted documents](#persisted-documents)). That holds for every node the
Blueprint materializes, including the one recovery stops at for depth: a node
is recovered further only while it is nested inside fewer than `MAX_JSON_DEPTH`
containers, so no node's path has more than `MAX_JSON_DEPTH + 2` segments,
which is exactly the longest path a `SourcePatch` accepts. Blueprint inspection
nodes carry the same value as `sourcePath`.

### Diagnostics

Every diagnostic has top-level `code`, `location`, and `message` fields.
Variant-specific facts are direct fields; structured `path` and `related` are
not nested under a generic `source` object. Codes are stable lowercase
kebab-case values. A diagnostic's `code` is fixed where Core creates the
diagnostic and never depends on its `message`, which is not part of the
stable contract.

Blueprint diagnostics (`blueprint.diagnostics`, and `node.diagnostics` for the
node-owned ones):

| `code` | Reported when | Extra fields |
|---|---|---|
| `invalid-widget-definition` | the node is not a plain object, is cyclic, or is nested deeper than `MAX_JSON_DEPTH` | |
| `invalid-widget-id` | `id` is missing, not a string, or unreadable | `path` |
| `duplicate-widget-id` | another node has the same `id` (reported on every occurrence) | `path`, `related` |
| `invalid-widget-type` | `type` is missing or not a string | `path` |
| `unknown-widget-type` | `type` names no registered plugin | `path` |
| `unexpected-widget-field` | the node has an own key other than `id`, `type`, `config`, `slots`, `meta` | `path: [key]` |
| `unexpected-widget-config` | `config` is present but the plugin has no config capability | `path` |
| `invalid-widget-config` | `config.validate` returned `false` or reported a diagnostic, or the raw config could not be inspected safely | `path?`, `reason?` |
| `invalid-widget-slots` | `slots` is not a plain object or could not be inspected safely | `path` |
| `unexpected-widget-slots` | `slots` is present but the plugin has no slots capability | `path` |
| `undeclared-widget-slot` | a slot key the plugin does not declare | `path: ['slots', name]` |
| `invalid-widget-slot` | a slot's value is not an array | `path: ['slots', name]` |
| `invalid-widget-structure` | a slot-level, plugin-level or system-level `validateStructure` reported a problem | `reason?`, `related?` |
| `missing-dependency-target` | the target widget (for `dep.widget(id)` or `dep.parent`) does not exist and the dependency is not `.optional()` | `dependency`, `related?` |
| `unresolved-dependency-target` | the target exists but is an unresolved node | `dependency`, `related?` |
| `missing-dependency-capability` | the target has no such capability (state, properties, methods) | `dependency`, `related?` |
| `missing-dependency-member` | the target has the capability but no such member | `dependency`, `related?` |
| `ambiguous-dependency-target` | several nodes share the target id | `dependency`, `related` |
| `property-dependency-has-side-effects` | a Property depends on a Method that writes State or emits an Event, itself or through the Methods it invokes; one diagnostic per Property-to-Method dependency, and the message says which effect the Method has (it writes State, it emits an Event, or both); `related` is the Method the Property invokes | `dependency`, `related` |
| `property-evaluation-cycle` | a cycle of dependencies that contains a Property (reported on every Property of the cycle; `related` lists every member of the cycle, the diagnostic's own Property and any Method included, in member order, and is one frozen array shared by the diagnostics of that cycle) | `related` |
| `json-incompatible-value` | the whole-source JSON-domain check found a value outside the domain; aggregate-only | `path` (source-rooted), `reason` |
| `source-access-failed` | the whole-source check could not safely read a value (an accessor or a throwing reflection); aggregate-only | `path` |

`reason` on `json-incompatible-value` is a closed framework enum:
`undefined`, `non-finite-number`, `bigint`, `symbol`, `function`,
`unsupported-object-prototype`, `symbol-key`, `accessor-property`,
`sparse-array`, `array-extra-property`, `cyclic-reference`, or
`max-depth-exceeded`. By contrast the `reason` on `invalid-widget-config` and
`invalid-widget-structure` is the opaque string a plugin supplied through
`addDiagnostic` (see [Error taxonomy](#error-taxonomy)). A source-level
diagnostic (`json-incompatible-value`, `source-access-failed`) has the
location `{ type: 'source' }` and is never copied onto a node's `.diagnostics`.

A diagnostic's `location` is one of `{ type: 'source' }`,
`{ type: 'widget', node }`, `{ type: 'slot', node, slot }`,
`{ type: 'slot-child', node, slot, index }`, `{ type: 'property', node, name }`
or `{ type: 'method', node, name }`.

**Order.** `blueprint.diagnostics` lists the node-local diagnostics (identity,
config, slot and `unexpected-widget-field` facts) in a post-order walk of the
source tree, so a child's diagnostics come before its parent's. After those come
`duplicate-widget-id`, then the whole-source JSON diagnostics
(`json-incompatible-value`, `source-access-failed`), then the
`invalid-widget-structure` diagnostics, then the dependency diagnostics. The
Runtime's aggregate order is different (see
[Runtime diagnostics](#runtime-diagnostics)): it follows the semantic pre-order
of widgets.

<!-- sample: blueprint-diagnostics run -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

const boxPlugin = createWidgetPlugin('box')
	.description('A box')
	.interfaces<{ slots: 'items' }>()
	.slots({ items: { description: 'Items' } })
	.done()
const system = createWidgetSystem({ plugins: [boxPlugin] })

const blueprint = system.createBlueprint({
	id: 'root',
	type: 'box',
	label: 'oops', // not a recognized key; extension data belongs under `meta`
	slots: { items: [{ id: 'gone', type: 'removed-plugin' }] },
})

for (const diagnostic of blueprint.diagnostics) {
	const node = 'node' in diagnostic.location ? diagnostic.location.node : blueprint.root
	console.log(diagnostic.code, blueprint.getSourcePath(node))
}
// unknown-widget-type [ 'slots', 'items', 0 ]
// unexpected-widget-field []
```

`EMPTY_DIAGNOSTICS` (exported from the root) is the shared frozen empty
diagnostics array that a valid Blueprint's `diagnostics`, a node without
diagnostics, and a Runtime snapshot without diagnostics return.

### Status and recompilation

```ts
type WidgetSystemBlueprintStatus = 'valid' | 'invalid'
```

Only `status === 'valid'`:

- narrows every node query to resolved nodes
- narrows `.diagnostics` to an empty array (a valid Blueprint always has an empty
  diagnostic snapshot, because validity means no diagnostic of any kind)
- types `source` as the System's authored source type (`WidgetSource<Plugins>`)
- exposes `createRuntime(options?)`

`sourceJsonCompatible` is the authored JSON-domain proof. In its positive
branch, `blueprint.source` and source fragments on all recovered navigation
outputs carry `JsonValue`; the false branch keeps the exact source as
`unknown`. False means either confirmed incompatibility or an unproven safe
inspection; aggregate Blueprint diagnostics distinguish `json-incompatible-value`
from `source-access-failed`. Source-level diagnostics are not copied onto node
`.diagnostics`. A valid Blueprint requires semantic validity and this proof, so
Runtime creation never promotes non-JSON authored material.

```ts
if (blueprint.status !== 'valid') {
	// inspect blueprint.diagnostics — no createRuntime here
}
else {
	const runtime = blueprint.createRuntime()
}
```

Editing is recompiling, not mutating:

```ts
const next = blueprint.recompile(nextSource)
// equivalent to: blueprint.system.createBlueprint(nextSource)
```

### WidgetDocument and SourcePatch

`createWidgetDocument({ system, source })` keeps the current source and its
compiled Blueprint together behind a monotonically increasing revision. A
`SourcePatch` uses one JSON-domain RFC6901/RFC6902 language: paths may be JSON
Pointer strings or structured string/number segments, operands are `JsonValue`,
and successful patches use copy-on-write reconstruction. Mechanical failure
is atomic; a mechanically successful patch may still commit a semantically
invalid Blueprint for inspection.

A patch is a readonly array of operations (`SourcePatchOperation`); a path
(`SourcePath`) is a JSON Pointer string or an array of string/number segments:

| Operation | Shape |
|---|---|
| add | `{ op: 'add', path, value }` |
| remove | `{ op: 'remove', path }` |
| replace | `{ op: 'replace', path, value }` |
| move | `{ op: 'move', from, path }` |
| copy | `{ op: 'copy', from, path }` |
| test | `{ op: 'test', path, value }` |

<!-- sample: document-patch run -->
```ts
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

`createWidgetDocument` retains `source` by reference as revision 0's
`blueprint.source`, so the ownership rule in [Core model](#core-model) applies.
`applyPatch` never mutates the accepted source in place. It structurally
copies the operands of explicit `add`/`replace` operations, but each new
revision **shares** untouched subtrees with the previous one (copy-on-write),
so any revision can share structure with the original construction input.
Mutating that input therefore corrupts later revisions as well as revision 0.
A host that keeps its own editable model should copy it before constructing a
`WidgetDocument`.

`applyPatch(patch, options?)` returns `{ ok: true, changed }` or
`{ ok: false, failure }` (the failure union is exported as `ApplyPatchFailure`).
A patch that leaves the source equal returns `{ ok: true, changed: false }`: the
revision does not advance and subscribers are not notified. Equality is
JSON-domain equality (numbers by SameValueZero), independent of object
prototypes. A changing patch compiles the next Blueprint once after all
operations succeed, commits it at `revision + 1`, then notifies subscribers.
`failure.code` is one of:

- `reentrant-apply`: `applyPatch()` was called while the Document was applying
  or notifying (for example from a subscriber). It is checked first.
- `document-revision-conflict`: `options.expectedRevision` was supplied and
  differs from the current revision. The failure carries `expectedRevision` and
  `actualRevision`. Omitting `options` skips this check, and the check runs
  before any operation is evaluated.
- An operation failure `{ code, operationIndex, message }`, where `code` is
  one of the codes below and `operationIndex` is the failing operation's
  position in the patch (`0` when the patch itself is malformed). A failed patch
  leaves the committed source and revision unchanged.

  | `code` | Meaning |
  | --- | --- |
  | `invalid-operation` | the patch is not an array, an operation is not an object, or its `op` is unknown |
  | `invalid-path` | a malformed path only (for example a JSON Pointer without a leading `/` or with a bad `~` escape, or a non-finite number segment) |
  | `max-depth-exceeded` | a path with more than `MAX_JSON_DEPTH + 2` segments (the longest source path of a node a Blueprint materializes), or a `copy`/`move` source value nested deeper than `MAX_JSON_DEPTH` |
  | `path-not-found` | the path does not identify an existing location |
  | `path-not-traversable` | the path passes through a non-traversable value |
  | `invalid-array-index` | an Array parent was addressed by anything other than an in-bounds canonical index (see below) |
  | `invalid-move-target` | a `move` into its own descendant |
  | `test-failed` | a `test` operand did not match the addressed value |
  | `json-incompatible-value` | an `add`/`replace`/`test` `value` is outside Core's JSON domain (missing or `undefined`, functions, `bigint`, symbols, `NaN`/`±Infinity`, cycles, non-plain prototypes, sparse or extra-property Arrays, accessors, symbol keys, nesting deeper than `MAX_JSON_DEPTH`, or reflection that throws); checked after path parsing and before the operation is evaluated. The failure also carries an optional `path` (where in the operand, `[]` for the operand itself) and `reason` (the same closed enum as the Blueprint diagnostic) |
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
committed (`changed: true`) patch it receives `(snapshot, { previous, patch })`:
the new snapshot, the snapshot it replaced, and the exact patch array that was
applied. Listeners run in subscription order, over the subscriber list as it
stood when notification began. An exception thrown by a listener does not fail
`applyPatch()` or stop the remaining listeners, and it is reported outside
`applyPatch()` in a queued microtask (see [Host requirements](#host-requirements)).

### Explicit separated-source tooling

`WidgetSource` remains the canonical nested authored form. Core also exports an
explicit `SeparatedWidgetSource` projection with a nested `structure` tree and
a flat `widgets` data list (`{ id, type, config?, meta? }` per widget). This
representation is tooling only; Core never auto-detects it at the `unknown`
Blueprint or Document recovery boundary.

`separateWidgetSource(source: unknown)` never throws. It returns
`{ separated, diagnostics }`: `separated` is `null` only when the root cannot be
projected at all, and an empty `diagnostics` array guarantees a lossless round
trip through `normalizeSeparatedWidgetSource`. `meta` is carried. Its
diagnostics locate the problem in the nested input with
`{ area: 'source', path }`.

<!-- sample: separated-source run -->
```ts
import { normalizeSeparatedWidgetSource, separateWidgetSource } from '@deviltea/widget-core'

const canonical = {
	id: 'panel-1',
	type: 'panel',
	meta: { note: 'kept' },
	slots: { content: [{ id: 'counter-1', type: 'counter', config: { step: 2 } }] },
}

const { separated, diagnostics } = separateWidgetSource(canonical)
console.log(diagnostics.length) // 0: nothing was lost

if (separated !== null) {
	const normalized = normalizeSeparatedWidgetSource(separated)
	console.log(normalized.diagnostics.length) // 0
	console.log(JSON.stringify(normalized.source) === JSON.stringify(canonical)) // true
}

// Malformed input is reported, never thrown.
const bad = separateWidgetSource({ id: 'x', type: 't', extra: true, slots: { items: 'nope' } })
console.log(bad.diagnostics.map(d => d.code)) // [ 'invalid-separated-widget', 'invalid-separated-structure' ]
console.log(separateWidgetSource(42).separated) // null
```

The normalizer is deterministic, non-destructive, and best-effort. The first
flat entry for a Widget ID wins; missing data creates a partial nested node;
unused data is diagnosed rather than guessed into the tree; and repeated
structural IDs retain their available data/subtree while the later occurrence
is de-identified. These representation diagnostics are separate from Blueprint
semantic diagnostics and carry a location with `area: 'structure'`,
`area: 'widgets'` (its `index` is optional: it is absent when the fact concerns
the whole `widgets` value) or, from `separateWidgetSource`, `area: 'source'`.

| `code` | Reported when | Extra fields |
|---|---|---|
| `invalid-separated-source` | the input is missing `structure` (`reason: 'missing-structure'`) or `widgets` is not an array (`'invalid-widgets'`) | `reason` |
| `invalid-separated-structure` | a structure node is invalid | `reason`: `'invalid-node'`, `'invalid-slots'`, `'invalid-slot-children'` or `'max-depth-exceeded'` |
| `invalid-separated-widget` | a flat entry is invalid | `reason`: `'invalid-entry'`, `'invalid-id'`, `'invalid-type'`, `'invalid-config'`, `'invalid-meta'` or `'unexpected-field'` |
| `duplicate-widget-id` | the flat `widgets` list has more than one entry for an id, or the nested source given to `separateWidgetSource` repeats an id | `widgetId` |
| `missing-widget-data` | a structure id has no flat entry | `widgetId` |
| `unused-widget-data` | a flat entry's id is not in the structure | `widgetId` |
| `duplicate-structure-id` | an id appears more than once in the structure | `widgetId` |

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
ordinary `invalid-state-value` diagnostic. `createRuntime` never fails: malformed
override input still produces a Runtime, and each problem is recorded as a
Runtime-level diagnostic (location `{ type: 'runtime' }`):

| `code` | Reported when | `path` |
|---|---|---|
| `invalid-state-overrides` | `overrideStateDefaults` itself is not a usable record | none |
| `unknown-state-override-widget` | a key is not the id of a resolved widget | `[widgetId]` |
| `unsupported-state-override-target` | the widget exists but has no state capability | `[widgetId]` |
| `invalid-state-override-fragment` | a widget's entry is not a record of State members | `[widgetId]` |
| `unknown-state-override-member` | a key in a widget's entry is not one of its State members | `[widgetId, key]` |

Every other usable fragment still initializes independently.
`overrideStateDefaults` does not consult `authorWritable`: any declared State
member can be overridden (see
[Member declaration facts](#member-declaration-facts-and-value-contracts)).

`runtime.getWidget(id)` returns a `RuntimeWidget | null` distributed over the
registered plugin tuple. When more than one plugin is registered, narrow on
`widget.type` before accessing plugin-specific `state` / `properties` /
`methods` / `events` — there is no `getWidget(id, type)` helper.

#### Reusing a Runtime: `resetState()`

```ts
runtime.resetState() // every widget
widget.resetState() // one widget with a state capability
```

Hosts that evaluate many independent inputs against one Blueprint (server-side
validation, batch checks) can keep one Runtime and reset it between inputs
instead of calling `createRuntime()` each time. `resetState()` restores every
State member of every widget to its initialization outcome: the same value and
the same diagnostic snapshot the member had when this Runtime was created,
including `overrideStateDefaults` and a default that failed validation. It
does not run `validate` again, so a validator never needs to accept a
placeholder value only to support resets. `widget.resetState()` does the same
for that one widget (it exists on every widget with a state capability).

All restored writes form one batch: dependents recompute once, and State
subscribers are notified only for members whose value changed. Property and
Method diagnostic snapshots are not reset; Properties re-evaluate through
ordinary invalidation, so every value read after a reset equals the value a
freshly created Runtime would return for the same subsequent writes. The
restored value is the *same reference* the member initialized with (see
[State](#state)). After `dispose()`, `resetState()` throws
`WidgetSystemRuntimeDisposedError`.

#### Snapshotting state: `snapshotState()`

```ts
const saved = runtime.snapshotState() // Record<WidgetId, Record<string, unknown>>
const copy = blueprint.createRuntime({ overrideStateDefaults: saved })
```

`runtime.snapshotState()` returns a fresh plain object holding the current value
of every State member, keyed by widget id and then member key. Members whose
value is `null` are omitted, and so are widgets left with no entry. The shape is
exactly what `overrideStateDefaults` accepts, so the result can seed another
Runtime directly (see [Persisted documents](#persisted-documents)). The object is
owned by the caller, but the values inside it are the Runtime's own references,
not clones. It throws `WidgetSystemRuntimeDisposedError` after `dispose()`.

### Runtime State

```ts
widget.state.count.get() // T | null — a direct read, not an ExecutionResult
widget.state.count.set(5) // ExecutionResult<number, RuntimeStateDiagnostic>
widget.state.count.subscribe(listener) // listener: (value: T | null) => void
widget.state.count.getDiagnostics()
widget.state.count.subscribeDiagnostics(listener)
```

- An invalid `set()` preserves the previously accepted value and returns
  `{ ok: false, failure: { diagnostics } }`; a successful `set()` commits the candidate
  and clears the latest diagnostic snapshot.
- Change detection is strict `!==`: writing `NaN` again still counts as
  changed (`NaN !== NaN` is `true`), while `+0` and `-0` count as unchanged. See
  [State](#state) for what this means for objects and arrays.
- Subscriptions never emit immediately upon subscribing.

#### Writing from a listener

A listener may call `set()` or a Method. The write takes effect immediately
(a following `get()` returns it), and Core guarantees only this much about
notification:

- Every subscriber is notified at most once per flush, with the value that is
  current when it runs; notifications are not a log of every intermediate
  write. A subscriber can observe `2` without ever being called with the `1`
  that a listener wrote and then replaced.
- Once the outermost write or Method call has returned, every subscriber whose
  value changed has been scheduled; the order **between different subscribers**
  is not part of the contract (today it follows subscription order).
- A listener that writes the member it observes is not guaranteed to be called
  again for its own write, so its argument can be stale after it writes. Read
  the current value with `get()` when it matters, or defer the write (for
  example to a microtask) so the write is an ordinary top-level operation.
- A listener that throws never affects the write that triggered it or any other
  listener (see [Runtime diagnostics](#runtime-diagnostics) for where the error
  is reported).

### Runtime Properties

```ts
widget.properties.doubled.get() // ExecutionResult<T, RuntimePropertyDiagnostic>
widget.properties.doubled.subscribe(listener) // listener: (result) => void
widget.properties.doubled.getDiagnostics()
widget.properties.doubled.subscribeDiagnostics(listener)
```

Properties are lazily evaluated and cached through `alien-signals`.
`subscribe()` activates observation but never emits immediately; every
*actual* completed recompute notifies exactly once, even when the recomputed
value compares equal to the previous one. `subscribeDiagnostics()` observes a
separate diagnostic channel and never triggers a property evaluation.

A `compute` that **throws** (an implementation exception, not a Diagnostic)
never breaks the writer that invalidated it: `state.set`, a Method call and
`resetState()` return normally, and the other subscribers are still notified.
Core reports the exception asynchronously (a queued microtask, see
[Host requirements](#host-requirements)), once per synchronous turn even when
several subscriptions (the Property's own and its dependents') re-read it; that
subscription is skipped for this recompute and resumes on the next completed
recompute. A direct `get()` and a dependency read of the Property still rethrow
synchronously, and `subscribe()` whose first evaluation throws still returns a
live handle. The exception stays the Property's cached outcome until a
dependency changes, so reads in between rethrow it without running `compute`
again.

A long chain of Properties that each depend on the previous one is not bounded
by the engine stack when it is read: Core limits how deeply Property
evaluations nest and completes the rest of the chain in a loop, so within one
read a `compute` may run more than once. See
[Call-stack depth](#call-stack-depth) for the cost and for the limits that
remain. An engine stack overflow can still happen, for example when the host
itself calls from a deep stack. It is the one exception that is not kept as a
cached outcome: it reflects how deep the read was, not the Property's inputs, so
a later read evaluates again.

### Runtime Methods

```ts
widget.methods.increment() // ExecutionResult<number, RuntimeMethodDiagnostic>
widget.methods.increment.getDiagnostics()
widget.methods.increment.subscribeDiagnostics(listener)
```

Every invocation runs `validateArgs` before `execute`; on failure, `execute`
never runs and the result carries an `invalid-method-arguments` diagnostic. A successful
`execute` whose plugin/dependency diagnostics were still recorded becomes a
failure with an `invalid-method-result` diagnostic attached — the returned value in that
case is diagnostic context only, never a degraded ok value. The ok value is
typed exactly as the Method declares (a `void` Method has `{ ok: true,
value: undefined }`). Only Method and Property results are frozen.

Every `RuntimeMethod` invocation opens a batch boundary around its
dependency/state writes (including dependency-invoked methods, which nest);
only the outermost invocation flushes propagation. A Method invoked while
another Runtime operation is in progress (from a Property evaluation through a
declared dependency, or from a listener) does not notify subscribers on its own:
they are notified later in the same outermost operation, after the Method has
returned and before the host's own call into the Runtime returns. Batching means
propagation atomicity, not a transaction: writes performed before a later
failure or a thrown callback remain committed, and the batch still ends via
`finally`.

A Method that recurses without bound (a valid Method-to-Method cycle) surfaces
as a `RangeError` to the caller. Core's reactive state, in this Runtime and in
any other, stays consistent and usable afterwards.

### Events

An Event is a public semantic notification declared by the plugin. Its
arguments are a typed tuple in the plugin's `events` interface, and each
declared member carries a `description`. The `counter` in the
[Quick start](#quick-start) declares `changed: [count: number]` and emits it from
`increment`, which lists it in `emits`. A self-contained example with a second plugin registered, so that
`getWidget` returns a union that must be narrowed on `type`:

<!-- sample: events run -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

interface NotifierInterfaces {
	methods: { fire: (value: string) => void }
	events: { change: [value: string] }
}

const notifierPlugin = createWidgetPlugin('notifier')
	.description('A notifier widget')
	.interfaces<NotifierInterfaces>()
	.methods(methods =>
		methods.fire({
			validateArgs: (args): args is [string] =>
				args.length === 1 && typeof args[0] === 'string',
			emits: ['change'],
			execute: ({ args, emit }) => emit.change(args[0]),
		}),
	)
	.events(events => events.change({ description: 'Changed value' }))
	.done()

// A second plugin: with more than one plugin registered, `getWidget` returns a union.
const labelPlugin = createWidgetPlugin('label')
	.description('A label widget')
	.interfaces<{ state: { text: string } }>()
	.state(state => state.text({
		validate: (input): input is string => typeof input === 'string',
		default: () => '',
	}))
	.done()

const system = createWidgetSystem({ plugins: [notifierPlugin, labelPlugin] })
const blueprint = system.createBlueprint({ id: 'notifier-1', type: 'notifier' })
if (blueprint.status !== 'valid')
	throw new Error('invalid')

const runtime = blueprint.createRuntime()
const widget = runtime.getWidget('notifier-1')
if (widget?.type !== 'notifier') // narrow the union before using `events` / `methods`
	throw new Error('notifier-1 is not a notifier')

const received: string[] = []
// Isolated listener errors are rethrown in a microtask; in Node they arrive as uncaught exceptions.
process.on('uncaughtException', error => console.log('reported:', (error as Error).message))
widget.events.change.subscribe(() => {
	throw new Error('a faulty listener') // isolated: reported asynchronously, never reaches `fire`
})
const unsubscribe = widget.events.change.subscribe((value) => {
	received.push(value) // still runs after the faulty listener
})

console.log(widget.methods.fire('hello').ok) // true: the emitting Method completed
console.log(received) // [ 'hello' ]
unsubscribe()
runtime.dispose()
```

- Consumers subscribe through `runtime.getWidget(id).events[name].subscribe(listener)`,
  which returns an unsubscribe function. A public event surface is
  subscribe-only.
- Emit authority belongs to Widget implementation contexts: the `emit` object
  passed to a Method's `execute`, limited to the Events that Method lists in
  its `emits` (see [Methods](#methods)), and renderer adapters through
  [`@deviltea/widget-core/integration`](#renderer-adapter-integration).
- A Method that declares an Event in `emits`, and a Method that invokes one, is
  not read-only, so no Property may depend on it: reading a Property never emits
  an Event. Compared with `0.0.6`, where the compiler treated a Method that only
  emits as read-only, a Property could depend on it, and a read that evaluated
  the Property emitted the Event (the first `get()` did, a second `get()` with
  nothing changed did not), so whether a read emitted depended on caching and
  on subscriptions.
- A Method's `emit` works only while that Method's own callback is the
  innermost running callback. An `emit` that one Method retained does not work
  while a different Method of the same widget runs, even one that declares the
  same Event (see [Callback context lifetime](#callback-context-lifetime)).
- Argument types are checked by TypeScript only; there is no runtime payload
  validation.
- Delivery is synchronous. A nested emit is delivered depth-first, and the
  public listener list is snapshotted when `emit` starts.
- A public listener that throws is isolated like every other listener: the
  remaining listeners captured at emit start still run, the emitting Method
  completes normally, and the error is reported asynchronously (see
  [Host requirements](#host-requirements)).
- A listener may call a Method that emits again, a few levels deep. A loop that
  never ends — a listener that keeps re-invoking the Method that emitted — is
  cut off by a safety guard: when one Runtime's emits nest more than 128 levels
  deep, the next `emit` throws `WidgetSystemRuntimeReentrancyError` (a
  `RangeError`, `code: 'emit-depth-exceeded'`). That error, and an engine stack
  overflow raised inside a listener, are the only exceptions Event listener
  isolation does not swallow: every emit of the Runtime still on the stack
  rethrows it, even if listener code caught it, so it reaches the call that
  started the loop after work proportional to the depth. The guard bounds work;
  it does not make any Blueprint invalid. 128 levels is generous for real
  re-entrancy (an event bubbled through the deepest widget tree `MAX_JSON_DEPTH`
  admits, one Method per level, fits) and far below the roughly 650 nested
  emits at which a minimal loop exhausts Node's default stack.
- Subscriptions are scoped to the Runtime and cleared by `runtime.dispose()`.
  Calling `emit` after disposal throws `WidgetSystemRuntimeDisposedError`.
- Events are host-facing. A widget's callbacks cannot subscribe to an Event, and
  an Event can never be the target of a dependency (`registerDeps` offers only
  State, Properties and Methods). To make one widget react to another, depend on
  its State or Property, or let the host subscribe to the Event and call a Method.

Events can additionally be observed passively through
[Runtime inspection](#runtime-inspection) (`getEvent(name)`).

### Runtime diagnostics

Every state write, property evaluation, and method invocation keeps only its
**latest completed** operation's diagnostic snapshot — never a history. A
callback throw discards the in-progress collector and preserves the previous
completed snapshot; it is an implementation exception, not a diagnostic and not
an `ExecutionResult.failure`.

A primitive's diagnostics use these codes. The one a plugin callback produces
is decided by the callback, not by the plugin: a `reason` string a plugin
supplies through `addDiagnostic` is carried verbatim and never defines a code.

| `code` | Owner | Reported when | Extra fields |
|---|---|---|---|
| `invalid-state-value` | State member | a candidate (default, override, or `set()`) failed `validate` | `candidate`, `path?`, `reason?` |
| `invalid-property-result` | Property | `compute` reported a diagnostic through `addDiagnostic` | `result`, `path?`, `reason?` |
| `invalid-method-arguments` | Method | `validateArgs` returned `false` or reported a diagnostic | `args`, `path?`, `reason?` |
| `invalid-method-result` | Method | `execute` reported a diagnostic, or a dependency failed during the call | `result`, `path?`, `reason?` |
| `dependency-target-failed` | Property or Method | a dependency the callback used failed | `dependency`, `related`, `cause` |
| `dependency-value-rejected` | Property or Method | a `.validate()` refinement rejected a dependency's value | `dependency`, `related`, `received` |

Runtime-level diagnostics (location `{ type: 'runtime' }`) come only from
`createRuntime`'s `overrideStateDefaults` (the five codes listed in
[Creating a runtime](#creating-a-runtime)).

Every `RuntimeWidget` also exposes its own aggregate, present regardless of
declared capabilities:

```ts
widget.getDiagnostics() // readonly RuntimeWidgetDiagnostic[]
widget.subscribeDiagnostics(listener)
```

`RuntimeWidgetDiagnostic` is the union of only that widget's own primitive-owned
diagnostics (`RuntimeStateDiagnostic | RuntimePropertyDiagnostic | RuntimeMethodDiagnostic`) —
never a Runtime-level diagnostic, even when a diagnostic mentions the same
`widgetId`. The snapshot order is deterministic: state members -> property
members -> method members, plugin declaration order within each capability,
and each primitive's own local diagnostic order preserved. A widget with no
capabilities, or with every primitive currently succeeding, aggregates to
`[]`.

```ts
runtime.getDiagnostics() // Runtime-level diagnostics, then each widget's snapshot in Blueprint semantic order
runtime.subscribeDiagnostics(listener)
```

The Runtime aggregate lists widgets in the Blueprint's semantic pre-order (a
parent before its children). That differs from `blueprint.diagnostics`, which
is a post-order walk followed by the duplicate, JSON, structure and dependency
phases (see [Diagnostics](#diagnostics)). The aggregate is incremental:
repeated `getDiagnostics()` calls return the same cached snapshot while nothing
has changed.

**What the aggregate does and does not contain.** It reports the latest
completed diagnostics of each primitive, and a Property is lazy: its
diagnostics exist only once it has been evaluated. A freshly created Runtime
therefore reports no Property diagnostics, and a Property nobody read is
invisible, even if reading it would fail. `resetState()` deliberately does not
clear retained Property or Method diagnostics either, so a retained diagnostic
can describe a state that has since been reset until the Property is
re-evaluated.

To validate a Runtime headlessly (a server-side check, a test), read every
Property you rely on first, then read the aggregate:

<!-- sample: headless run -->
```ts
import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { inspectRuntime } from '@deviltea/widget-core/inspection'

interface ScoreInterfaces {
	state: { score: number }
	properties: { grade: string }
}

const scorePlugin = createWidgetPlugin('score')
	.description('A score with a derived grade')
	.interfaces<ScoreInterfaces>()
	.state(state => state.score({
		validate: (input): input is number => typeof input === 'number',
		default: () => -1,
	}))
	.properties(properties => properties.grade({
		registerDeps: ({ dep }) => ({ score: dep.self.state.get('score') }),
		compute: ({ deps, addDiagnostic }) => {
			const score = deps.score()
			if (score.ok && (score.value ?? 0) < 0)
				addDiagnostic({ message: 'The score must not be negative.', reason: 'negative-score' })
			return 'ok'
		},
	}))
	.done()

const system = createWidgetSystem({ plugins: [scorePlugin] })
const blueprint = system.createBlueprint({ id: 'score-1', type: 'score' })
if (blueprint.status !== 'valid')
	throw new Error('invalid')
const runtime = blueprint.createRuntime()

console.log(runtime.getDiagnostics().length) // 0: the Property has not been evaluated yet

// Read every Property, then the aggregate. The inspection surface only enumerates the members.
function collectDiagnostics(runtime: WidgetSystemRuntime) {
	for (const node of inspectRuntime(runtime).blueprint.nodes) {
		if (!node.resolved)
			continue
		const widget = runtime.getWidget(node.node.id)
		if (widget !== null && 'properties' in widget) {
			for (const { name } of node.properties)
				(widget.properties as Record<string, { get: () => unknown }>)[name]!.get()
		}
	}
	return runtime.getDiagnostics()
}

console.log(collectDiagnostics(runtime)
	.map(d => d.code)) // [ 'invalid-property-result' ]

runtime.resetState() // does not clear Property or Method diagnostics
console.log(runtime.getDiagnostics().length) // 1: the latest Property diagnostic is retained
```

#### Dependency failures fail the consumer

When a Property's `compute` or a Method's `execute` reads, writes or invokes
a dependency that fails (`dependency-target-failed`) or whose value fails a
`.validate()` refinement (`dependency-value-rejected`), Core adds a
consumer-local dependency diagnostic to the consumer's **active** diagnostic
collector at the moment of the call. The callback still receives the failed
`ExecutionResult` and may continue, for example by computing a fallback value.
That does not make the consumer's operation successful:

- a Property whose evaluation recorded any diagnostic returns
  `{ ok: false, failure }`, and the computed fallback value is not exposed as
  `value`;
- a Method whose invocation recorded any diagnostic returns a failure with an
  `invalid-method-result` diagnostic, as described in [Runtime Methods](#runtime-methods).

Handling a failed dependency therefore never hides it. To succeed without the
dependency, the consumer must avoid the failing call; for a target that may be
absent, declare the dependency `.optional()`. `ctx.hasAnyDiagnostic()` tells
the callback whether its current operation has already recorded a diagnostic.

`RuntimeWidget.getDiagnostics()` / `subscribeDiagnostics()` and
`WidgetSystemRuntime.getDiagnostics()` / `subscribeDiagnostics()`
read diagnostic signals only and never activate property evaluation. The aggregate may legitimately list both a failing
primitive's own diagnostic and a consumer's wrapped dependency diagnostic that points back at it — that is causal context,
not duplication.

### Disposal

```ts
runtime.dispose() // idempotent
runtime.subscribeDisposal(listener) // returns an idempotent unsubscribe function
```

After disposal, `runtime.isDisposed` and `runtime.blueprint` remain readable,
and previously obtained `RuntimeWidget.id` / `.type` / `.blueprintNode` stay
readable. Every live query/operation (`runtime.getWidget`, state/property
reads and writes, method invocations, `runtime.snapshotState()`, `resetState()`,
`RuntimeWidget.getDiagnostics()`) and every
*new* subscription (including `RuntimeWidget.subscribeDiagnostics()`) throws
`WidgetSystemRuntimeDisposedError`; previously returned unsubscribe functions
remain safe, idempotent no-ops. Disposal sends no State, Property, Event or
diagnostic notification and creates no diagnostic. A dependency or `emit`
callable used after disposal throws the same error.

The error's `code` is `'runtime-disposed'`.

<!-- sample: disposed run -->
```ts
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '@deviltea/widget-core'

const plugin = createWidgetPlugin('note')
	.description('A note widget')
	.interfaces<Record<never, never>>()
	.done()
const blueprint = createWidgetSystem({ plugins: [plugin] })
	.createBlueprint({ id: 'note-1', type: 'note' })
if (blueprint.status !== 'valid')
	throw new Error('invalid')

const runtime = blueprint.createRuntime()
runtime.dispose()

try {
	runtime.getWidget('note-1')
}
catch (error) {
	if (error instanceof WidgetSystemRuntimeDisposedError) {
		// `instanceof` is the stable discriminator; `error.code` is 'runtime-disposed'.
		console.log(error.code)
	}
}
```

`runtime.subscribeDisposal(listener)` is the one disposal signal. A host that
owns asynchronous work (a request, a timer, a worker) uses it to cancel that
work when the Runtime goes away:

- Each listener runs exactly once, synchronously, inside the first `dispose()`
  call, with no arguments. Later `dispose()` calls do nothing.
- By then the Runtime is already fully disposed: `runtime.isDisposed` is
  `true` and every Runtime-owned subscription is torn down. A live operation
  attempted from the listener throws `WidgetSystemRuntimeDisposedError`,
  `runtime.dispose()` does nothing, and the metadata listed above stays
  readable. A listener cancels the host's own work; it cannot read or write the
  Runtime.
- Listeners run in subscription order. Delivery uses the list as it stood when
  disposal began, as Event delivery does: a listener unsubscribed meanwhile
  still runs, and none can be added meanwhile, because subscribing to a
  disposed Runtime throws.
- A throwing listener never reaches the `dispose()` caller and never stops the
  remaining listeners; like every other listener exception it is reported
  asynchronously (see [Host requirements](#host-requirements)).
- `subscribeDisposal()` on an already disposed Runtime throws
  `WidgetSystemRuntimeDisposedError`; the listener is never invoked
  immediately, so check `runtime.isDisposed` first when the Runtime may already
  be gone.
- The returned unsubscribe function is idempotent and safe before or after
  disposal; once the listener has run it does nothing. Registering the same
  function twice makes two independent registrations.
- The Runtime keeps no reference to a listener once it has run.

<!-- sample: disposal-listener run -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

const plugin = createWidgetPlugin('profile')
	.description('A profile widget')
	.interfaces<{ state: { title: string } }>()
	.state(state => state
		.title({ validate: (input): input is string => typeof input === 'string' }))
	.done()
const blueprint = createWidgetSystem({ plugins: [plugin] })
	.createBlueprint({ id: 'profile-1', type: 'profile' })
if (blueprint.status !== 'valid')
	throw new Error('invalid')

const runtime = blueprint.createRuntime()

// The host owns the pending work; the Runtime only tells it when to stop.
const controller = new AbortController()
runtime.subscribeDisposal(() => controller.abort())

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, milliseconds)
		signal.addEventListener('abort', () => {
			clearTimeout(timer)
			reject(signal.reason)
		}, { once: true })
	})
}

async function loadTitle(): Promise<void> {
	try {
		await pause(1000, controller.signal)
		runtime.getWidget('profile-1')?.state.title.set('Ada')
	}
	catch {
		console.log('loading cancelled')
	}
}

const loading = loadTitle()
runtime.dispose() // aborts the pending work synchronously
await loading
```

## Renderer adapter integration

`@deviltea/widget-core/integration` is a deliberately narrow adapter-only subpath.
It is not re-exported from the package root. Renderer integrations use
`getWidgetEventEmitter(runtime, widget)` to obtain scoped Event emit authority;
ordinary Runtime consumers remain subscribe-only. It returns `null` when the
widget's plugin declares no `events` capability.

Passing a `RuntimeWidget` from a different Runtime instance is rejected with a
stable coded integration exception (`runtime-widget-mismatch`):

<!-- sample: integration run -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import {
	getWidgetEventEmitter,
	WidgetIntegrationError,
} from '@deviltea/widget-core/integration'

const buttonPlugin = createWidgetPlugin('button')
	.description('A button widget')
	.interfaces<{ events: { press: [] } }>()
	.events(events => events.press({ description: 'The button was pressed' }))
	.done()
const labelPlugin = createWidgetPlugin('label')
	.description('A label widget')
	.interfaces<Record<never, never>>()
	.done()

const system = createWidgetSystem({ plugins: [buttonPlugin, labelPlugin] })
function createRuntime(id: string, type: 'button' | 'label') {
	const blueprint = system.createBlueprint({ id, type })
	if (blueprint.status !== 'valid')
		throw new Error('invalid')
	return blueprint.createRuntime()
}

const runtime = createRuntime('b', 'button')
const button = runtime.getWidget('b')
if (button?.type !== 'button')
	throw new Error('missing')

button.events.press.subscribe(() => console.log('pressed'))
getWidgetEventEmitter(runtime, button)
	?.press() // pressed

// A widget without an events capability has no emitter.
const labelRuntime = createRuntime('l', 'label')
const label = labelRuntime.getWidget('l')
console.log(label !== null && getWidgetEventEmitter(labelRuntime, label)) // null

// A widget that belongs to another Runtime is rejected with a coded error.
try {
	getWidgetEventEmitter(createRuntime('b', 'button'), button)
}
catch (error) {
	if (error instanceof WidgetIntegrationError && error.code === 'runtime-widget-mismatch')
		console.log(error.code) // runtime-widget-mismatch
}
```

A Runtime that was not produced by this loaded module instance (another module
instance or a structural look-alike) is rejected with code `foreign-runtime`
before any pairing check. Pairing is then validated against Core-owned state,
never the caller-supplied objects' public shape.

`assertCoreRuntime(runtime)` performs only that provenance check: it throws
`WidgetIntegrationError` with code `foreign-runtime` unless `runtime` was
produced by this loaded copy of Core, and otherwise returns nothing. It is
passive — it reads no Runtime state, grants no emit authority, and also accepts a
disposed Runtime — so an adapter can call it when it mounts to fail fast when the
application and the adapter resolved two different copies of
`@deviltea/widget-core`:

<!-- sample: integration-assert run -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { assertCoreRuntime, WidgetIntegrationError } from '@deviltea/widget-core/integration'

const plugin = createWidgetPlugin('label')
	.description('A label widget')
	.interfaces<Record<never, never>>()
	.done()
const blueprint = createWidgetSystem({ plugins: [plugin] })
	.createBlueprint({ id: 'l', type: 'label' })
if (blueprint.status !== 'valid')
	throw new Error('invalid')

assertCoreRuntime(blueprint.createRuntime()) // passes: produced by this copy of Core

try {
	assertCoreRuntime({ getWidget: () => null }) // a structural look-alike
}
catch (error) {
	if (error instanceof WidgetIntegrationError)
		console.log(error.code) // foreign-runtime
}
```

The error message is descriptive only; consumers discriminate by class and
`code`. Runtime disposal continues to use `WidgetSystemRuntimeDisposedError`
rather than being wrapped as an integration error.

### Writing an adapter

A renderer adapter (such as `@deviltea/widget-vue`) consumes a Runtime and
should rely only on the following, which is what the current implementation
provides and which Core's own tests exercise:

- **Stable identities.** `runtime.getWidget(id)` returns the same object every
  time. While nothing has changed, repeated reads return identical references:
  a Property's `get()` result, every `getDiagnostics()` snapshot (primitive,
  widget and Runtime aggregate). After a write that changes a Property's value,
  its `get()` returns a new result object. An adapter may therefore use
  reference equality as a cheap "changed" check for these snapshots. The
  guarantee is the implemented behavior, not a promise that a recompute with an
  equal value reuses the old object.
- **`subscribe()` evaluates.** Subscribing to a Property evaluates it
  immediately (it activates the dependency graph) but never calls your listener
  for that first evaluation, so read the current value with `get()` yourself
  when you subscribe. `subscribeDiagnostics()` and Event subscriptions never
  evaluate anything. Subscribing to State, Properties or diagnostics does not
  emit an initial value either.
- **Disposal.** Core does not notify State, Property, Event or diagnostic
  subscribers when a Runtime is disposed (their listeners just stop being
  called). An adapter that can outlive its Runtime learns of disposal through
  `runtime.subscribeDisposal()` (see [Disposal](#disposal)), and checks
  `runtime.isDisposed` before a live read, because a live read on a disposed
  Runtime throws `WidgetSystemRuntimeDisposedError`.
- **Listener exceptions are isolated.** A throwing listener never disturbs the
  writer or other listeners (see [Runtime diagnostics](#runtime-diagnostics)),
  so an adapter's listeners need not guard against each other. The one
  exception is a runaway Event loop: the emit re-entrancy guard's
  `WidgetSystemRuntimeReentrancyError` (and an engine stack overflow) passes
  through Event listeners, including through an emitter obtained from
  `getWidgetEventEmitter` (see [Events](#events)).
- **Do not mutate what you read.** State values and the resolved config are
  passed by reference.

## Inspection

`@deviltea/widget-core/inspection` is a dedicated, strictly readonly subpath
and a supported, semver-governed observation surface for any host: DevTools,
prototype players, test harnesses, and other inspectors over the compiler and
Runtime. "DevTools" describes where it came from, not a lower support tier. It
is not re-exported from the root entrypoint:

```ts
import { inspectBlueprint, inspectPlugin, inspectRuntime } from '@deviltea/widget-core/inspection'
```

The inspection surface only ever reports facts the core already knows or
already computed; it never sets State, invokes a Method, forces Property
evaluation, or otherwise changes the semantic behavior being inspected —
including when a subscription is active.

### Plugin inspection

`inspectPlugin(plugin)` projects everything passive that one completed plugin
declares, before any authored View or Blueprint exists. It is a superset of the
plugin's `system.catalog` entry, so a host that holds a plugin needs no System to
describe it:

```ts
const inspection = inspectPlugin(plugin)

inspection.type // the plugin type
inspection.description
inspection.capabilities // the same six booleans as plugin.capabilities
inspection.config // { description, schema } | null
inspection.slots // ReadonlyMap<string, PluginInspectionSlot> | null
// { type: 'slot', name: 'content', description: 'Counter widgets' }

inspection.state
	?.get('count')
// { type: 'state', name: 'count', authorWritable: true | false }

inspection.properties
	?.get('label')
// { type: 'property', name: 'label', valueContractId: string | null }

inspection.events
	?.get('change')
// { type: 'event', name: 'change', description: string }
```

The facade is identity-stable for the exact Plugin object and never executes
Plugin semantics. State, Property, and Event member facts with demonstrated
pre-Blueprint consumers are projected here; this is not speculative reflection
of every Plugin definition. A member map is `null` when that capability was not
declared; an explicitly declared empty capability produces an empty readonly
map. Declaration order and arbitrary string member names are preserved.

Contract descriptor object identity is deliberately not exposed. Integrations
compare `valueContractId` strings, so dynamically loaded/duplicated module
instances do not need to share the same JavaScript token object.

### Foreign inputs

`inspectPlugin`, `inspectBlueprint`, and `inspectRuntime` throw
`WidgetInspectionError` (exported from the inspection subpath, not the root)
when the argument was not produced by this loaded module instance, with `code`
`foreign-plugin`, `foreign-blueprint`, or `foreign-runtime` respectively. A
well-formed look-alike or an object from another `@deviltea/widget-core` copy is
rejected the same way. Discriminate by class and `code`.

### Blueprint inspection

```ts
const inspection = inspectBlueprint(blueprint)

inspection.rootNodeId // InspectionNodeId
inspection.nodes // every recovered source node, pre-order, including unresolved nodes
inspection.invalidCycles // Property-containing invalid evaluation SCCs
inspection.getNode(nodeId)
inspection.getNodeId(node) // null for a foreign/forged node
```

- `inspectBlueprint(blueprint)` is lazy opt-in but eager once called: the
  first call materializes one complete, frozen snapshot, cached per Blueprint
  instance (`inspectBlueprint(blueprint) === inspectBlueprint(blueprint)`).
  Building/reading it performs zero semantic execution.
- `InspectionNodeId` is a snapshot-local diagnostic identity only — unique
  within one snapshot, valid for resolved and unresolved nodes alike, with no
  stability guarantee across `recompile()` or separate snapshots. It is not a
  domain identifier and must never be used as a dependency target.
- Each node carries the existing public `BlueprintWidgetNode` (`node`) rather
  than a duplicate DTO, its `sourcePath` (the same structured path as
  `blueprint.getSourcePath(node)`), plus `sourceSlots` (recovered source topology, each
  entry's `placement` is `'slot'` when the raw slot key is plugin-declared and
  `'raw-slot'` otherwise — an unresolved node's slots are always `'raw-slot'`,
  and a malformed raw slot value produces no entry at all).
- A resolved node additionally carries `capabilities` (declared vs
  explicitly-empty presence for `config` / `slots` / `state` / `properties` /
  `methods` / `events`), `semanticSlots`, and `state` / `properties` /
  `methods` / `events` member inventories in declaration order. An Event
  member projects its `name` and `description` only; no argument metadata is
  invented. State members project normalized
  `authorWritable`; Property members project `valueContractId` alongside their
  compiler-derived dependencies. A method's `transitivelyWrites` (the Method
  writes State, itself or through the Methods it invokes), its
  `transitivelyEmits` (the Method declares an Event in `emits`, or invokes a
  Method that does, transitively) and the Blueprint's `invalidCycles` are read
  directly off the existing compiler graph analysis — inspection never re-runs
  its own SCC, write-effect or emit-effect traversal. A Method is read-only,
  and so usable by a Property, exactly when both facts are `false`: a tool
  that filtered candidate Methods on `transitivelyWrites === false` alone must
  also test `transitivelyEmits === false`. Inspection does not list the
  `emits` a Method declares, and `inspectPlugin` has no Method inventory.
- Each `property`/`method` member exposes its declared dependencies, flattened
  to `{ path, reference, status, ... }` facts: `path` is the exact container
  path from the `registerDeps()` return root (object keys stay strings
  verbatim, array/tuple indices stay numbers — never stringified). `status` is
  `'resolved'` (with the semantically-resolved `target`), `'absent'` (legal
  optional cardinality-0 target, no Diagnostic), or `'invalid'` (every other
  resolution failure — ambiguous/missing targets carry no `targetNodeId`;
  unique-but-unresolved-target/missing-capability/missing-member failures do).
  Status is always read from compiler-authoritative data, never reconstructed
  from Diagnostics; the existing Blueprint Diagnostic surface remains the authoritative
  human-readable explanation.

### Runtime inspection

```ts
const inspection = inspectRuntime(runtime)

inspection.blueprint // === inspectBlueprint(runtime.blueprint)
inspection.getWidget(nodeId) // RuntimeWidgetInspection | null
```

```ts
const widgetInspection = inspection.getWidget(nodeId)!
widgetInspection.getState('count')
	?.getSnapshot() // { value: T | null }
widgetInspection.getProperty('doubled')
	?.getSnapshot() // never-evaluated | completed
widgetInspection.getEvent('change')
	?.subscribe((args) => { /* readonly occurrence args */ })
```

- `getState` / `getProperty` return `null` only when the member/capability
  does not exist; values are dynamically `unknown`-typed (strongly-typed
  access remains the job of the ordinary Runtime surface). There is
  deliberately no Method runtime inspection in v1 — no `getMethod`, no
  invocation facts, no history.
- Both `RuntimeStateInspection`/`RuntimePropertyInspection` follow the same
  `{ getSnapshot(), subscribe(listener) }` shape: `getSnapshot()` is a passive
  read, and `subscribe()` observes *future* changes only — no immediate
  emission, and never an event log.
- Retained facts start at Runtime creation, independent of whether/when
  `inspectRuntime()` is first called. State inspection reflects the current
  authoritative value, publishing a fresh `{ value }` snapshot only when a
  write actually changes it (a rejected write publishes nothing). Property
  inspection starts `{ status: 'never-evaluated' }` and publishes a fresh
  `{ status: 'completed', result }` on every naturally completed evaluation
  attempt (ok or semantic failure) — two equal completions still notify
  twice, and a callback throw or thenable violation never replaces the latest
  snapshot. The snapshot is current as soon as the evaluation completes; its
  listeners are notified once the Runtime call in progress has finished (see
  [When Property inspection listeners run](#when-property-inspection-listeners-run)).
- Reading or subscribing through inspection never activates a Property, never
  executes a Method, and never creates a tracked `alien-signals` dependency —
  even a `getSnapshot()` call made from inside an external `effect`/`computed`
  is an untracked read.
- Already-retained facts (and not-yet-obtained member facades) stay readable
  after `runtime.dispose()`, including the very first `inspectRuntime(runtime)`
  call happening after disposal — this is deliberately different from the
  live Runtime surface. Only `subscribe()` is gated on disposal: a *new*
  subscription after `dispose()` throws `WidgetSystemRuntimeDisposedError`,
  while subscriptions made before disposal are silently detached (no final
  emission) and their unsubscribe functions stay safe/idempotent. Inspection
  retains no history, method calls, timestamps, or profiling data beyond the
  already-documented current/last facts.

#### When Property inspection listeners run

A completed evaluation becomes the Property's inspection fact at once: from
then on `getSnapshot()` returns it. Its listeners are notified later, when the
outermost Runtime call in progress (the `get()`, `subscribe()`, `set()`, Method
call or `resetState()` that caused the evaluation) has finished its work, and
before that call returns. A listener therefore never runs while Core is still
evaluating Properties or notifying subscribers. It may read Properties, write
State or call Methods: what it reads is current, and what it writes is
propagated like any other write. A subscription created by `subscribe()`
already exists when those listeners run, so it is notified of what they write.

- The completions of one call are delivered in the order they happened, each
  with its own snapshot. When a Property completes twice in one call (a Method
  reads it, writes a State it depends on and reads it again), its listeners are
  called twice, and during the first call `getSnapshot()` already returns the
  second completion.
- Within one call, Property inspection listeners run after that call's State
  and Property subscribers, diagnostics listeners and State inspection
  listeners. A State inspection listener still runs when the write happens.
- A listener unsubscribed before its turn is not called. A listener subscribed
  after a completion is not called for it, even when that completion has not
  been delivered yet.
- If the Runtime is disposed later in the same call (for example by a
  subscriber), the completions not delivered yet are dropped, because
  subscriptions are detached without a final call. `getSnapshot()` still
  returns them.
- What a listener does can complete more Properties. Those completions are
  delivered in the same call, after the ones already waiting. A listener that
  keeps changing what it observes (on every completion it writes a State its
  own Property depends on) is stopped after an internal number of rounds: every
  notification of that call not delivered yet is dropped, including those of
  other listeners and other Properties, and a `RangeError` is reported the way
  an exception thrown by a listener is (see
  [Host requirements](#host-requirements)). Facts (`getSnapshot()`), State
  values and subscribers stay consistent, and later calls deliver as usual.

**Not supported.** Some code runs while a Property is being evaluated, and Core
cannot postpone it: a `compute`, a dependency `.validate()` refinement, the
`validateArgs` of a Method a Property depends on, and the Event listeners and
Event inspection listeners of an emit made by such a Method. When this code
uses a Runtime it holds by closure instead of its declared dependencies, the
outcome is not guaranteed if it:

- reads, with `get()` or `subscribe()`, a Property whose evaluation is in
  progress or that depends on one (a cycle the Blueprint cannot see). The read
  can return the previous value, which can then stay cached until a write
  reaches it. On a first evaluation the read can recurse until the engine's
  stack overflows;
- writes State, calls a Method or calls `resetState()`. Other values can stay
  out of date until a later write reaches them, and subscribers can miss a
  notification;
- calls `dispose()`. When the evaluation is one that a write's flush started
  for a subscription, the write in progress can throw an internal
  `TypeError` instead of `WidgetSystemRuntimeDisposedError`.

A `compute` that reads, the same way, a Property that does not depend on the
one being evaluated (for example in another Runtime) gets that Property's
current value, but the read becomes a dependency the Blueprint does not show:
whenever that Property changes, a subscribed reading Property is evaluated again
and its subscribers are notified, even with an equal value (an unsubscribed one is
evaluated on its next read); and once that other Runtime
is disposed, the `compute` throws `WidgetSystemRuntimeDisposedError`, which the
reading Property's `get()` rethrows (its subscriptions skip that recompute, see
[Runtime Properties](#runtime-properties)). Declare the dependency instead when
you can, and do the rest from a subscriber, from an inspection listener or
later, for example in a microtask.

Also not supported: wrapping Runtime calls in your own `alien-signals` batch
(`startBatch()` and `endBatch()` of the same `alien-signals` copy Core imports).
The flush then happens after every Runtime call has returned, so subscribers and
inspection listeners can again run while Core is notifying, and a listener that
writes can make another subscriber miss its last value.

#### Event inspection: `getEvent(name)`

`RuntimeWidgetInspection.getEvent(name)` is a passive occurrence channel for
Events (see [Events](#events)). Unlike State and Property inspection it has no
`getSnapshot()`: it reports occurrences only. It makes these guarantees:

1. It returns `null` only when the Event member or capability is absent. The
   facade is identity-stable and can still be obtained after dispose.
2. It is passive: it grants no emit authority and never changes emission,
   public listener membership or order, or any exception the emitter sees.
3. For one emit, all inspection listeners run **before** any public listener.
   The public audience is snapshotted before inspection listeners run, so an
   inspection callback cannot join the current public delivery.
4. The inspection audience is snapshotted per occurrence. Subscribing or
   unsubscribing during delivery affects only later emits.
5. A throwing inspection listener is isolated. The error does not reach the
   emitter, other inspection listeners, or public listeners, and it is
   reported outside the emit call. The reporting mechanism is not normative.
6. Each occurrence passes one **shallow-frozen** args array, shared by that
   occurrence's inspection listeners. The elements are the emitted references;
   Core does not clone or deep-freeze them. Core retains nothing after `emit`
   returns.
7. The occurrence is published when `emit` starts. Inspection observes it even
   if a later public listener throws.
8. Future occurrences only: no replay, history, or immediate emission.
9. After dispose, a new `subscribe()` throws `WidgetSystemRuntimeDisposedError`.
   Earlier subscriptions are detached without a final call, and unsubscribe
   stays idempotent.
10. Listeners run untracked: reading Runtime facts inside one adds no reactive
    dependency.

Not guaranteed: what happens when an inspection listener synchronously writes
State or invokes Methods, beyond ordinary Runtime rules. Hosts that react to
an occurrence should defer the work, for example to a microtask.

## Guides

### Async work

Core is synchronous by design, and that is a deliberate boundary rather than a
missing feature. Every semantic callback is synchronous, a returned Promise is a
contract violation, and a callback's dependency and `emit` callables stop working
when the callback returns (see
[Callback context lifetime](#callback-context-lifetime)). Asynchronous work
therefore lives in the **host**: the host awaits it, and the result re-enters
Core through ordinary synchronous State writes and Method calls, made from the
host's own code and never from inside a Core callback.

**The simplest form.** Model the work's progress as State (a `status` member plus
whatever data the result needs), await the work in the host, and write the
outcome through the public Runtime surface. Write the data before the status, so
that anything observing `ready` finds the data already in place.

<!-- sample: async run -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

type Status = 'idle' | 'loading' | 'ready' | 'failed'

const profilePlugin = createWidgetPlugin('profile')
	.description('A profile loaded by the host')
	.interfaces<{ state: { status: Status, title: string | null } }>()
	.state(state => state
		.status({
			validate: (input): input is Status =>
				input === 'idle' || input === 'loading' || input === 'ready' || input === 'failed',
			default: () => 'idle',
		})
		.title({
			validate: (input): input is string | null => input === null || typeof input === 'string',
			default: () => null,
		}))
	.done()

const blueprint = createWidgetSystem({ plugins: [profilePlugin] })
	.createBlueprint({ id: 'profile-1', type: 'profile' })
if (blueprint.status !== 'valid')
	throw new Error('invalid')
const runtime = blueprint.createRuntime()
const profile = runtime.getWidget('profile-1')
if (profile?.type !== 'profile')
	throw new Error('not found')
const { state } = profile

// The host owns the effect: it awaits, then writes the outcome back into State.
async function load(fetchTitle: () => Promise<string>): Promise<void> {
	state.status.set('loading')
	try {
		const title = await fetchTitle()
		state.title.set(title)
		state.status.set('ready')
	}
	catch {
		state.status.set('failed')
	}
}

await load(() => Promise.resolve('Ada Lovelace'))
console.log(state.status.get(), state.title.get()) // ready Ada Lovelace

await load(() => Promise.reject(new Error('offline')))
console.log(state.status.get(), state.title.get()) // failed Ada Lovelace
```

`status` is an ordinary State member, so a renderer, a Property or a host
subscriber observes loading, ready and failed like any other change.

**When several members change together.** Each `state.set()` is its own write and
notifies its subscribers on its own, so a Property that reads two members is
recomputed, and its subscribers are called, once per write, and the first call
sees a half-updated result. One Method invocation is one batch: the writes inside
it are applied together, dependents recompute once, and subscribers are notified
once with the final values. When a result touches more than one member, commit it
through a single Method.

<!-- sample: async-batch run -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

type Status = 'loading' | 'ready'

interface ProfileInterfaces {
	state: { status: Status, title: string | null }
	properties: { headline: string }
	methods: { commit: (title: string) => null }
}

const profilePlugin = createWidgetPlugin('profile')
	.description('A profile loaded by the host')
	.interfaces<ProfileInterfaces>()
	.state(state => state
		.status({
			validate: (input): input is Status => input === 'loading' || input === 'ready',
			default: () => 'loading',
		})
		.title({
			validate: (input): input is string | null => input === null || typeof input === 'string',
			default: () => null,
		}))
	.properties(properties => properties
		.headline({
			registerDeps: ({ dep }) => ({
				status: dep.self.state.get('status'),
				title: dep.self.state.get('title'),
			}),
			compute: ({ deps }) => {
				const status = deps.status()
				const title = deps.title()
				return `${status.ok ? status.value : '?'}: ${title.ok ? title.value : '?'}`
			},
		}))
	.methods(methods => methods
		// One invocation is one batch: both writes land together.
		.commit({
			validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
			registerDeps: ({ dep }) => ({
				setStatus: dep.self.state.set('status'),
				setTitle: dep.self.state.set('title'),
			}),
			execute: ({ args: [title], deps }) => {
				deps.setTitle(title)
				deps.setStatus('ready')
				return null
			},
		}))
	.done()

function createProfile() {
	const blueprint = createWidgetSystem({ plugins: [profilePlugin] })
		.createBlueprint({ id: 'profile-1', type: 'profile' })
	if (blueprint.status !== 'valid')
		throw new Error('invalid')
	const widget = blueprint.createRuntime()
		.getWidget('profile-1')
	if (widget?.type !== 'profile')
		throw new Error('not found')
	return widget
}

// Two separate writes: the Property subscriber runs twice, and the first run sees a mix.
const separate = createProfile()
separate.properties.headline.subscribe((result) => {
	console.log('separate:', result.ok ? result.value : 'failed')
})
separate.state.title.set('Ada Lovelace') // separate: loading: Ada Lovelace
separate.state.status.set('ready') // separate: ready: Ada Lovelace

// One Method invocation: one batch, one notification, final values only.
const batched = createProfile()
batched.properties.headline.subscribe((result) => {
	console.log('batched:', result.ok ? result.value : 'failed')
})
batched.methods.commit('Ada Lovelace') // batched: ready: Ada Lovelace
```

**Cancelling on disposal.** `runtime.subscribeDisposal(listener)` runs a listener
once, synchronously, when the Runtime is disposed (see [Disposal](#disposal)).
Pair it with a host-side `AbortController` to stop pending work: pass the
controller's `signal` to the work, abort it from the listener, and unsubscribe
when the work settles so a long-lived Runtime does not accumulate listeners. The
listener cancels the host's own work; it cannot touch the Runtime, which is
already disposed by then.

<!-- sample: async-cancel run -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

const plugin = createWidgetPlugin('profile')
	.description('A profile loaded by the host')
	.interfaces<{ state: { title: string | null } }>()
	.state(state => state
		.title({
			validate: (input): input is string | null => input === null || typeof input === 'string',
			default: () => null,
		}))
	.done()
const blueprint = createWidgetSystem({ plugins: [plugin] })
	.createBlueprint({ id: 'profile-1', type: 'profile' })
if (blueprint.status !== 'valid')
	throw new Error('invalid')
const runtime = blueprint.createRuntime()

// Stands in for `fetch(url, { signal })`: settles later, rejects when aborted.
function fetchTitle(title: string, milliseconds: number, signal: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, milliseconds, title)
		signal.addEventListener('abort', () => {
			clearTimeout(timer)
			reject(signal.reason)
		}, { once: true })
	})
}

async function load(title: string, milliseconds: number): Promise<void> {
	const controller = new AbortController()
	const stopOnDisposal = runtime.subscribeDisposal(() => controller.abort())
	try {
		const result = await fetchTitle(title, milliseconds, controller.signal)
		runtime.getWidget('profile-1')?.state.title.set(result)
		console.log('loaded', result)
	}
	catch {
		console.log('cancelled')
	}
	finally {
		stopOnDisposal() // the work has settled: stop listening
	}
}

await load('Ada', 5) // loaded Ada
const pending = load('Grace', 1000)
runtime.dispose() // aborts the pending request synchronously
await pending // cancelled
```

`runtime.isDisposed` still has a job. Work that cannot be cancelled (a promise
that takes no `AbortSignal`, or a callback that is already queued) resumes after
its `await` whether or not the Runtime is still alive, and a State write or a
Method call on a disposed Runtime throws. Check `runtime.isDisposed` before the
write for such work. `subscribeDisposal()` also throws on a Runtime that is
already disposed, so check there first when the Runtime may already be gone.

**When requests can overlap.** If the host can start a second request before the
first one settles, a slow first response can arrive after a fast second one and
overwrite it. Aborting the old request is the best fix when the work supports it.
When it does not, make the commit Method ignore a response whose ticket is no
longer the newest. This is the heaviest form and is only needed for overlapping,
uncancellable work: a `begin` Method issues a ticket (the next number, kept in
State), and `settle` takes the ticket together with the result and ignores it
when it is stale.

<!-- sample: async-ticket run -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

type Status = 'idle' | 'loading' | 'ready' | 'failed'

interface ProfileInterfaces {
	state: { status: Status, requestId: number, data: string | null }
	methods: {
		begin: () => number
		settle: (requestId: number, data: string | null) => boolean
	}
}

const profilePlugin = createWidgetPlugin('profile')
	.description('A profile loaded by the host')
	.interfaces<ProfileInterfaces>()
	.state(state => state
		.status({
			validate: (input): input is Status =>
				input === 'idle' || input === 'loading' || input === 'ready' || input === 'failed',
			default: () => 'idle',
		})
		.requestId({ validate: (input): input is number => typeof input === 'number', default: () => 0 })
		.data({ validate: (input): input is string | null => input === null || typeof input === 'string', default: () => null }))
	.methods(methods => methods
		// Marks a load as started and hands the host a ticket.
		.begin({
			validateArgs: (args): args is [] => args.length === 0,
			registerDeps: ({ dep }) => ({
				requestId: dep.self.state.get('requestId'),
				setRequestId: dep.self.state.set('requestId'),
				setStatus: dep.self.state.set('status'),
			}),
			execute: ({ deps }) => {
				const current = deps.requestId()
				const next = (current.ok ? current.value ?? 0 : 0) + 1
				deps.setRequestId(next)
				deps.setStatus('loading')
				return next
			},
		})
		// Commits a result (`null` means the request failed); a stale ticket is ignored.
		.settle({
			validateArgs: (args): args is [number, string | null] =>
				args.length === 2 && typeof args[0] === 'number' && (args[1] === null || typeof args[1] === 'string'),
			registerDeps: ({ dep }) => ({
				requestId: dep.self.state.get('requestId'),
				setStatus: dep.self.state.set('status'),
				setData: dep.self.state.set('data'),
			}),
			execute: ({ args: [requestId, data], deps }) => {
				const current = deps.requestId()
				if (!current.ok || current.value !== requestId)
					return false
				if (data === null) {
					deps.setStatus('failed')
					return true
				}
				deps.setData(data)
				deps.setStatus('ready')
				return true
			},
		}))
	.done()

const blueprint = createWidgetSystem({ plugins: [profilePlugin] })
	.createBlueprint({ id: 'profile-1', type: 'profile' })
if (blueprint.status !== 'valid')
	throw new Error('invalid')
const runtime = blueprint.createRuntime()
const profile = runtime.getWidget('profile-1')
if (profile?.type !== 'profile')
	throw new Error('not found')

async function load(fetchProfile: () => Promise<string>): Promise<void> {
	const ticket = profile!.methods.begin()
	if (!ticket.ok)
		return
	let data: string | null
	try {
		data = await fetchProfile()
	}
	catch {
		data = null
	}
	if (runtime.isDisposed) // uncancellable work resumes here, and a Method call would throw
		return
	profile!.methods.settle(ticket.value, data)
}

const slow = load(() => new Promise<string>(resolve => setTimeout(resolve, 20, 'old')))
const fast = load(() => Promise.resolve('new'))
await Promise.all([slow, fast])
console.log(profile.state.status.get(), profile.state.data.get()) // ready new (the stale response was ignored)

const late = load(() => new Promise<string>(resolve => setTimeout(resolve, 10, 'late')))
runtime.dispose()
await late // no throw after disposal
```

Events are host-facing notifications. They cannot be dependency targets, so
"loading finished" is observed by subscribing to the `status` State (or to a
Property derived from it), or to an Event, from the host or an adapter.

### Persisted documents

Validity is all-or-nothing: a Blueprint is `'valid'` only when its whole tree is
valid, and only a valid Blueprint creates a Runtime. A source saved earlier can
become invalid when the code moves on: it may reference a plugin type that was
removed, or carry a config shape that changed. Core does not migrate or
version documents; the host repairs the stored source and Core tells it where
the problems are. The tools are the Blueprint's diagnostics,
`blueprint.getSourcePath(node)` (the exact path of a diagnostic's node inside the
source), and `SourcePatch` through a `WidgetDocument`, which re-compiles after
every committed patch.

The recipe below repairs one diagnostic per pass until the document is valid or
a pass makes no progress (the pass limit bounds a repair that never converges).
It drops widgets whose plugin type no longer exists and migrates an old config
shape (`stepSize` to `step`). The stored input is never modified, because
patches are copy-on-write.

<!-- sample: persisted run -->
```ts
import type { SourcePatch, WidgetDocument } from '@deviltea/widget-core'
import { createWidgetDocument, createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

interface CounterInterfaces {
	config: { raw: { step: number } | null, resolved: { step: number } }
	state: { count: number }
}
interface PanelInterfaces { slots: 'content' }

const counterPlugin = createWidgetPlugin('counter')
	.description('A counter')
	.interfaces<CounterInterfaces>()
	.config({
		description: 'Counter configuration',
		validate: (input): input is { step: number } | null =>
			input === null || (typeof input === 'object' && !Array.isArray(input) && typeof (input as { step?: unknown }).step === 'number'),
		resolve: rawConfig => ({ step: rawConfig?.step ?? 1 }),
	})
	.state(state => state.count({
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.done()
const panelPlugin = createWidgetPlugin('panel')
	.description('A panel')
	.interfaces<PanelInterfaces>()
	.slots({ content: { description: 'Content' } })
	.done()

const system = createWidgetSystem({ plugins: [counterPlugin, panelPlugin] })

/** Returns the repair for the first diagnostic it understands, or `null` when it cannot help. */
function repair(blueprint: ReturnType<WidgetDocument['getSnapshot']>['blueprint']): SourcePatch | null {
	for (const diagnostic of blueprint.diagnostics) {
		if (!('node' in diagnostic.location))
			continue // a whole-source diagnostic (for example a non-JSON value) has no node to repair
		const node = diagnostic.location.node
		const path = blueprint.getSourcePath(node) // a SourcePatch path addressing exactly this node

		// A plugin type that no longer exists: drop the widget from its slot (the root cannot be dropped).
		if (diagnostic.code === 'unknown-widget-type')
			return path !== null && path.length > 0 ? [{ op: 'remove', path }] : null

		// An old config shape: migrate `stepSize` to `step`, or drop a config we cannot read.
		if (diagnostic.code === 'invalid-widget-config' && node.resolved && node.type === 'counter' && path !== null) {
			const old = (node.source as { config?: { stepSize?: unknown } }).config
			if (typeof old?.stepSize === 'number')
				return [{ op: 'replace', path: [...path, 'config'], value: { step: old.stepSize } }]
			return [{ op: 'remove', path: [...path, 'config'] }]
		}
		return null // anything else is not something this migration knows how to fix
	}
	return null
}

/** Repairs a stored source. Returns the repaired document, or `null` when it cannot be made valid. */
function sanitize(stored: unknown) {
	const document = createWidgetDocument({ system, source: stored })
	for (let pass = 0; pass < 100; pass++) {
		const { blueprint } = document.getSnapshot()
		if (blueprint.status === 'valid')
			return document
		const patch = repair(blueprint)
		if (patch === null || !document.applyPatch(patch).ok)
			return null
	}
	return null
}

const stored = {
	id: 'panel-1',
	type: 'panel',
	slots: {
		content: [
			{ id: 'banner-1', type: 'legacy-banner' }, // plugin removed since the document was saved
			{ id: 'counter-1', type: 'counter', config: { stepSize: 5 } }, // config renamed since
		],
	},
}

console.log(system.createBlueprint(stored).status) // invalid
const document = sanitize(stored)
if (document === null)
	throw new Error('unrecoverable')
const repaired = document.getSnapshot()
console.log(repaired.blueprint.status, JSON.stringify(repaired.blueprint.source))
// valid {"id":"panel-1","type":"panel","slots":{"content":[{"id":"counter-1","type":"counter","config":{"step":5}}]}}
console.log(JSON.stringify(stored)
	.includes('legacy-banner')) // true: the stored input itself is untouched
```

A repair that cannot make the document valid should leave it invalid and
surface the diagnostics (to the author, or to a recovery screen) instead of
guessing; an invalid Blueprint stays fully navigable for exactly that purpose.

**Carrying State across versions.** Runtime State is never part of the source.
To keep it when the source is replaced, take `runtime.snapshotState()` from the
old Runtime and pass it as `overrideStateDefaults` to the next one. The snapshot
is keyed by widget id and member key, so it follows widgets whose ids survive the
edit. Entries for widgets or members that no longer exist are not an error:
they are reported as Runtime-level `unknown-state-override-widget` /
`unknown-state-override-member` diagnostics and the rest still applies, so
filter them out of the snapshot first if you do not want those diagnostics.

<!-- sample: state-carry-over run -->
```ts
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

const counterPlugin = createWidgetPlugin('counter')
	.description('A counter')
	.interfaces<{ state: { count: number } }>()
	.state(state => state.count({
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.done()
const panelPlugin = createWidgetPlugin('panel')
	.description('A panel')
	.interfaces<{ slots: 'content' }>()
	.slots({ content: { description: 'Content' } })
	.done()
const system = createWidgetSystem({ plugins: [counterPlugin, panelPlugin] })

function createRuntime(source: unknown) {
	const blueprint = system.createBlueprint(source)
	if (blueprint.status !== 'valid')
		throw new Error('invalid')
	return blueprint
}

const first = createRuntime({
	id: 'panel-1',
	type: 'panel',
	slots: { content: [{ id: 'counter-1', type: 'counter' }] },
})
	.createRuntime()
const counter = first.getWidget('counter-1')
if (counter?.type !== 'counter')
	throw new Error('missing')
counter.state.count.set(7)
const saved = first.snapshotState() // { 'counter-1': { count: 7 } }; members that are null are omitted

// The edited source keeps counter-1 and adds counter-2.
const nextBlueprint = createRuntime({
	id: 'panel-1',
	type: 'panel',
	slots: { content: [{ id: 'counter-1', type: 'counter' }, { id: 'counter-2', type: 'counter' }] },
})
const next = nextBlueprint.createRuntime({ overrideStateDefaults: saved })
const carried = next.getWidget('counter-1')
console.log(carried?.type === 'counter' ? carried.state.count.get() : 'missing') // 7
console.log(next.getDiagnostics().length) // 0
```

### Editing a document that is currently invalid

An editor or live preview spends much of its time in a document that does not
compile: a plugin type is half typed, a config value is mid-edit. Core's rule for
this is fixed. Validity is all-or-nothing: a Blueprint with any diagnostic creates
no Runtime, Core does not run part of an invalid document, and it does not
quarantine or prune the invalid part. What to show while a document is invalid is
the host's decision. The tools are the ones the
[Persisted documents](#persisted-documents) guide already uses: the Blueprint's
diagnostics, `blueprint.getSourcePath(node)`, and a `WidgetDocument`, which
re-compiles after every committed patch.

The usual pattern keeps the last valid state on screen and treats an invalid
commit as information to display, not as a reason to tear anything down:

1. Keep the last valid Blueprint's Runtime running and rendered.
2. When a commit produces an invalid Blueprint, leave that Runtime alone and
   present the new Blueprint's diagnostics next to it. For each diagnostic,
   `blueprint.getSourcePath(node)` gives the path of the offending node in the
   source, so the editor can point at it.
3. When a later commit is valid again, create the next Runtime from it, carry
   State over by passing the old Runtime's `snapshotState()` as
   `overrideStateDefaults` (see
   [Carrying State across versions](#persisted-documents)), and dispose the
   previous Runtime.

The session below implements exactly that on top of `createWidgetDocument`.
`apply(patch)` commits a patch, and a document subscriber decides between
"promote" and "keep what is showing", so every edit goes through the same rule.
The script walks valid, invalid, valid again and prints what a UI would show at
each step.

<!-- sample: editing-invalid run -->
```ts
import type { SourcePatch, WidgetSystemRuntime } from '@deviltea/widget-core'
import { createWidgetDocument, createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

const counterPlugin = createWidgetPlugin('counter')
	.description('A counter')
	.interfaces<{ state: { count: number } }>()
	.state(state => state.count({
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.done()
const panelPlugin = createWidgetPlugin('panel')
	.description('A panel')
	.interfaces<{ slots: 'content' }>()
	.slots({ content: { description: 'Content' } })
	.done()
const plugins = [counterPlugin, panelPlugin] as const
const system = createWidgetSystem({ plugins })

function createEditingSession(source: unknown) {
	const document = createWidgetDocument({ system, source })
	let runtime: WidgetSystemRuntime<typeof plugins> | null = null // the last valid Runtime, if any
	let problems: string[] = [] // the diagnostics of the newest revision, empty while it is valid

	function show({ blueprint }: ReturnType<typeof document.getSnapshot>): void {
		if (blueprint.status === 'invalid') {
			// Keep the last valid Runtime running; only the problems change.
			problems = blueprint.diagnostics.map((diagnostic) => {
				const node = 'node' in diagnostic.location ? diagnostic.location.node : blueprint.root
				return `${diagnostic.code} at /${(blueprint.getSourcePath(node) ?? []).join('/')}`
			})
			return
		}
		problems = []
		// Valid again: carry State over to the next Runtime, then dispose the previous one.
		const next = blueprint.createRuntime({ overrideStateDefaults: runtime?.snapshotState() })
		runtime?.dispose()
		runtime = next
	}

	show(document.getSnapshot())
	document.subscribe(snapshot => show(snapshot))

	return {
		apply: (patch: SourcePatch) => document.applyPatch(patch),
		get runtime() { return runtime },
		get problems() { return problems },
	}
}

const session = createEditingSession({
	id: 'panel-1',
	type: 'panel',
	slots: { content: [{ id: 'counter-1', type: 'counter' }] },
})

// What a UI would show: the live Runtime's state, and the problems with the newest edit.
function render(label: string): void {
	const counter = session.runtime?.getWidget('counter-1')
	const count = counter?.type === 'counter' ? counter.state.count.get() : 'none'
	console.log(`${label}: showing count=${count}; problems: ${session.problems.length === 0 ? 'none' : session.problems.join(', ')}`)
}

const first = session.runtime
const counter = first?.getWidget('counter-1')
if (counter?.type !== 'counter')
	throw new Error('missing')
counter.state.count.set(3)
render('valid') // valid: showing count=3; problems: none

// A half-typed plugin type: the document is invalid, the last valid Runtime keeps running.
session.apply([{ op: 'replace', path: '/slots/content/0/type', value: 'count' }])
render('invalid') // invalid: showing count=3; problems: unknown-widget-type at /slots/content/0
console.log(session.runtime === first) // true: nothing was torn down

// The user keeps interacting with what is still showing.
counter.state.count.set(4)

// The edit is completed: a new Runtime carries the State over and the old one is disposed.
session.apply([{ op: 'replace', path: '/slots/content/0/type', value: 'counter' }])
render('valid again') // valid again: showing count=4; problems: none
console.log(session.runtime === first, first?.isDisposed) // false true

// A document that is invalid from the start has no Runtime to keep showing.
const broken = createEditingSession({ id: 'panel-1', type: 'panel', slots: { content: [{ id: 'x', type: 'oops' }] } })
console.log(broken.runtime, broken.problems) // null [ 'unknown-widget-type at /slots/content/0' ]
```

Three details of the session are choices rather than requirements. Creating the
next Runtime before disposing the previous one means a failure while creating it
leaves what is showing intact. Snapshot entries for widgets or members the edit
removed come back as the Runtime diagnostics described under
[Carrying State across versions](#persisted-documents), so filter them out of the
snapshot if the preview should not report them. And the subscriber runs inside
`applyPatch`, so a host that renders from the session should read `runtime` and
`problems` after `apply` returns, not from inside the subscriber.

**When there is no last valid state.** A stored document that is already invalid
on first load has no Runtime to keep showing. Either run the repair loop from
[Persisted documents](#persisted-documents) first, or show the diagnostics (as
`broken` does above) until an edit makes the document valid.

### Generic plugin factories

A plugin factory that is generic over a type (`createListPlugin<Item>()`) hits
a TypeScript limit: `.interfaces<I>()` returns a conditional type that checks the
interfaces for unsupported shapes, and TypeScript cannot evaluate that
conditional while `I` still contains a type parameter. The next phase then
does not exist on the result (`Property 'state' does not exist on type ...`).
Cast the result of `.interfaces()` to the phase it resolves to for any concrete
type, `WidgetPluginConfigPhase<Type, I>`; the rest of the chain is checked
normally against `I`:

<!-- sample: generic-factory run -->
```ts
import type { WidgetPluginConfigPhase } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

interface BoxInterfaces<Value> {
	state: { value: Value }
}

export function createBoxPlugin<const Type extends string, Value>(
	type: Type,
	isValue: (input: unknown) => input is Value,
	initial: Value,
) {
	return (createWidgetPlugin(type)
		.description('A box holding one value')
		.interfaces<BoxInterfaces<Value>>() as WidgetPluginConfigPhase<Type, BoxInterfaces<Value>>)
		.state(state => state.value({ validate: isValue, default: () => initial }))
		.done()
}

const numberBox = createBoxPlugin('number-box', (input): input is number => typeof input === 'number', 0)
const blueprint = createWidgetSystem({ plugins: [numberBox] })
	.createBlueprint({ id: 'box-1', type: 'number-box' })
if (blueprint.status !== 'valid')
	throw new Error('invalid')
const box = blueprint.createRuntime()
	.getWidget('box-1')
console.log(box?.state.value.get()) // 0
```

The cast is only needed for a generic factory, and it turns off the checks that
need to see the concrete interfaces (the synchronous-value and member-key checks)
until the factory is instantiated, so test the factory with the concrete types
it is used with. A Method's `emits` is still inferred inside the factory: its
`emit` carries only the declared Events, and an Event whose argument tuple
mentions the type parameter keeps that tuple (`emit.added(item)` takes an
`Item`).

### Writing plugin libraries

Core identifies its own plugins, Blueprints and Runtimes with brands that are
private to one loaded copy of the module, so exactly one copy of
`@deviltea/widget-core` must exist in an application. A library that ships
plugins or a renderer adapter must therefore declare `@deviltea/widget-core` as a
**peer dependency** (and as a dev dependency for its own tests), never as a
regular dependency, and must not bundle it. `@deviltea/widget-vue` and
`@deviltea/widget-inspector` do this themselves. If two copies do load, the
second copy's objects are rejected as foreign (see
[Plugin registration errors](#plugin-registration-errors)).

While Core is `0.x` a breaking change bumps the **minor** version (`0.N.0`), so a
`^0.N.0` peer range accepts only the Core line a library was written against.
Release a library's own dependents after Core, never before.

## Design constraints

- **Synchronous boundary.** Every framework-owned semantic callback
  (`validate`, `resolve`, `default`, `validateStructure`, `registerDeps`,
  `compute`, `validateArgs`, `execute`) is synchronous. A returned
  Promise/thenable is a contract violation on the plugin author's side, not
  a diagnostic and not an `ExecutionResult.failure`. An `execute` or
  structure validator (slot, plugin, system) written into the builder or the
  System options that returns a thenable is rejected by the type checker too,
  whatever the declared return type; a callback typed only by a standalone
  definition type is caught by the runtime guard alone. Asynchronous work
  stays outside Core: the host awaits it and re-enters through ordinary
  synchronous State writes and Method calls (see [Async work](#async-work)).
- **All-or-nothing validity.** A Blueprint with any diagnostic creates no
  Runtime. Core does not run, quarantine or prune part of an invalid document;
  tolerating one, for example by keeping the last valid Runtime on screen, is
  the host's job (see
  [Editing a document that is currently invalid](#editing-a-document-that-is-currently-invalid)).
- **Callback-context lifetime.** A callback's `addDiagnostic` /
  `hasAnyDiagnostic`, its dependency callables and its `emit` callables belong
  to that synchronous call (see
  [Callback context lifetime](#callback-context-lifetime)).
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

### Error taxonomy

Failures reach callers through four distinct channels; which one you get tells
you who is responsible.

| Channel | What it is | Examples |
|---|---|---|
| Diagnostics | facts about authored data and runtime values; a normal result, never thrown | every code in [Diagnostics](#diagnostics) and [Runtime diagnostics](#runtime-diagnostics) |
| Result envelopes | `ExecutionResult` from Runtime operations (`ok`, `value` or `failure.diagnostics`); `{ ok, changed }` or a single coded failure from `WidgetDocument.applyPatch`; `{ ..., diagnostics }` returns from the separated-source tools | `state.set()`, a Method call, `applyPatch()` |
| Coded `Error` classes | a boundary was used wrongly; discriminate by class and `code`, never by `message` | `WidgetSystemConfigurationError` (`invalid-options`, `foreign-plugin`, `duplicate-plugin-type`) from `createWidgetSystem`; `WidgetSystemRuntimeDisposedError` (`runtime-disposed`) from a disposed Runtime; `WidgetSystemRuntimeReentrancyError` (`emit-depth-exceeded`, a `RangeError`) from the emit re-entrancy guard; `WidgetInspectionError` (`foreign-plugin`, `foreign-blueprint`, `foreign-runtime`) from `@deviltea/widget-core/inspection`; `WidgetIntegrationError` (`runtime-widget-mismatch`, `foreign-runtime`) from `@deviltea/widget-core/integration` |
| Uncoded `TypeError` and others | a plugin or callback broke its contract: a malformed declaration, a returned thenable, a closed collector or callable used late, a structure validator reporting a location that does not exist | thrown at plugin build, compile or call time; an implementation bug, not a Diagnostic |

Plugin exceptions are not wrapped or converted: a `compute` or `execute` that
throws propagates unchanged to the caller that triggered it (for a Method call
and for `get()`), and `createBlueprintFromJson` throws the `SyntaxError` from
`JSON.parse` unchanged. Runaway recursion surfaces as a `RangeError`; a runaway
Event loop surfaces as `WidgetSystemRuntimeReentrancyError` (see
[Events](#events)). Listener exceptions are the exception to propagation: they
are isolated (see [Host requirements](#host-requirements)), except that Event
listener isolation lets that guard error and an engine stack overflow through.

There are two different `reason` fields. On a diagnostic a plugin authored
(`invalid-widget-config`, `invalid-widget-structure`, `invalid-state-value`,
and the other value diagnostics) `reason` is an **opaque string chosen by the
plugin author**, carried verbatim and never interpreted. On
`json-incompatible-value` (and on the separated-source diagnostics) `reason` is
a **closed enum** defined by Core.

### Host requirements

Core is platform-neutral and runs in browsers, Node.js, and embedded engines
such as QuickJS (for example through `rquickjs`, or a bundled single-file
IIFE). The current implementation needs:

- **ES2022.** The published build targets `es2022`. The packages declare
  `engines.node` `>=22.14.0` and `sideEffects: false`.
- **A global `queueMicrotask` and a drained job queue.** Core reports an
  exception it has isolated from the current operation by rethrowing it in a
  queued microtask. That covers a throwing State, Property or diagnostic
  listener (`subscribe` / `subscribeDiagnostics`), a throwing public Event
  listener, a throwing disposal listener (`subscribeDisposal`), a throwing
  inspection listener, a throwing `WidgetDocument`
  subscriber, and a Property `compute` that throws while a subscription
  re-evaluates it (one report per exception and synchronous turn, however many
  subscriptions re-read it). An embedded host must run its pending jobs (for example
  `rquickjs`'s pending-job execution, or `JS_ExecutePendingJob` in
  QuickJS); otherwise these errors never surface. Without a global
  `queueMicrotask`, the rethrow itself fails with a `ReferenceError` at the
  point of the failure.
- **Enough call stack for what you subscribe to.** Compiling and reading do not
  depend on the stack size, but tearing down a long subscribed chain does. See
  [Call-stack depth](#call-stack-depth).

Core does not use timers, `console`, `process`, DOM globals, or Promises at
runtime. These are requirements of the current implementation, not
architecture rules: `queueMicrotask` is how isolated errors are
reported today, and the mechanism may change.

The current canonical architecture authority is
[DevilTea/widget Discussion #12](https://github.com/DevilTea/widget/discussions/12).
Its Core composition architecture topic contains the migrated historical
`diagnostic #10` decisions plus current accepted amendments; those current
Discussion #12 decisions are authoritative over this guide.

#### Call-stack depth

Compiling a Blueprint and reading Properties do not depend on the engine's
call-stack size, however long a chain of Properties that read each other is.
The cycle analysis in `createBlueprint` is iterative. A read of a Property
(`get()` or a subscription) bounds how deeply Property evaluations nest with an
internal limit and completes the rest of a long chain in a loop. This holds when
the chain was never evaluated, when writes invalidated it, and after
`resetState()`. Earlier versions recursed once per link: with QuickJS's default
1 MiB stack, compiling failed above about 850 chained Properties and a first
read above about 128. The limit is internal: it is not API, not configurable and
may change, and Core stays synchronous.

On QuickJS (quickjs-ng 0.18.0), compiling, the first read of the head of a
chain, a read after writing the tail and a read after writing every State all
worked at every length tried, up to 65,536 chained Properties and 32,768 survey
questions (the shape is described under the table below), at stack sizes of
256 KB, 512 KB, 1 MiB (the engine default) and 4 MiB. 256 KB is the smallest
size verified, not a minimum; smaller sizes were not measured.

The one effect a plugin author can see is cost: within one read, a Property's
`compute` may run more than once, roughly twice per Property on a long chain. A
Property that directly reads K dependencies that are each long chains may run up
to about K times. `compute` must already be free of side effects, so this only
matters for how much work it does.

The stack still limits these cases:

1. **Tearing down a long chain.** When the last subscriber of the head of a
   long chain unsubscribes, when a Runtime with such a subscriber is disposed,
   or when a Property stops reading a long chain it used to read (a conditional
   dependency), `alien-signals` unlinks the chain recursively, one level per
   link. This can throw the engine's `RangeError`, and Core cannot remove it
   because it happens inside `alien-signals`. Largest lengths that worked on
   QuickJS:

   | QuickJS stack | Chain: unsubscribe from the head | Chain: dispose with a subscriber | Survey: unsubscribe | Survey: dispose with a subscriber |
   | --- | ---: | ---: | ---: | ---: |
   | 256 KB | 75 Properties | 74 | 37 questions | 37 |
   | 512 KB | 154 | 153 | 77 | 76 |
   | 1 MiB (default) | 312 | 309 | 156 | 154 |
   | 4 MiB | 1,262 | 1,250 | 631 | 625 |

   "Survey" is a document where each question's visibility reads the next
   question's value. A host that only reads and never subscribes (create or
   reuse a Runtime, write State, read Properties) is not affected.
2. **Method recursion.** A Method that invokes Methods is ordinary recursion and
   uses the engine stack, by design.
3. **Chains that alternate between Properties and Methods.** The bound applies
   to Properties reading Properties through declared dependencies. A chain
   Property, Method, Property and so on, or a `compute` that calls another
   Property's public `get()` instead of a declared dependency, starts a new
   bounded segment at every hop, so it is still limited by the stack.
4. **A host that is nearly out of stack.** If the host calls Core with almost no
   stack left, the engine can still overflow, and Core lets its `RangeError`
   through. Afterwards the Runtime's cached Property values may be out of date
   until the next write reaches them.
5. **Very long dependency cycles in an invalid document.** Compilation reports
   every Property of a cycle with a `property-evaluation-cycle` diagnostic. All
   the diagnostics of one cycle share one frozen `related` list that names every
   member of the cycle, so time and memory grow with the cycle length, not with
   its square. Compiling a ring of Properties, one per widget, took in Node 24
   about 40 ms and 100 MB of resident memory for 4,000 members, about 240 ms and
   290 MB for 30,000, and about 2.3 s and 1.5 GB for 300,000. Each member still
   costs one diagnostic, one `related` entry and its own Blueprint node, so the
   document size still sets the cost, and a host that compiles untrusted
   documents should still bound it (see the advice below). Code that copies or
   serializes each diagnostic's `related` list, for example to send it to
   another process, repeats the whole list once per diagnostic and is still
   quadratic.

The Inspector's projection of a very long chain of failing Properties (each
failure wraps its dependency's failure as its `cause`) is also still bounded by
the stack.

Advice for hosts:

- If you subscribe to long chains, size the engine stack for teardown using the
  table. In `rquickjs` the stack size is set with `Runtime::set_max_stack_size`.
  V8 allows longer chains, but its limit moves with JIT state, so do not rely on
  a number there.
- Treat a `RangeError` thrown by a Runtime call as fatal for that Runtime:
  dispose it and create a new one from the Blueprint. A fresh Runtime is always
  correct.
- A host that compiles untrusted documents should bound the document size
  (number of widgets) before compiling.
