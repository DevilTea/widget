# InterestsStep renderer

Step 2 of the onboarding wizard: the interests the new member picks from the configured options (State `selected`: the picked ids). Properties: `title`, `options`, `missing` (`interests:<n>` while `n` more must be picked to reach `minimum`), `complete` and `answers` (the picked ids).

## Config (resolved)

`config` is the resolved config: `InterestsConfig`.

## State

| Name | Type | authorWritable | Description |
| --- | --- | --- | --- |
| `selected` | `readonly string[]` | false | _Not documented._ |

## Properties (read-only, computed)

| Name | Type | Description |
| --- | --- | --- |
| `title` | `I18nText` | _Not documented._ |
| `options` | `readonly InterestOptionRaw[]` | _Not documented._ |
| `missing` | `readonly string[]` | _Not documented._ |
| `complete` | `boolean` | _Not documented._ |
| `answers` | `readonly string[]` | _Not documented._ |

## Methods

No Methods.
## Events

No Events.

## Slots

No slots: `WidgetSlot` is not on the surface.

## Referenced types

```text
// apps/lab/src/showcases/onboarding/domain.ts
/** Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it. */
export interface I18nText { readonly [language: string]: string }

// apps/lab/src/showcases/onboarding/config.ts
export interface InterestOptionRaw {
	readonly id: string
	readonly label: I18nText
}

// apps/lab/src/showcases/onboarding/config.ts
export interface InterestsConfig {
	readonly title: I18nText
	readonly options: readonly InterestOptionRaw[]
	readonly minimum: number
	readonly preselected: readonly string[]
	readonly recovered: boolean
}

// apps/lab/src/showcases/onboarding/config.ts
export interface InterestsRawConfig {
	readonly title: I18nText
	readonly options: readonly InterestOptionRaw[]
	/** How many interests the visitor must pick (default 1). */
	readonly minimum?: number
	/** The ids picked at the start. */
	readonly preselected?: readonly string[]
}
```
