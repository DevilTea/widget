# Plugin documentation

## Documentation in the builder

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

**Field docs.** For a value of type `T`, the docs beside its description are complete, and the compiler checks it:

- an object type: `fields`, an entry for every key (optional keys included; for a union, every key of every member);
- an array: `items`, and a dictionary (`Record`, an index signature): `values`, when the element has fields of its own;
- a primitive, a literal union or a widget reference: the description only. `null` and `undefined` are ignored.

**Descriptions.** A description is Markdown prose for a reader who has not seen the code: what the value means and
what `validate` enforces. Constraints (ranges, lengths, patterns, defaults) are stated in it ("At least 1; 10 when
left out.") and enforced by `validate`: the JSON Schema has the shape only. The first paragraph is the summary;
the rest is shown in full where there is room.

**Shared types.** `defineTypeDocs<T>(name, docs)` documents a named type once (its description and its fields);
a field of that type refers to it with `ref`, and a recursive type refers to itself with a thunk
(`items: { ref: () => conditionDocs }`, with the annotation `const conditionDocs: TypeDocs<Condition>`). Use the
type's own name: it is the type's one `$defs` entry in the schemas. A named type documented in two places must be
documented the same way in both (`--check` reports a conflict), so give a type used by several fields or plugins
its `defineTypeDocs`. `defineFieldDocs<T>()(docs)` checks docs held in a variable exactly, at every depth.

**Widget references.** A config field that holds the id of another widget is typed `WidgetRef<'A' | 'B'>` (from
`@deviltea/widget-core`): any string is accepted, nothing is checked at run time, and the schemas say which widget
types the id must name.

**`undocumented`.** The marker type-checks wherever a description or a docs object is required, so a draft or a
test plugin compiles. `widget-docs-generator --check` reports each one as an error, with its plugin and docs path.
