# InductionStep

Step 4 of the onboarding wizard: booking an induction slot, with the work kept at the host. Methods: `requestSlot(date, time)` (validated against the config; writes the request into State and emits `slotRequested` with a ticket), `settleBooking(ticket, outcome)` (the host's answer; applied only if the ticket is still the newest, otherwise ignored) and `cancelBooking()` (emits `slotCancelled`); `requestSlot` and `cancelBooking` are refused once the wizard is finished. Events: `slotRequested`, `slotConfirmed`, `slotDeclined`, `slotCancelled`. State: `status`, `ticket`, `slot`, `reference`, `reason`.

## Config

The step title and the days and start times offered. Whether the booking office still has room is not known here: the host asks it.

`config` is required.

Raw config type: `InductionRawConfig`

```text
// apps/lab/src/showcases/onboarding/config.ts
export interface InductionRawConfig {
	readonly title: I18nText
	/** The days an induction can be booked, `YYYY-MM-DD`. */
	readonly days: readonly string[]
	/** The start times offered on each day, `HH:MM`. */
	readonly times: readonly string[]
}

// apps/lab/src/showcases/onboarding/domain.ts
/** Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it. */
export interface I18nText { readonly [language: string]: string }
```

## Slots

No slots: this widget cannot have children.
