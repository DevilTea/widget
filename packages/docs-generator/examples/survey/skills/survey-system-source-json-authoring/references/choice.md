# Choice

A choice question: pick one or more options.

## Config

The question and its options.

`config` is required.

Raw config type: `{ question: I18nText; options: ChoiceOption[]; multiple?: boolean | undefined; followUp?: WidgetRef<"Rating" | "Choice"> | undefined; }`

```text
// packages/docs-generator/fixtures/survey-system.ts
export type I18nText = Record<string, string>

// packages/docs-generator/fixtures/survey-system.ts
export interface ChoiceOption {
	id: string
	label: I18nText
}
```

Fields:

- `question`: The question asked.
- `options`: The options, in the order shown: at least two.
- `multiple` (optional): Whether more than one option may be chosen.
- `followUp` (optional): A question shown once this one is answered. Must be the id of a widget of type Rating | Choice in the same document.

Types:

- `I18nText`: Text per language, keyed by language tag (`en`, `zh-TW`). At least one language should be present; the renderer falls back to the first one.
- `ChoiceOption`: One option of a choice question.
  - `id`: The option's identifier, unique within the question: a lowercase letter, then lowercase letters, digits or hyphens (`^[a-z][a-z0-9-]*$`).
  - `label`: The label shown for the option.

## Slots

No slots: this widget cannot have children.

## Diagnostic reasons

A diagnostic this type reports names one of these `reason`s and carries `details` as shown. Read them to decide the repair.

- `unknown-option` (`details: { id: string; }`): The id names no option of the question.
  - `id`: The id given.
