# SafetyStep renderer

Step 3 of the onboarding wizard: the safety briefing. The visitor acknowledges each configured rule (State `acknowledged`: the ids acknowledged so far). Properties: `title`, `rules`, `missing` (one `rule:<id>` per rule not yet acknowledged), `complete` and `answers` (the acknowledged ids).

## Config (resolved)

`config` is the resolved config: `SafetyConfig`.

## State

| Name | Type | authorWritable | Description |
| --- | --- | --- | --- |
| `acknowledged` | `readonly string[]` | false | _Not documented._ |

## Properties (read-only, computed)

| Name | Type | Description |
| --- | --- | --- |
| `title` | `I18nText` | _Not documented._ |
| `rules` | `readonly SafetyRuleRaw[]` | _Not documented._ |
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
export interface SafetyConfig {
	readonly title: I18nText
	readonly rules: readonly SafetyRuleRaw[]
	readonly acknowledged: readonly string[]
	readonly recovered: boolean
}

// apps/lab/src/showcases/onboarding/config.ts
export interface SafetyRawConfig {
	readonly title: I18nText
	readonly rules: readonly SafetyRuleRaw[]
	/** The ids of the rules acknowledged at the start. */
	readonly acknowledged?: readonly string[]
}

// apps/lab/src/showcases/onboarding/config.ts
export interface SafetyRuleRaw {
	readonly id: string
	readonly text: I18nText
}
```
