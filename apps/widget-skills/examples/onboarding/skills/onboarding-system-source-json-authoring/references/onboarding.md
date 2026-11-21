# Onboarding

The root of the onboarding wizard. State: `current` (the index of the current step) and `finished`. Properties: `title`, `steps` (each step's title, `complete` and `missing`), `progress` and `answers`. Methods: `canEnter(index)` (read-only), `next()`, `back()`, `goTo(index)` (each writes `current` and emits `stepChanged`) and `finish()` (emits `completed`). A refused move is a Method diagnostic and changes nothing.

## Config

The wizard title per language and, optionally, the index of the step it opens on.

`config` is required.

Raw config type: `OnboardingRawConfig`

```ts
// apps/lab/src/showcases/onboarding/config.ts
export interface OnboardingRawConfig {
	readonly title: I18nText
	/** The index of the step the wizard opens on (0 = the first). */
	readonly startStep?: number
}

// apps/lab/src/showcases/onboarding/domain.ts
/** Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it. */
export interface I18nText { readonly [language: string]: string }
```

## Slots

- `steps`: The steps in order: AccountStep, InterestsStep, SafetyStep or InductionStep. At least one.
