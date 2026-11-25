# Note

A short text.

## Config

The text of the note.

Leave the config out for an empty note.

`config` may be left out.

Raw config type: `{ text: I18nText; } | null`

```text
// packages/docs-generator/fixtures/survey-system.ts
export type I18nText = Record<string, string>
```

Fields:

- `text`: The text shown.

Types:

- `I18nText`: Text per language, keyed by language tag (`en`, `zh-TW`). At least one language should be present; the renderer falls back to the first one.

## Slots

No slots: this widget cannot have children.
