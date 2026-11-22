# Choice

A choice question: pick one or more options.

## Config

The question and its options.

`config` is required.

Raw config type: `{ question: I18nText; options: ChoiceOption[]; multiple?: boolean | undefined; followUp?: string | undefined; }`

```text
// apps/widget-skills/fixtures/survey-system.ts
/**
 * Text per language, keyed by language tag (`en`, `zh-TW`).
 * @remarks At least one language should be present; the renderer falls back to the first one.
 */
export type I18nText = Record<string, string>

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
```

## Slots

No slots: this widget cannot have children.

## Diagnostic reasons

A diagnostic this type reports names one of these `reason`s and carries `details` as shown. Read them to decide the repair.

- `unknown-option` (`details: { id: string; }`): The id names no option of the question.
