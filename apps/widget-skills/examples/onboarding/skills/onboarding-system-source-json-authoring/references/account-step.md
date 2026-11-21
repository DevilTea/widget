# AccountStep

Step 1 of the onboarding wizard: the visitor's name and e-mail address (State `name` and `email`, filled in as they type). Properties: `title`, `missing` (`name` and/or `email` while they are empty or not an address), `complete` and `answers`.

## Config

The step title per language and, optionally, the name and e-mail address filled in at the start.

`config` is required.

Raw config type: `AccountRawConfig`

```text
// apps/lab/src/showcases/onboarding/config.ts
export interface AccountRawConfig {
	readonly title: I18nText
	readonly prefill?: { readonly name?: string, readonly email?: string }
}

// apps/lab/src/showcases/onboarding/domain.ts
/** Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it. */
export interface I18nText { readonly [language: string]: string }
```

## Slots

No slots: this widget cannot have children.
