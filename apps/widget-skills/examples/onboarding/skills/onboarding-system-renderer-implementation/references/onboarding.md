# Onboarding renderer

The root of the onboarding wizard. State: `current` (the index of the current step) and `finished`. Properties: `title`, `steps` (each step's title, `complete` and `missing`), `progress` and `answers`. Methods: `canEnter(index)` (read-only), `next()`, `back()`, `goTo(index)` (each writes `current` and emits `stepChanged`) and `finish()` (emits `completed`). A refused move is a Method diagnostic and changes nothing.

## Config (resolved)

`config` is the resolved config: `OnboardingConfig`.

## State

| Name | Type | authorWritable | Description |
| --- | --- | --- | --- |
| `current` | `number` | false | _Not documented._ |
| `finished` | `boolean` | false | _Not documented._ |

## Properties (read-only, computed)

| Name | Type | Description |
| --- | --- | --- |
| `title` | `I18nText` | _Not documented._ |
| `steps` | `readonly StepSummary[]` | _Not documented._ |
| `progress` | `Progress` | _Not documented._ |
| `answers` | `{ readonly [stepId: string]: unknown; }` | _Not documented._ |

## Methods

### `canEnter(index: number): boolean`

_Not documented._
- `index: number`
- Returns `boolean`

### `next(): number`

_Not documented._
- Returns `number`

### `back(): number`

_Not documented._
- Returns `number`

### `goTo(index: number): number`

_Not documented._
- `index: number`
- Returns `number`

### `finish(): boolean`

_Not documented._
- Returns `boolean`

## Events

- `stepChanged(change: StepChange)`: The visitor moved to another step. Carries the step ids and indexes it left and entered, and how (next, back or jump).
- `completed(completion: Completion)`: The visitor finished the wizard. Carries every step's answers by step id.

## Slots

- `steps`: The steps in order: AccountStep, InterestsStep, SafetyStep or InductionStep. At least one.

Render each with `<WidgetSlot name="...">` from this widget's `useWidget()` result.

## Referenced types

```ts
// apps/lab/src/showcases/onboarding/domain.ts
/** The payload of the root's `completed` Event: every step's own `answers`, by step id. */
export interface Completion {
	readonly answers: { readonly [stepId: string]: unknown }
}

// apps/lab/src/showcases/onboarding/domain.ts
/** Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it. */
export interface I18nText { readonly [language: string]: string }

// apps/lab/src/showcases/onboarding/config.ts
export interface OnboardingConfig {
	readonly title: I18nText
	readonly startStep: number
	readonly recovered: boolean
}

// apps/lab/src/showcases/onboarding/config.ts
export interface OnboardingRawConfig {
	readonly title: I18nText
	/** The index of the step the wizard opens on (0 = the first). */
	readonly startStep?: number
}

// apps/lab/src/showcases/onboarding/domain.ts
/** Where the wizard is, and how far the visitor may go. */
export interface Progress {
	readonly count: number
	/** The index of the current step. */
	readonly current: number
	readonly currentId: string | null
	readonly stepIds: readonly string[]
	/** The first step that is not complete, or -1 when every step is. */
	readonly firstIncomplete: number
	/** The furthest step the visitor may enter: the first incomplete one (or the last when all are complete). */
	readonly furthest: number
	readonly allComplete: boolean
}

// apps/lab/src/showcases/onboarding/domain.ts
/** The payload of the root's `stepChanged` Event. */
export interface StepChange {
	readonly from: string
	readonly to: string
	readonly fromIndex: number
	readonly toIndex: number
	readonly by: StepChangeBy
}

// apps/lab/src/showcases/onboarding/domain.ts
/** How the visitor changed step. */
export type StepChangeBy = 'next' | 'back' | 'jump'

// apps/lab/src/showcases/onboarding/domain.ts
/** What the root knows of one step: read from the step's own Properties. */
export interface StepSummary {
	readonly id: string
	readonly type: string
	readonly title: I18nText
	readonly complete: boolean
	/** What is still missing, as machine-readable codes (`name`, `email`, `interests`, `rule:<id>`, `booking`, ...). */
	readonly missing: readonly string[]
}
```
