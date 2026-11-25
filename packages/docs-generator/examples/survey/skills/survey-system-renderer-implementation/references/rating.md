# Rating renderer

A rating question: pick a number on a scale.

## Config (resolved)

`config` is the resolved config: `{ question: I18nText; scale: number; }`.

- `question`: The question asked.
- `scale`: The highest value of the scale; the lowest is 1.

## State

| Name | Type | authorWritable | Description |
| --- | --- | --- | --- |
| `value` | `number \| null` | true | The chosen value, or `null` while unanswered. An editor may preset it. |

## Properties (read-only, computed)

| Name | Type | Description |
| --- | --- | --- |
| `answered` | `boolean` | Whether a value was chosen. |

## Methods

### `rate(value: number): number`

Chooses a value.
- `value: number`: The value, from 1 to the scale.
- Returns `number`: The chosen value. Through `useMethods()` the call returns `number | null`: `null` when it failed (read `useMethodDiagnostics().rate`).

## Events

- `rated(value: number)`: A value was chosen.
  - `value`: The chosen value.

## Slots

No slots: `WidgetSlot` is not on the surface.

## Diagnostic reasons

The diagnostics of this type's State, Properties and Methods are a union discriminated by `reason`: `details` is present exactly when the reason has a payload, and has its type.

- `out-of-range` (`details: { min: number; max: number; received: number; }`): The value is outside the scale.
  - `min`: The lowest allowed value.
  - `max`: The highest allowed value.
  - `received`: The value given.

## Referenced types

```text
// packages/docs-generator/fixtures/survey-system.ts
export type I18nText = Record<string, string>
```

- `I18nText`: Text per language, keyed by language tag (`en`, `zh-TW`). At least one language should be present; the renderer falls back to the first one.
