# JSDoc tags

## JSDoc tag set

Document the `XxxInterfaces` type itself and every member of it with JSDoc: `config` and each field of its `raw`
type, each slot, State member, Property, Method and its parameters, Event and reason (and each field of a reason's
payload). The JSDoc is the only documentation: Core carries no descriptions at run time. The tags are
TSDoc-compatible; the custom ones are declared in `tsdoc.json`.

| Tag | Applies to | Meaning |
| --- | --- | --- |
| summary (first paragraph) | every member | What it is, for an author who has not read the code. |
| `@remarks` | every member | Longer explanation: rules, interplay with other members. |
| `@format` | strings | A named format (`date`, `email`, `uri`, ...). |
| `@pattern` | strings | A regular expression the value matches. |
| `@minimum`, `@maximum`, `@exclusiveMinimum`, `@exclusiveMaximum`, `@multipleOf` | numbers | Numeric bounds. |
| `@minLength`, `@maxLength` | strings | Length bounds. |
| `@integer` | numbers | The number is a whole number (written bare). |
| `@minItems`, `@maxItems` | arrays | Size bounds. |
| `@uniqueItems` | arrays | No two items are equal (written bare). |
| `@minProperties`, `@maxProperties` | dictionaries | Bounds on the number of keys. |
| `@propertyNames` | dictionaries | A regular expression every key matches. |
| `@default` | config properties | The value used when it is left out, as JSON. |
| `@examples` | any value | A JSON array of example values. |
| `@widgetRef A | B` | strings | The value is the id of a widget of one of these types. |
| `@param name - text`, `@returns` | Methods | Argument and result documentation. Every parameter needs one. |

Constraint tags (`@format`, `@pattern`, `@minimum`, `@maximum`, `@exclusiveMinimum`, `@exclusiveMaximum`, `@multipleOf`, `@minLength`, `@maxLength`, `@minItems`, `@maxItems`, `@uniqueItems`, `@minProperties`, `@maxProperties`, `@propertyNames`, `@integer`, `@default`, `@examples`, `@widgetRef`) become keywords in the full JSON Schema and prose
in the LLM schema. A string or number tag (`@pattern`, `@format`, the length and numeric bounds, `@integer`) on an
array or a dictionary applies to each item or value, also through `| null` and a named type; a tag that constrains
nothing on its value (a `@pattern` on a list of objects) is left out of the schemas and fails `widget-skills --check`. They document; `config.validate` and the State and Method validators enforce. The standard
TSDoc tags (`@see`, `@example`, `@deprecated`, `@throws`, `@defaultValue`, `@typeParam`, `@internal`, `@beta`, ...)
are accepted and not interpreted. Any other tag fails `widget-skills --check`.
