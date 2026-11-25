# Choice renderer

A choice question: pick one or more options.

## Config (resolved)

`config` is the resolved config: `{ question: I18nText; options: readonly ChoiceOption[]; multiple: boolean; followUp: string | null; }`.

- `question`: The question asked.
- `options`: The options, in the order shown.
- `multiple`: Whether more than one option may be chosen.
- `followUp`: The id of the question shown once this one is answered, or `null` for none.

## State

| Name | Type | authorWritable | Description |
| --- | --- | --- | --- |
| `selected` | `readonly string[]` | false | The ids of the chosen options. |

## Properties (read-only, computed)

| Name | Type | Description |
| --- | --- | --- |
| `answered` | `boolean` | Whether at least one option was chosen. |

## Methods

### `select(id: string): readonly string[]`

Chooses an option, replacing the choice unless the question takes several.
- `id: string`: The id of the option.
- Returns `readonly string[]`: The ids now chosen. Through `useMethods()` the call returns `readonly string[] | null`: `null` when it failed (read `useMethodDiagnostics().select`).

## Events

- `changed(selected: readonly string[])`: The choice changed.
  - `selected`: The ids now chosen.

## Slots

No slots: `WidgetSlot` is not on the surface.

## Diagnostic reasons

The diagnostics of this type's State, Properties and Methods are a union discriminated by `reason`: `details` is present exactly when the reason has a payload, and has its type.

- `unknown-option` (`details: { id: string; }`): The id names no option of the question.
  - `id`: The id given.

## Referenced types

```text
// packages/docs-generator/fixtures/survey-system.ts
export interface ChoiceOption {
	id: string
	label: I18nText
}

// packages/docs-generator/fixtures/survey-system.ts
export type I18nText = Record<string, string>
```

- `ChoiceOption`: One option of a choice question.
  - `id`: The option's identifier, unique within the question: a lowercase letter, then lowercase letters, digits or hyphens (`^[a-z][a-z0-9-]*$`).
  - `label`: The label shown for the option.
- `I18nText`: Text per language, keyed by language tag (`en`, `zh-TW`). At least one language should be present; the renderer falls back to the first one.
