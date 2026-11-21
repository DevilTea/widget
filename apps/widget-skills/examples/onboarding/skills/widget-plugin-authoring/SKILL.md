---
name: widget-plugin-authoring
description: "Write a @deviltea/widget-core plugin: the Interfaces type, builder phases, synchronous callbacks, diagnostics, why a failing Method is not rolled back, read-only Methods, async at the host, and the JSDoc tag set."
---

# Writing a Widget plugin

A plugin is built with `createWidgetPlugin(type)` from `@deviltea/widget-core` and describes one widget type:
its config, slots, State, Properties, Methods and Events. Core compiles authored JSON against the registered
plugins into a Blueprint (with diagnostics) and runs a Runtime from a valid Blueprint.

This skill describes the API of the `@deviltea/widget-core` version it was generated against. Check the
package's own documentation when the installed version differs.

## 1. Declare the Interfaces first

```text
export interface CounterInterfaces extends WidgetInterfaces {
	config: { raw: CounterRawConfig | null, resolved: CounterConfig }
	slots: 'items'
	state: {
		/** The current count. */
		count: number
	}
	methods: {
		/**
		 * Adds to the count.
		 * @param by - How much to add.
		 * @returns The new count.
		 */
		increment: (by: number) => number
	}
	events: {
		/** The count changed. */
		changed: [count: number]
	}
}
```

- A capability exists only when its key is a required property of the Interfaces type. Leave a key out to not
  have the capability; `slots: never` is the explicit "declared, empty" spelling.
- `config.raw` is what the author writes; include `null` when the config may be left out (an omitted config is
  validated as `null`). `config.resolved` is what the plugin and its renderer read.
- `slots` is a union of slot names.
- Label Event payload tuples (`[count: number]`) and name Method parameters: the names are documentation.

## 2. Builder phases, in this order

`description → interfaces → config? → slots? → structure? → state? → properties? → methods? → events? → done`

- A phase can be skipped but not reordered. Section builders are sealed and capture definitions by value; a
  malformed declaration throws a `TypeError` naming plugin, section, member and field when the plugin is built.
- `.description(text)`: required, the plugin's description for catalogs.
- `.config({ description, validate, resolve, schema? })`: `description` is required. `validate` always runs and
  reports problems with `ctx.addDiagnostic({ message, path, reason })`; `resolve` turns the raw config into the
  resolved one (and is called with `null` when validation failed).
- `.slots({ name: { description, validateStructure? } })`: one complete map, every declared slot present, each with
  a required `description`.
- `.structure(validateStructure)`: the plugin-level structure check. It is not a capability.
- `.state`: each member has `validate` and `default`. `authorWritable: true` is passive metadata telling editors
  the value may be set by an author.
- `.properties`: `registerDeps` declares what `compute` reads; `compute` is pure.
- `.methods`: `validateArgs`, `registerDeps`, `emits` (the Events it may emit, required when it emits), `execute`.
- `.events`: each Event has a required `description`. Events are declared after the Methods; `emits` names are
  validated against them in `done()`.

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

- Config and structure problems are Blueprint diagnostics with a `path` and a machine-readable `reason`.
- A Method reports a refusal with `addDiagnostic({ message, reason })`. Its result is then a failure
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
plugin. An application loads exactly one Core instance; a plugin library declares Core as a peer dependency.
Run `widget-skills --check` on the System: it fails on a member without documentation, an unknown tag, or a name
the types and the runtime disagree on.

## Upcoming in 0.3.0 (not in the version this skill describes)

The accepted design makes the Interfaces type and its JSDoc the single source of a plugin's documentation:
`slots` becomes a record `{ /** doc */ name: Expected }`, diagnostic reasons are declared as
`reasons: { reasonName: Payload }`, and the runtime `description` fields go away. Do not write either form until
the installed Core has it.

See `references/jsdoc-tags.md` for the tag set and `references/example-interfaces.md` for this System's Interfaces.
