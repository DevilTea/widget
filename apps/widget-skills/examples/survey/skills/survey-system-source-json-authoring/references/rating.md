# Rating

A rating question: pick a number on a scale.

## Config

The question and its scale.

`config` is required.

Raw config type: `{ question: I18nText; scale?: number | undefined; }`

```text
// apps/widget-skills/fixtures/survey-system.ts
export type I18nText = Record<string, string>
```

Fields:

- `question`: The question asked.
- `scale` (optional): The highest value of the scale, from 3 to 10; the lowest is 1. 5 when left out.

Types:

- `I18nText`: Text per language, keyed by language tag (`en`, `zh-TW`). At least one language should be present; the renderer falls back to the first one.

## Slots

No slots: this widget cannot have children.

## Diagnostic reasons

A diagnostic this type reports names one of these `reason`s and carries `details` as shown. Read them to decide the repair.

- `out-of-range` (`details: { min: number; max: number; received: number; }`): The value is outside the scale.
  - `min`: The lowest allowed value.
  - `max`: The highest allowed value.
  - `received`: The value given.
