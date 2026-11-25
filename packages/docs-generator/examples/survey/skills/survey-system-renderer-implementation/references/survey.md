# Survey renderer

A survey: a header, the questions in order, and a footer note.

The root of a survey document. It counts the answered questions through the `questions` contract.

## Config (resolved)

`config` is the resolved config: `{ title: I18nText; maxQuestions: number; submitUrl: string | null; }`.

- `title`: The survey's title.
- `maxQuestions`: The most questions the survey may hold.
- `submitUrl`: Where the answers are sent, or `null` when they are not sent anywhere.

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
  - `summary`: How many questions were answered, of how many.

## Slots

- `header` (`WidgetChild`): Anything shown above the questions. Expects any widget.
- `questions` (`WidgetContract<{ properties: { answered: boolean } }, 'Rating' | 'Choice'>`): The questions, in order. Every question exposes whether it was answered. Expects Rating or Choice with the members { properties: { answered: boolean; }; }.
- `footer` (`'Note'`): Closing notes shown under the questions. Expects Note.

Render each with `<WidgetSlot name="...">` from this widget's `useWidget()` result.

## Diagnostic reasons

The diagnostics of this type's State, Properties and Methods are a union discriminated by `reason`: `details` is present exactly when the reason has a payload, and has its type.

- `empty-title` (no `details`): The title has no language.
- `too-many-questions` (`details: { max: number; count: number; }`): The `questions` slot holds more questions than `maxQuestions` allows.
  - `max`: The configured maximum.
  - `count`: How many questions the slot holds.

## Referenced types

```text
// packages/docs-generator/fixtures/survey-system.ts
export type I18nText = Record<string, string>

// packages/docs-generator/fixtures/survey-system.ts
export interface SubmitSummary {
	answered: number
	total: number
}

// packages/docs-generator/fixtures/survey-system.ts
export interface SurveyRawConfig {
	title: I18nText
	maxQuestions?: number
	submitUrl?: string
}
```

- `I18nText`: Text per language, keyed by language tag (`en`, `zh-TW`). At least one language should be present; the renderer falls back to the first one.
- `SubmitSummary`: What `Survey.submit()` reports when the survey is sent.
  - `answered`: How many questions were answered.
  - `total`: How many questions the survey has.
- `SurveyRawConfig`: The raw config of a survey.
  - `title`: The survey's title.
  - `maxQuestions` (optional): The most questions the survey may hold: from 1 to 20; 10 when left out.
  - `submitUrl` (optional): Where the answers are sent: a URI.
