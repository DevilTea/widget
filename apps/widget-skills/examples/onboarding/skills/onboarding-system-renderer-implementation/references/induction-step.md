# InductionStep renderer

Step 4 of the onboarding wizard: booking an induction slot, with the work kept at the host. Methods: `requestSlot(date, time)` (validated against the config; writes the request into State and emits `slotRequested` with a ticket), `settleBooking(ticket, outcome)` (the host's answer; applied only if the ticket is still the newest, otherwise ignored) and `cancelBooking()` (emits `slotCancelled`); `requestSlot` and `cancelBooking` are refused once the wizard is finished. Events: `slotRequested`, `slotConfirmed`, `slotDeclined`, `slotCancelled`. State: `status`, `ticket`, `slot`, `reference`, `reason`.

## Config (resolved)

`config` is the resolved config: `InductionConfig`.

## State

| Name | Type | authorWritable | Description |
| --- | --- | --- | --- |
| `status` | `"idle" \| "requesting" \| "confirmed" \| "declined"` | false | _Not documented._ |
| `ticket` | `number` | false | The ticket of the newest request; 0 before any. |
| `slot` | `Slot \| null` | false | _Not documented._ |
| `reference` | `string \| null` | false | _Not documented._ |
| `reason` | `string \| null` | false | _Not documented._ |

## Properties (read-only, computed)

| Name | Type | Description |
| --- | --- | --- |
| `title` | `I18nText` | _Not documented._ |
| `offered` | `{ readonly days: readonly string[]; readonly times: readonly string[]; }` | _Not documented._ |
| `missing` | `readonly string[]` | _Not documented._ |
| `complete` | `boolean` | _Not documented._ |
| `answers` | `InductionAnswers` | _Not documented._ |

## Methods

### `requestSlot(date: string, time: string): number`

_Not documented._
- `date: string`
- `time: string`
- Returns `number`. Through `useMethods()` the call returns `number | null`: `null` when it failed (read `useMethodDiagnostics().requestSlot`).

### `settleBooking(ticket: number, outcome: BookingOutcome): boolean`

_Not documented._
- `ticket: number`
- `outcome: BookingOutcome`
- Returns `boolean`. Through `useMethods()` the call returns `boolean | null`: `null` when it failed (read `useMethodDiagnostics().settleBooking`).

### `cancelBooking(): number`

_Not documented._
- Returns `number`. Through `useMethods()` the call returns `number | null`: `null` when it failed (read `useMethodDiagnostics().cancelBooking`).

## Events

- `slotRequested(request: SlotRequest)`: The visitor asked for an induction slot. Carries the request, with the ticket the host must hand back with its answer.
- `slotConfirmed(confirmation: SlotConfirmation)`: The booking office confirmed the slot of the newest request. Carries the request and the booking reference.
- `slotDeclined(declined: SlotDeclined)`: The booking office declined the slot of the newest request. Carries the request and the reason.
- `slotCancelled(cancelled: SlotCancelled)`: The visitor cancelled a request that was waiting, or a booking that was confirmed. Carries the request and whether it had been confirmed.

## Slots

No slots: `WidgetSlot` is not on the surface.

## Referenced types

```text
// apps/lab/src/showcases/onboarding/domain.ts
/** What the booking office answers for a request. */
export type BookingOutcome
	= | { readonly status: 'confirmed', readonly reference: string }
		| { readonly status: 'declined', readonly reason: string }

// apps/lab/src/showcases/onboarding/domain.ts
/** Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it. */
export interface I18nText { readonly [language: string]: string }

// apps/lab/src/showcases/onboarding/domain.ts
/** What the induction step contributes to the `completed` Event. */
export interface InductionAnswers {
	readonly slot: Slot | null
	readonly reference: string | null
}

// apps/lab/src/showcases/onboarding/config.ts
export interface InductionConfig {
	readonly title: I18nText
	readonly days: readonly string[]
	readonly times: readonly string[]
	readonly recovered: boolean
}

// apps/lab/src/showcases/onboarding/config.ts
export interface InductionRawConfig {
	readonly title: I18nText
	/** The days an induction can be booked, `YYYY-MM-DD`. */
	readonly days: readonly string[]
	/** The start times offered on each day, `HH:MM`. */
	readonly times: readonly string[]
}

// apps/lab/src/showcases/onboarding/domain.ts
export interface Slot {
	readonly date: string
	readonly time: string
}

// apps/lab/src/showcases/onboarding/domain.ts
/** The payload of `slotCancelled`: the request or booking the visitor gave up. */
export interface SlotCancelled extends SlotRequest {
	/** `true` when the booking had been confirmed already, `false` when the request was still waiting for an answer. */
	readonly wasConfirmed: boolean
}

// apps/lab/src/showcases/onboarding/domain.ts
/** The payload of `slotConfirmed`. */
export interface SlotConfirmation extends SlotRequest {
	readonly reference: string
}

// apps/lab/src/showcases/onboarding/domain.ts
/** The payload of `slotDeclined`. */
export interface SlotDeclined extends SlotRequest {
	readonly reason: string
}

// apps/lab/src/showcases/onboarding/domain.ts
/** The payload of the induction's `slotRequested` Event: what the host is asked to book. */
export interface SlotRequest extends Slot {
	/** The ticket of this request: an answer is applied only while it is still the newest. */
	readonly ticket: number
}
```
