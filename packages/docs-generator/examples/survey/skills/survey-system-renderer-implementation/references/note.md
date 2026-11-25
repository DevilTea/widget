# Note renderer

A short text.

## Config (resolved)

`config` is the resolved config: `{ text: I18nText; }`.

- `text`: The text shown; empty when the config was left out.

## State

No State.

## Properties (read-only, computed)

No Properties.

## Methods

No Methods.
## Events

No Events.

## Slots

No slots: `WidgetSlot` is not on the surface.

## Diagnostic reasons

None declared: a diagnostic of this type may carry any `reason` string and any JSON `details`.

## Referenced types

```text
// packages/docs-generator/fixtures/survey-system.ts
export type I18nText = Record<string, string>
```

- `I18nText`: Text per language, keyed by language tag (`en`, `zh-TW`). At least one language should be present; the renderer falls back to the first one.
