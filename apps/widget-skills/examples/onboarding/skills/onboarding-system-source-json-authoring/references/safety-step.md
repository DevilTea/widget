# SafetyStep

Step 3 of the onboarding wizard: the safety briefing. The visitor acknowledges each configured rule (State `acknowledged`: the ids acknowledged so far). Properties: `title`, `rules`, `missing` (one `rule:<id>` per rule not yet acknowledged), `complete` and `answers` (the acknowledged ids).

## Config

The step title, the safety rules (an id and a text per language) and which are acknowledged at the start.

`config` is required.

Raw config type: `SafetyRawConfig`

```text
// apps/lab/src/showcases/onboarding/config.ts
export interface SafetyRawConfig {
	readonly title: I18nText
	readonly rules: readonly SafetyRuleRaw[]
	/** The ids of the rules acknowledged at the start. */
	readonly acknowledged?: readonly string[]
}

// apps/lab/src/showcases/onboarding/domain.ts
/** Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it. */
export interface I18nText { readonly [language: string]: string }

// apps/lab/src/showcases/onboarding/config.ts
export interface SafetyRuleRaw {
	readonly id: string
	readonly text: I18nText
}
```

## Slots

No slots: this widget cannot have children.
