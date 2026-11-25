---
name: widget-plugin-authoring
description: "Write a @deviltea/widget-core plugin: the Interfaces type, the builder phases and the docs beside each definition, synchronous callbacks, diagnostics with reasons, why a failing Method is not rolled back, read-only Methods, async work at the host, and registering plugins in a System."
---

# Writing a Widget plugin

A plugin is built with `createWidgetPlugin(type)` from `@deviltea/widget-core` and describes one widget type: its
config, slots, State, Properties, Methods, Events and diagnostic reasons. Core compiles authored JSON against the
registered plugins into a Blueprint (with diagnostics) and runs a Runtime from a valid Blueprint.

This skill ships with `@deviltea/widget-core` and describes the version it was installed with. Its code samples are
compiled and run against that version before it is published.

## 1. A complete plugin

The `Interfaces` type is the single source of the plugin's shape. Core stores no schema: tooling infers JSON Schema
from the types. The prose is written in the builder, beside each definition, and Core keeps it as plain data on
`plugin.docs`.

<!-- sample: plugin-authoring-counter run -->
```ts
import type { WidgetRef } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

export interface CounterRawConfig {
	step?: number
	mirrorOf?: WidgetRef<'Counter'>
}

export interface CounterInterfaces {
	config: {
		raw: CounterRawConfig | null
		resolved: { step: number, mirrorOf: string | null }
	}
	slots: {
		labels: 'Label'
	}
	state: {
		count: number
	}
	properties: {
		atLimit: boolean
	}
	methods: {
		increment: () => number
	}
	events: {
		changed: [count: number]
	}
	reasons: {
		'invalid-step': { min: number }
		'at-limit': { limit: number }
	}
}

const LIMIT = 10

export const Counter = createWidgetPlugin('Counter')
	.description('A counter that counts in steps, up to 10.')
	.interfaces<CounterInterfaces>()
	.config({
		description: 'How the counter counts.',
		raw: {
			fields: {
				step: { description: 'How much one step adds: a whole number of at least 1; 1 when left out.' },
				mirrorOf: { description: 'Another counter whose count this one shows.' },
			},
		},
		resolved: {
			fields: {
				step: { description: 'How much one step adds.' },
				mirrorOf: { description: 'The mirrored counter, or null for none.' },
			},
		},
		// An authoritative predicate: it checks every field and rejects unknown keys.
		validate: (input, ctx): input is CounterRawConfig | null => {
			if (input === null)
				return true
			if (typeof input !== 'object' || Array.isArray(input)) {
				ctx.addDiagnostic({ message: 'The config must be an object or null.' })
				return false
			}
			const { step, mirrorOf, ...unknown } = input as Record<string, unknown>
			for (const key of Object.keys(unknown))
				ctx.addDiagnostic({ message: `Unknown config key "${key}".`, path: [key] })
			if (step !== undefined && !(typeof step === 'number' && Number.isInteger(step) && step >= 1))
				ctx.addDiagnostic({ message: 'step must be a whole number of at least 1.', path: ['step'], reason: 'invalid-step', details: { min: 1 } })
			if (mirrorOf !== undefined && typeof mirrorOf !== 'string')
				ctx.addDiagnostic({ message: 'mirrorOf must be the id of a widget.', path: ['mirrorOf'] })
			// Any reported diagnostic fails the validation, whatever `validate` returns.
			return !ctx.hasAnyDiagnostic()
		},
		resolve: raw => ({ step: raw?.step ?? 1, mirrorOf: raw?.mirrorOf ?? null }),
	})
	.slots({ labels: { description: 'Labels shown next to the count.' } })
	.state(state => state.count({
		description: 'The current count.',
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.properties(properties => properties.atLimit({
		description: 'Whether the next step would pass the limit.',
		registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
		compute: ({ deps, config }) => {
			const count = deps.count()
			return (count.ok ? count.value ?? 0 : 0) + config.step > LIMIT
		},
	}))
	.methods(methods => methods.increment({
		description: 'Adds one step, unless that passes the limit.',
		returns: { description: 'The new count.' },
		validateArgs: (args): args is [] => args.length === 0,
		registerDeps: ({ dep }) => ({ count: dep.self.state.get('count'), setCount: dep.self.state.set('count') }),
		emits: ['changed'],
		execute: ({ deps, config, emit, addDiagnostic }) => {
			const current = deps.count()
			const count = current.ok ? current.value ?? 0 : 0
			if (count + config.step > LIMIT) {
				// Refuse before the first write: a failing Method is not rolled back.
				addDiagnostic({ message: 'The count would pass the limit.', reason: 'at-limit', details: { limit: LIMIT } })
				return count
			}
			deps.setCount(count + config.step)
			emit.changed(count + config.step)
			return count + config.step
		},
	}))
	.events({ changed: { description: 'The count changed.', payload: [{ description: 'The new count.' }] } })
	.reasons({
		'invalid-step': { description: 'The step is not a whole number of at least 1.', details: { fields: { min: { description: 'The smallest step.' } } } },
		'at-limit': { description: 'A step would pass the limit.', details: { fields: { limit: { description: 'The largest count.' } } } },
	})
	.done()

export const Label = createWidgetPlugin('Label')
	.description('A label without config.')
	.interfaces<Record<never, never>>()
	.done()

// Keep the tuple `as const`: the System's type then lists every plugin.
const system = createWidgetSystem({ plugins: [Counter, Label] as const })

const refused = system.createBlueprint({ id: 'counter', type: 'Counter', config: { step: 0 } })
console.log(refused.status, refused.diagnostics.map(diagnostic => diagnostic.code)) // invalid [ 'invalid-widget-config' ]

// A wrongly typed field and an unknown key are refused too, each at its path.
const mistyped = system.createBlueprint({ id: 'counter', type: 'Counter', config: { step: 2, mirrorOf: 42, typo: 1 } })
console.log(mistyped.status, mistyped.diagnostics.map(diagnostic => diagnostic.code === 'invalid-widget-config' ? diagnostic.path : null))
// invalid [ [ 'typo' ], [ 'mirrorOf' ] ]

const blueprint = system.createBlueprint({
	id: 'counter',
	type: 'Counter',
	config: { step: 4 },
	slots: { labels: [{ id: 'label', type: 'Label' }] },
})
if (blueprint.status !== 'valid')
	throw new Error('The document is invalid.')
const runtime = blueprint.createRuntime()
const counter = runtime.getWidget('counter')
if (counter?.type !== 'Counter')
	throw new Error('No counter.')
counter.methods.increment()
console.log(counter.methods.increment()) // { ok: true, value: 8 }
const third = counter.methods.increment()
console.log(third.ok, counter.state.count.get()) // false 8
for (const diagnostic of counter.methods.increment.getDiagnostics()) {
	if (diagnostic.code === 'invalid-method-result')
		console.log(diagnostic.reason, diagnostic.details) // at-limit { limit: 10 }
}
runtime.dispose()
```

