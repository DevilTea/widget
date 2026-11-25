# Plugin documentation

A plugin's prose is written in the builder, beside each definition, and Core keeps it as plain data on
`plugin.docs`. The `Interfaces` type is the shape; a comment on it is an ordinary comment that no tool reads.
Documentation tools take the shape from the types and every description from `plugin.docs`.

| Where | What it documents |
| --- | --- |
| `.description(text)` | The plugin. The first phase of the builder. |
| `.config({ description, raw, resolved, ... })` | The config, and the fields of the raw and the resolved config (field docs). |
| `.slots({ name: { description } })` | Each slot. |
| State and Property definitions: `description` plus field docs | The value, and its fields when it has any. |
| Method definitions: `description`, `params`, `returns` | The Method, one entry per parameter (by position), and the return value (left out when it returns nothing). |
| `.events({ name: { description, payload } })` | Each Event of the Interfaces, and one entry per payload position. |
| `.reasons({ reason: { description, details } })` | Each diagnostic reason; `details` documents the payload and is left out for `void`. |

## Field docs

For a value of type `T`, the docs beside its description are complete when the compiler accepts them:

- an object type: `fields`, an entry for every key (optional keys included; for a union, every key of every member);
- an array: `items`, and a dictionary (`Record`, an index signature): `values`, when the element has fields of its own;
- a primitive, a literal union or a widget reference: the description only. `null` and `undefined` are ignored.

An index signature mixed with fixed keys is a dictionary: it takes `values`, which documents every value. Whether
`items` or `values` is required is decided at most four nested arrays or dictionaries deep.

## Descriptions

A description is Markdown prose for a reader who has not seen the code: what the value means and what `validate`
enforces. Constraints (ranges, lengths, patterns, defaults) are stated in it ("At least 1; 10 when left out.") and
enforced by `validate`: the JSON Schema has the shape only. The first paragraph is the summary; the rest is shown in
full where there is room.

## Shared types

`defineTypeDocs<T>(name, docs)` documents a named object type once (its description and its fields); a field of that
type refers to it with `ref`, and a recursive type refers to itself with a thunk (`items: { ref: () => conditionDocs }`,
with the annotation `const conditionDocs: TypeDocs<Condition>`). Use the type's own name: it is the type's one `$defs`
entry in generated schemas. A named type documented in two places must be documented the same way in both, so give a
type used by several fields or plugins its `defineTypeDocs`.

<!-- sample: plugin-docs-shared-types run -->
```ts
import type { TypeDocs } from '@deviltea/widget-core'
import { createWidgetPlugin, defineTypeDocs } from '@deviltea/widget-core'

type Condition
	= | { op: 'all', conditions: readonly Condition[] }
		| { op: 'answered', question: string }

// Recursive: the annotation is required.
const conditionDocs: TypeDocs<Condition> = defineTypeDocs<Condition>('Condition', {
	description: 'A rule over the answers.',
	fields: {
		op: { description: 'The kind of rule.' },
		conditions: { description: 'Every rule that must hold.', items: { ref: () => conditionDocs } },
		question: { description: 'The question that must be answered.' },
	},
})

interface StepConfig {
	visibleWhen?: Condition
	completeWhen: Condition
}

const step = createWidgetPlugin('Step')
	.description('One step of a form.')
	.interfaces<{ config: { raw: StepConfig, resolved: StepConfig } }>()
	.config({
		description: 'When the step is shown and when it is complete.',
		raw: {
			fields: {
				visibleWhen: { description: 'Shown only while this rule holds; always shown when left out.', ref: conditionDocs },
				completeWhen: { description: 'Complete once this rule holds.', ref: conditionDocs },
			},
		},
		resolved: {
			fields: {
				visibleWhen: { description: 'The visibility rule, if any.', ref: conditionDocs },
				completeWhen: { description: 'The completion rule.', ref: conditionDocs },
			},
		},
		validate: (input): input is StepConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw ?? { completeWhen: { op: 'all', conditions: [] } },
	})
	.done()

console.log(step.docs.config?.raw?.fields?.completeWhen?.ref) // Condition
console.log(Object.keys(step.docs.types)) // [ 'Condition' ]
```

`defineFieldDocs<T>()(docs)` checks docs held in a variable or built with a spread exactly, at every depth (the builder
sections only get TypeScript's check of a fresh object literal):

<!-- sample: plugin-docs-define-field-docs after -->
```ts
import { defineFieldDocs } from '@deviltea/widget-core'

interface Address {
	street: string
	city: string
}

export const addressDocs = defineFieldDocs<Address>()({
	description: 'A postal address.',
	fields: {
		street: { description: 'The street and number.' },
		city: { description: 'The city.' },
	},
})
```

## Widget references

A config field that holds the id of another widget is typed `WidgetRef<'A' | 'B'>` (from `@deviltea/widget-core`):
any string is accepted, nothing is checked at run time, and generated schemas say which widget types the id must name.
Its docs are a description only.

## `undocumented`

The marker type-checks wherever a description or a docs object is required, so a draft or a test plugin compiles.
The documentation generator's `--check` reports each one as an error, with its plugin and docs path.

<!-- sample: plugin-docs-undocumented run -->
```ts
import { createWidgetPlugin, undocumented } from '@deviltea/widget-core'

const draft = createWidgetPlugin('Draft')
	.description(undocumented)
	.interfaces<{ state: { value: number } }>()
	.state(state => state.value({
		description: undocumented,
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.done()

console.log(draft.docs.description, draft.docs.state?.value?.description) // null null
```
