# JSDoc tags

## JSDoc tag set

The `XxxInterfaces` type and its JSDoc are the single source of a plugin's shape and documentation. Every member
(config property, State, Property, Method, Event, slot, reason) needs a summary. The tags are TSDoc-compatible;
the custom ones are declared in `tsdoc.json`.

| Tag | Applies to | Meaning |
| --- | --- | --- |
| summary (first paragraph) | every member | What it is, for an author who has not read the code. |
| `@remarks` | every member | Longer explanation: rules, interplay with other members. |
| `@format` | strings | A named format (`date`, `email`, `uri`, ...). |
| `@pattern` | strings | A regular expression the value matches. |
| `@minimum`, `@maximum`, `@exclusiveMinimum`, `@exclusiveMaximum`, `@multipleOf` | numbers | Numeric bounds. |
| `@minLength`, `@maxLength` | strings | Length bounds. |
| `@minItems`, `@maxItems` | arrays | Size bounds. |
| `@default` | config properties | The value used when it is left out, as JSON. |
| `@examples` | any value | A JSON array of example values. |
| `@widgetRef A | B` | strings | The value is the id of a widget of one of these types. |
| `@param name - text`, `@returns` | Methods | Argument and result documentation. |

Constraint tags (`@format`, `@pattern`, `@minimum`, `@maximum`, `@exclusiveMinimum`, `@exclusiveMaximum`, `@multipleOf`, `@minLength`, `@maxLength`, `@minItems`, `@maxItems`, `@default`, `@examples`, `@widgetRef`) become keywords in the full JSON Schema and prose
in the LLM schema. They document; `config.validate` and the State/Method validators enforce. Any other tag fails
`widget-skills --check`.
