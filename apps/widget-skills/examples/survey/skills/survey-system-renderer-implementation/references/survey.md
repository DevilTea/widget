# Survey renderer

A survey: a header, the questions in order, and a footer note.

The root of a survey document. It counts the answered questions through the `questions` contract.

## Config (resolved)

`config` is the resolved config: `{ title: I18nText; maxQuestions: number; submitUrl: string | null; }`.

## State

| Name | Type | authorWritable | Description |
| --- | --- | --- | --- |
| `submitted` | `boolean` | false | Whether the survey was sent. |

## Properties (read-only, computed)

| Name | Type | Description |
| --- | --- | --- |
| `progress` | `number` | The share of answered questions, from 0 to 1. |

## Methods

### `submit(): boolean`

Sends the survey.
- Returns `boolean`: Whether the survey was sent by this call. Through `useMethods()` the call returns `boolean | null`: `null` when it failed (read `useMethodDiagnostics().submit`).

## Events

- `submitted(summary: SubmitSummary)`: The survey was sent.

## Slots

- `header` (`WidgetChild`): Anything shown above the questions. Expects any widget.
- `questions` (`WidgetContract<{ properties: { answered: boolean } }, 'Rating' | 'Choice'>`): The questions, in order. Every question exposes whether it was answered. Expects Rating or Choice with the members { properties: { answered: boolean; }; }.
- `footer` (`'Note'`): Closing notes shown under the questions. Expects Note.

Render each with `<WidgetSlot name="...">` from this widget's `useWidget()` result.

## Diagnostic reasons

The diagnostics of this type's State, Properties and Methods are a union discriminated by `reason`: `details` is present exactly when the reason has a payload, and has its type.

- `empty-title` (no `details`): The title has no language.
- `too-many-questions` (`details: { max: number; count: number; }`): The `questions` slot holds more questions than `maxQuestions` allows.

## Referenced types

```text
// apps/widget-skills/fixtures/survey-system.ts
/**
 * Text per language, keyed by language tag (`en`, `zh-TW`).
 * @remarks At least one language should be present; the renderer falls back to the first one.
 */
export type I18nText = Record<string, string>

// apps/widget-skills/fixtures/survey-system.ts
/** What `Survey.submit()` reports when the survey is sent. */
export interface SubmitSummary {
	/** How many questions were answered. */
	answered: number
	/** How many questions the survey has. */
	total: number
}

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
```
