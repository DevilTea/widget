# Note

A short text.

## Config

The text of the note.

Leave the config out for an empty note.

`config` may be left out.

Raw config type: `{ text: I18nText; } | null`

```text
// apps/widget-skills/fixtures/survey-system.ts
/**
 * Text per language, keyed by language tag (`en`, `zh-TW`).
 * @remarks At least one language should be present; the renderer falls back to the first one.
 */
export type I18nText = Record<string, string>
```

## Slots

No slots: this widget cannot have children.
