# AccountStep renderer

Step 1 of the onboarding wizard: the visitor's name and e-mail address (State `name` and `email`, filled in as they type). Properties: `title`, `missing` (`name` and/or `email` while they are empty or not an address), `complete` and `answers`.

## Config (resolved)

`config` is the resolved config: `AccountConfig`.

## State

| Name | Type | authorWritable | Description |
| --- | --- | --- | --- |
| `name` | `string` | false | _Not documented._ |
| `email` | `string` | false | _Not documented._ |

## Properties (read-only, computed)

| Name | Type | Description |
| --- | --- | --- |
| `title` | `I18nText` | _Not documented._ |
| `missing` | `readonly string[]` | _Not documented._ |
| `complete` | `boolean` | _Not documented._ |
| `answers` | `AccountAnswers` | _Not documented._ |

## Methods

No Methods.
## Events

No Events.

## Slots

No slots: `WidgetSlot` is not on the surface.

## Referenced types

```ts
// apps/lab/src/showcases/onboarding/domain.ts
/** What the account step contributes. */
export interface AccountAnswers {
	readonly name: string
	readonly email: string
}

// apps/lab/src/showcases/onboarding/config.ts
export interface AccountConfig {
	readonly title: I18nText
	readonly name: string
	readonly email: string
	readonly recovered: boolean
}

// apps/lab/src/showcases/onboarding/config.ts
export interface AccountRawConfig {
	readonly title: I18nText
	readonly prefill?: { readonly name?: string, readonly email?: string }
}

// apps/lab/src/showcases/onboarding/domain.ts
/** Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it. */
export interface I18nText { readonly [language: string]: string }
```
