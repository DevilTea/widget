# Choice renderer

A choice question: pick one or more options.

## Config (resolved)

`config` is the resolved config: `{ question: I18nText; options: readonly ChoiceOption[]; multiple: boolean; followUp: string | null; }`.

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

## Slots

No slots: `WidgetSlot` is not on the surface.

## Diagnostic reasons

The diagnostics of this type's State, Properties and Methods are a union discriminated by `reason`: `details` is present exactly when the reason has a payload, and has its type.

- `unknown-option` (`details: { id: string; }`): The id names no option of the question.

## Referenced types

```text
// apps/widget-skills/fixtures/survey-system.ts
/** One option of a choice question. */
export interface ChoiceOption {
	/**
	 * The option's identifier, unique within the question.
	 * @pattern ^[a-z][a-z0-9-]*$
	 */
	id: string
	/** The label shown for the option. */
	label: I18nText
}

// apps/widget-skills/fixtures/survey-system.ts
/**
 * Text per language, keyed by language tag (`en`, `zh-TW`).
 * @remarks At least one language should be present; the renderer falls back to the first one.
 */
export type I18nText = Record<string, string>
```
