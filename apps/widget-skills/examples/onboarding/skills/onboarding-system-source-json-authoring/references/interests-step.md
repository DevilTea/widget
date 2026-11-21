# InterestsStep

Step 2 of the onboarding wizard: the interests the new member picks from the configured options (State `selected`: the picked ids). Properties: `title`, `options`, `missing` (`interests:<n>` while `n` more must be picked to reach `minimum`), `complete` and `answers` (the picked ids).

## Config

The step title, the options (an id and a label per language), how many must be picked and which are picked at the start.

`config` is required.

Raw config type: `InterestsRawConfig`

```text
// apps/lab/src/showcases/onboarding/config.ts
export interface InterestsRawConfig {
	readonly title: I18nText
	readonly options: readonly InterestOptionRaw[]
	/** How many interests the visitor must pick (default 1). */
	readonly minimum?: number
	/** The ids picked at the start. */
	readonly preselected?: readonly string[]
}

// apps/lab/src/showcases/onboarding/domain.ts
/** Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it. */
export interface I18nText { readonly [language: string]: string }

// apps/lab/src/showcases/onboarding/config.ts
export interface InterestOptionRaw {
	readonly id: string
	readonly label: I18nText
}
```

## Slots

No slots: this widget cannot have children.
