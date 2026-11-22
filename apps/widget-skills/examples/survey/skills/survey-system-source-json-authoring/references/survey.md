# Survey

A survey: a header, the questions in order, and a footer note.

The root of a survey document. It counts the answered questions through the `questions` contract.

## Config

How the survey is titled and where it is sent.

`config` is required.

Raw config type: `SurveyRawConfig`

```text
// apps/widget-skills/fixtures/survey-system.ts
/** The raw config of a survey. */
export interface SurveyRawConfig {
	/** The survey's title. */
	title: I18nText
	/**
	 * The most questions the survey may hold.
	 * @minimum 1
	 * @maximum 20
	 * @default 10
	 */
	maxQuestions?: number
	/**
	 * Where the answers are sent.
	 * @format uri
	 */
	submitUrl?: string
}

// apps/widget-skills/fixtures/survey-system.ts
/**
 * Text per language, keyed by language tag (`en`, `zh-TW`).
 * @remarks At least one language should be present; the renderer falls back to the first one.
 */
export type I18nText = Record<string, string>
```

## Slots

- `header` (`WidgetChild`): Anything shown above the questions. Expects any widget.
- `questions` (`WidgetContract<{ properties: { answered: boolean } }, 'Rating' | 'Choice'>`): The questions, in order. Every question exposes whether it was answered. Expects Rating or Choice with the members { properties: { answered: boolean; }; }.
- `footer` (`'Note'`): Closing notes shown under the questions. Expects Note.

## Diagnostic reasons

A diagnostic this type reports names one of these `reason`s and carries `details` as shown. Read them to decide the repair.

- `empty-title` (no `details`): The title has no language.
- `too-many-questions` (`details: { max: number; count: number; }`): The `questions` slot holds more questions than `maxQuestions` allows.
