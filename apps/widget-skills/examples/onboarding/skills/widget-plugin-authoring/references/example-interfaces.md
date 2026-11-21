# Interfaces of onboardingSystem

Read from the types; the member documentation is whatever JSDoc the Interfaces carry today.

## Onboarding (`OnboardingInterfaces`)

```text
config: { raw: OnboardingRawConfig, resolved: OnboardingConfig }
slots: 'steps'
state.current: number
state.finished: boolean
properties.title: I18nText
properties.steps: readonly StepSummary[]
properties.progress: Progress
properties.answers: { readonly [stepId: string]: unknown; }
methods.canEnter(index: number): boolean
methods.next(): number
methods.back(): number
methods.goTo(index: number): number
methods.finish(): boolean
events.stepChanged: [change: StepChange]
events.completed: [completion: Completion]
```

## AccountStep (`AccountInterfaces`)

```text
config: { raw: AccountRawConfig, resolved: AccountConfig }
state.name: string
state.email: string
properties.title: I18nText
properties.missing: readonly string[]
properties.complete: boolean
properties.answers: AccountAnswers
```

## InterestsStep (`InterestsInterfaces`)

```text
config: { raw: InterestsRawConfig, resolved: InterestsConfig }
state.selected: readonly string[]
properties.title: I18nText
properties.options: readonly InterestOptionRaw[]
properties.missing: readonly string[]
properties.complete: boolean
properties.answers: readonly string[]
```

## SafetyStep (`SafetyInterfaces`)

```text
config: { raw: SafetyRawConfig, resolved: SafetyConfig }
state.acknowledged: readonly string[]
properties.title: I18nText
properties.rules: readonly SafetyRuleRaw[]
properties.missing: readonly string[]
properties.complete: boolean
properties.answers: readonly string[]
```

## InductionStep (`InductionInterfaces`)

```text
config: { raw: InductionRawConfig, resolved: InductionConfig }
state.status: "idle" | "requesting" | "confirmed" | "declined"
state.ticket: number
state.slot: Slot | null
state.reference: string | null
state.reason: string | null
properties.title: I18nText
properties.offered: { readonly days: readonly string[]; readonly times: readonly string[]; }
properties.missing: readonly string[]
properties.complete: boolean
properties.answers: InductionAnswers
methods.requestSlot(date: string, time: string): number
methods.settleBooking(ticket: number, outcome: BookingOutcome): boolean
methods.cancelBooking(): number
events.slotRequested: [request: SlotRequest]
events.slotConfirmed: [confirmation: SlotConfirmation]
events.slotDeclined: [declined: SlotDeclined]
events.slotCancelled: [cancelled: SlotCancelled]
```