## 2. The Interfaces type

- A capability exists only when its key is a required property of the Interfaces type. Leave a key out to not have
  the capability; `slots: never` is the explicit "declared, empty" spelling, and an empty record is too.
- `config.raw` is what the author writes; include `null` when the config may be left out (an omitted config is
  validated as `null`). `config.resolved` is what the plugin and its renderer read.
- A config field that holds another widget's id is a `WidgetRef<Types>`: it names the widget types the id may name.
  It is type-level only: any string is accepted and nothing checks it at run time.
- `slots` is a record: each key is a slot name and each value what the slot expects of its children:
  - a union of plugin `type` literals (`'Label' | 'Icon'`);
  - `WidgetContract<Shape>`: any widget that has the members of `Shape` (`{ state?, properties?, methods?, events? }`);
  - `WidgetContract<Shape, 'Label' | 'Icon'>`: the named types, each of which must have them;
  - `WidgetChild`: any widget.

  The expectation is type-level only: Core checks nothing at run time, so enforce it in the slot's
  `validateStructure` when it matters.
- `reasons` lists the diagnostic reasons the plugin reports. Each value is the type of the diagnostic's `details`
  (`void` for none); `details` must be a JSON value.
- Label Event payload tuples (`[count: number]`) and name Method parameters: the names show up in generated
  references, and the docs of each position are written by position in the builder (`params`, `payload`).

## 3. Builder phases, in this order, with their docs

`description → interfaces → config? → slots? → structure? → state? → properties? → methods? → events? → reasons? → done`

- `.description(text)` comes first; then `.interfaces<Interfaces>()`. A later phase can be skipped but not reordered.
  Section builders are sealed and capture definitions by value; a malformed declaration throws a `TypeError` naming
  plugin, section, member and field when the plugin is built.
- Every definition carries its docs (see `references/plugin-docs.md`): the compiler requires a description for every
  member and field docs for every field, so nothing is left undocumented by accident.
- `.config({ description, raw, resolved, validate, resolve })`: `validate` always runs and reports problems with
  `ctx.addDiagnostic({ message, path, reason, details })`; `resolve` turns the raw config into the resolved one (and is
  called with `null` when validation failed). Validation fails when `validate` returns `false` or reports any
  diagnostic, even if it then returns `true`: a diagnostic is never a warning. A rejected config is the Blueprint
  diagnostic `invalid-widget-config`.
