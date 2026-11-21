---
name: widget-plugin-authoring
description: "Write a @deviltea/widget-core plugin: Interfaces as the single source of shape and documentation, builder phases, synchronous callbacks, diagnostics, read-only Methods, async at the host, and the JSDoc tag set."
---

# Writing a Widget plugin

A plugin is built with `createWidgetPlugin(type)` from `@deviltea/widget-core` and describes one widget type:
its config, slots, State, Properties, Methods and Events. Core compiles authored JSON against the registered
plugins into a Blueprint (with diagnostics) and runs a Runtime from a valid Blueprint.

## 1. Declare the Interfaces first

```ts
export interface CounterInterfaces extends WidgetInterfaces {
	config: { raw: CounterRawConfig | null, resolved: CounterConfig }
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
- `config.raw` is what the author writes; include `null` when the config may be left out. `config.resolved`
  is what the plugin and its renderer read.
- Label Event payload tuples (`[count: number]`) and name Method parameters: the names are documentation.

## 2. Builder phases, in this order

`description → interfaces → config? → slots? → structure? → state? → properties? → methods? → events? → done`

- A phase can be skipped but not reordered. Section builders are sealed and capture definitions by value; a
  malformed declaration throws a `TypeError` naming plugin, section, member and field when the plugin is built.
- `.config({ validate, resolve, schema?, description? })`: `validate` always runs (an omitted config is
  validated as `null`) and reports problems with `ctx.addDiagnostic({ message, path, reason })`.
- `.slots({ name: { validateStructure? } })` and `.structure(validateStructure)` check children and placement.
  `.structure` is not a capability.
- `.state`: each member has `validate` and `default`. `authorWritable: true` is passive metadata telling editors
  the value may be set by an author.
- `.properties`: `registerDeps` declares what `compute` reads; `compute` is pure.
- `.methods`: `validateArgs`, `registerDeps`, `emits` (the Events it may emit, required when it emits), `execute`.
- `.events`: declared after the Methods; `emits` names are validated against them in `done()`.

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
- A refused Method call adds a diagnostic with `addDiagnostic({ message, reason })`, writes nothing and emits
  nothing. Refused input is ordinary, not exceptional.
- When 0.3.0 lands, declare the reasons in the Interfaces as `reasons: { reasonName: Payload }` with JSDoc.

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
Run `widget-skills --check` on the System: it fails on a member without JSDoc, an unknown tag, or a name the
types and the runtime disagree on.

See `references/jsdoc-tags.md` for the tag set and `references/example-interfaces.md` for this System's Interfaces.
