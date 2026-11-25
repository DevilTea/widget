---
name: widget-plugin-authoring
description: "Write a @deviltea/widget-core plugin: the Interfaces type, builder phases, synchronous callbacks, diagnostics, why a failing Method is not rolled back, read-only Methods, async at the host, and the documentation written in the builder."
---

# Writing a Widget plugin

A plugin is built with `createWidgetPlugin(type)` from `@deviltea/widget-core` and describes one widget type:
its config, slots, State, Properties, Methods, Events and diagnostic reasons. Core compiles authored JSON against
the registered plugins into a Blueprint (with diagnostics) and runs a Runtime from a valid Blueprint.

This skill describes the API of the `@deviltea/widget-core` 0.4 line. Check the package's own documentation when
the installed version differs.

## 1. Declare the Interfaces first

The `Interfaces` type is the single source of the plugin's shape. Core stores no schema: JSON Schema is generated
from the types. The prose is written in the builder (section 2).

```text
import type { WidgetRef } from '@deviltea/widget-core'

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
		labels: 'Label' | 'Icon'
	}
	state: {
		count: number
	}
	methods: {
		increment: () => number
	}
	events: {
		changed: [count: number]
	}
	reasons: {
		'invalid-step': { received: unknown }
		'at-limit': void
	}
}
```

- A capability exists only when its key is a required property of the Interfaces type. Leave a key out to not
  have the capability; `slots: never` is the explicit "declared, empty" spelling.
- `config.raw` is what the author writes; include `null` when the config may be left out (an omitted config is
  validated as `null`). `config.resolved` is what the plugin and its renderer read.
- A config field that holds another widget's id is a `WidgetRef<Types>`: it names the widget types the id may
  name. It is type-level only: nothing checks it at run time.
- `slots` is a record: each key is a slot name and each value what the slot expects of its children: a union of
  plugin `type` literals (`'Label' | 'Icon'`), `WidgetContract<Shape>` (any widget that has the members of
  `Shape`), `WidgetContract<Shape, 'Label' | 'Icon'>` (the named types, each of which must have them), or
  `WidgetChild` (any widget). The expectation is type-level only: Core checks nothing at run time, so enforce it in
  the slot's `validateStructure` when it matters.
- `reasons` lists the diagnostic reasons the plugin reports. Each value is the type of the diagnostic's
  `details` (`void` for none); `details` must be a JSON value.
- Label Event payload tuples (`[count: number]`) and name Method parameters: the names show up in the generated
  references, and the docs of each position are written by position in the builder.

## 2. Builder phases, in this order, with their docs

`description → interfaces → config? → slots? → structure? → state? → properties? → methods? → events? → reasons? → done`

```text
createWidgetPlugin('Counter')
	.description('A counter that counts in steps.')
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
		validate: (input, ctx): input is CounterRawConfig | null => { /* ... */ },
		resolve: raw => ({ step: raw?.step ?? 1, mirrorOf: raw?.mirrorOf ?? null }),
	})
	.slots({ labels: { description: 'Labels shown next to the count.' } })
	.state(state => state.count({
		description: 'The current count.',
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.methods(methods => methods.increment({
		description: 'Adds one step.',
		returns: { description: 'The new count.' },
		/* validateArgs, registerDeps, emits, execute */
	}))
	.events({ changed: { description: 'The count changed.', payload: [{ description: 'The new count.' }] } })
	.reasons({
		'invalid-step': { description: 'The step is not a positive whole number.', details: { fields: { received: { description: 'The value given.' } } } },
		'at-limit': { description: 'The count reached its limit.' },
	})
	.done()
```

- `.description(text)` comes first; then `.interfaces<Interfaces>()`. A later phase can be skipped but not
  reordered. Section builders are sealed and capture definitions by value; a malformed declaration throws a
  `TypeError` naming plugin, section, member and field when the plugin is built.
- Every definition carries its docs (see `references/plugin-docs.md`): the compiler requires a description for every
  member and field docs for every field, so nothing can be left undocumented by accident.