- `.slots({ name: { description, validateStructure? } })`: one complete map, every declared slot present.
- `.structure(validateStructure)`: the plugin-level structure check. It is not a capability.
- `.state`: each member has `description`, `validate` and `default`. `authorWritable: true` is passive metadata
  telling editors the value may be set by an author.
- `.properties`: `registerDeps` declares what `compute` reads; `compute` is pure. In a plugin with slots,
  `registerDeps` gets `slot(name)`: the resolved children of the widget's own slot, each a dependency target. A
  `WidgetContract` slot types their reads by its `Shape`; other slots give untyped reads (refine with `.validate()`).
- `.methods`: `description`, `params` (one entry per parameter, required when there is one), `returns` (required when
  it returns a value), `validateArgs`, `registerDeps`, `emits` (the Events it may emit, required when it emits),
  `execute`.
- `.events({ changed: { description, payload } })`: one entry for every Event of the Interfaces. Events are declared
  after the Methods; `emits` names are checked against them in `done()`.
- `.reasons({ ... })`: one entry for every reason of the Interfaces, required when `reasons` is declared. It records
  docs only.

## 4. Every callback is synchronous

All framework-owned callbacks (`validate`, `resolve`, `default`, `compute`, `validateArgs`, `execute`, the structure
validators) are synchronous. Returning a Promise or thenable is a contract violation: a type error where Core can
infer it, and a runtime throw otherwise. Callback contexts close when the callback returns: `addDiagnostic`,
`hasAnyDiagnostic`, `deps.*` and `emit` must not be kept and called later.

## 5. Async work belongs to the host

A Method records intent and emits an Event; the host (the page, the renderer's owner) listens, does the waiting
(fetch, timers, a backend) and calls another Method with the outcome. The widget never awaits. Model the waiting as
State (`pending`, `confirmed`, `declined`) so the renderer can show it.

## 6. Failure is a diagnostic, not an exception

- Config and structure problems are Blueprint diagnostics with a `path`, and, when the plugin gave them, a `reason`
  and its `details`. Once `reasons` is declared, a `reason` outside it, a missing payload, a payload on a `void` reason
  and `details` without a `reason` are type errors.
- A Method reports a refusal with `addDiagnostic({ message, reason, details })`. Its result is then a failure
  (`invalid-method-arguments` from `validateArgs`, `invalid-method-result` from `execute`), and the value it returned
  is diagnostic context only. The Method's `getDiagnostics()` on the Runtime lists them.
- **A failing Method is not rolled back.** Core batches a Method's writes so subscribers are notified once, but that
  is propagation atomicity, not a transaction: a State write or an emitted Event that happened before a later failure
  stays. So refuse first: reject bad arguments in `validateArgs` (then `execute` never runs), and in `execute` check
  every condition and `return` before the first `deps.set...()` or `emit`.

## 7. Read-only Methods

A Method is read-only when it neither writes State nor emits an Event, itself or through the Methods it invokes. Only
a read-only Method may be a dependency of a Property (otherwise: `property-dependency-has-side-effects`). Put shared
rules in a read-only Method (for example `canEnter(index)`) and let the writing Methods invoke it, so the rule exists
once.

## 8. Source rules worth knowing

A widget node's recognized keys are `id`, `type`, `config`, `slots` and `meta`; anything else is
`unexpected-widget-field`. Duplicate ids are `duplicate-widget-id`. Unknown config keys are the plugin's to reject.

## 9. Register and check

`createWidgetSystem({ plugins: [A, B] as const })`: keep the tuple `as const` so the System's type lists every plugin.
It is a type error when a slot names an unregistered plugin type, or when a plugin named by a
`WidgetContract<Shape, Types>` lacks a member of `Shape`. An application loads exactly one Core instance; a plugin
library declares `@deviltea/widget-core` as a peer dependency and never bundles it.

The documentation generator (`@deviltea/widget-docs-generator`, its bin `widget-docs-generator --check`) checks the
documentation of a System. Every problem it reports is an error:

- `undocumented`: an `undocumented` marker, with its plugin and docs path;
- `missing-doc`: docs an untyped plugin left out, or a plugin without `plugin.docs`;
- `name-mismatch`: a name the types, the runtime and the docs disagree on;
- `docs-conflict`: a named type documented two different ways;
- `unused-doc`: a description no output can show (at `raw`, `resolved` or a reason's `details` of a value that is not
  one named type);
- `no-docs`: the System was not imported (`--no-runtime`), so no prose was read.

See `references/plugin-docs.md` for the documentation rules and `references/example-interfaces.md` for the
Interfaces of a small System that uses every capability and every slot form.