- `.config({ description, raw, resolved, validate, resolve })`: `validate` always runs and reports problems with
  `ctx.addDiagnostic({ message, path, reason, details })`; `resolve` turns the raw config into the resolved one
  (and is called with `null` when validation failed).
- `.slots({ name: { description, validateStructure? } })`: one complete map, every declared slot present.
- `.structure(validateStructure)`: the plugin-level structure check. It is not a capability.
- `.state`: each member has `description`, `validate` and `default`. `authorWritable: true` is passive metadata
  telling editors the value may be set by an author.
- `.properties`: `registerDeps` declares what `compute` reads; `compute` is pure. In a plugin with slots,
  `registerDeps` gets `slot(name)`: the resolved children of the widget's own slot, each a dependency target. A
  `WidgetContract` slot types their reads by its `Shape`; other slots give untyped reads (refine with
  `.validate()`).
- `.methods`: `description`, `params`, `returns`, `validateArgs`, `registerDeps`, `emits` (the Events it may
  emit, required when it emits), `execute`.
- `.events({ changed: { description, payload } })`: one entry for every Event of the Interfaces. Events are
  declared after the Methods; `emits` names are validated against them in `done()`.
- `.reasons({ ... })`: one entry for every reason of the Interfaces. It records docs only.

## 3. Every callback is synchronous

All framework-owned callbacks (`validate`, `resolve`, `default`, `compute`, `validateArgs`, `execute`, the
structure validators) are synchronous. Returning a Promise or thenable is a contract violation: a type error
where Core can infer it, and a runtime throw otherwise. Callback contexts close when the callback returns:
`addDiagnostic`, `hasAnyDiagnostic`, `deps.*` and `emit` must not be kept and called later.

## 4. Async work belongs to the host

A Method records intent and emits an Event; the host (the page, the renderer's owner) listens, does the waiting
(fetch, timers, a backend) and calls another Method with the outcome. The widget never awaits. Model the waiting
as State (`pending`, `confirmed`, `declined`) so the renderer can show it.

## 5. Failure is a diagnostic, not an exception

- Config and structure problems are Blueprint diagnostics with a `path`, and, when the plugin gave them, a
  `reason` and its `details`. Once `reasons` is declared, a `reason` outside it, a missing payload, a payload on
  a `void` reason and `details` without a `reason` are type errors.
- A Method reports a refusal with `addDiagnostic({ message, reason, details })`. Its result is then a failure
  (`invalid-method-arguments` from `validateArgs`, `invalid-method-result` from `execute`), and the value it
  returned is diagnostic context only.
- **A failing Method is not rolled back.** Core batches a Method's writes so subscribers are notified once, but
  that is propagation atomicity, not a transaction: a State write or an emitted Event that happened before a
  later failure stays. So refuse first: reject bad arguments in `validateArgs` (then `execute` never runs), and
  in `execute` check every condition and `return` before the first `deps.set...()` or `emit`.

## 6. Read-only Methods

A Method is read-only when it neither writes State nor emits an Event, itself or through the Methods it invokes.
Only a read-only Method may be a dependency of a Property (otherwise: `property-dependency-has-side-effects`).
Put shared rules in a read-only Method (for example `canEnter(index)`) and let the writing Methods invoke it, so
the rule exists once.

## 7. Source rules worth knowing

A widget node's recognized keys are `id`, `type`, `config`, `slots` and `meta`; anything else is
`unexpected-widget-field`. Duplicate ids are `duplicate-widget-id`. Unknown config keys are the plugin's to reject.

## 8. Register and check

`createWidgetSystem({ plugins: [A, B] as const })`: keep the tuple `as const` so the System's type lists every
plugin. It is a type error when a slot names an unregistered plugin type, or when a plugin named by a
`WidgetContract<Shape, Types>` lacks a member of `Shape`. An application loads exactly one Core instance; a
plugin library declares Core as a peer dependency. Check the documentation of the System with the generator's
`--check`: it fails on an `undocumented` marker, on a name the types and the runtime or the docs disagree on, and
on a named type documented two different ways.

See `references/plugin-docs.md` for the documentation rules and `references/example-interfaces.md` for this
System's Interfaces.
