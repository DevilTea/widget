/**
 * The documentation of the onboarding plugins' config and value types, written once and referenced from the builders
 * (`defineTypeDocs` + `ref` for a type several members use, `defineFieldDocs` for a config). Core keeps it on
 * `plugin.docs`; the widget-skills generator reads it from there.
 */

import type { TypeDocs } from '@deviltea/widget-core'
import type { AccountConfig, AccountRawConfig, InductionConfig, InductionRawConfig, InterestOptionRaw, InterestsConfig, InterestsRawConfig, OnboardingConfig, OnboardingRawConfig, SafetyConfig, SafetyRawConfig, SafetyRuleRaw } from './config'
import type { AccountAnswers, BookingOutcome, Completion, I18nText, InductionAnswers, Progress, Slot, SlotCancelled, SlotConfirmation, SlotDeclined, SlotRequest, StepChange, StepSummary } from './domain'
import { defineFieldDocs, defineTypeDocs } from '@deviltea/widget-core'

// -------------------------------------------------------------------------------------------------
// Shared types
// -------------------------------------------------------------------------------------------------

export const i18nTextDocs: TypeDocs<I18nText> = defineTypeDocs<I18nText>('I18nText', {
	description: 'Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it.',
	values: { description: 'The text in one language. `en` is the English text, which a missing language falls back to.' },
})

const ID_RULE = 'a lowercase letter, then lowercase letters, digits and "-", matching `^[a-z][a-z0-9-]*$`'

export const interestOptionDocs: TypeDocs<InterestOptionRaw> = defineTypeDocs<InterestOptionRaw>('InterestOptionRaw', {
	description: 'One interest the visitor can pick.',
	fields: {
		id: { description: `An id: ${ID_RULE}. Unique within its list.` },
		label: { description: 'What the visitor reads for this interest.', ref: i18nTextDocs },
	},
})

export const safetyRuleDocs: TypeDocs<SafetyRuleRaw> = defineTypeDocs<SafetyRuleRaw>('SafetyRuleRaw', {
	description: 'One safety rule the visitor acknowledges.',
	fields: {
		id: { description: `An id: ${ID_RULE}. Unique within its list.` },
		text: { description: 'The safety rule the visitor acknowledges.', ref: i18nTextDocs },
	},
})

export const stepSummaryDocs: TypeDocs<StepSummary> = defineTypeDocs<StepSummary>('StepSummary', {
	description: 'What the root knows of one step: read from the step\'s own Properties.',
	fields: {
		id: { description: 'The step widget\'s id.' },
		type: { description: 'The step\'s plugin type.' },
		title: { description: 'The step title per language.', ref: i18nTextDocs },
		complete: { description: 'Whether the step is complete.' },
		missing: { description: 'What is still missing, as machine-readable codes (`name`, `email`, `interests`, `rule:<id>`, `booking`, ...).' },
	},
})

export const progressDocs: TypeDocs<Progress> = defineTypeDocs<Progress>('Progress', {
	description: 'Where the wizard is, and how far the visitor may go.',
	fields: {
		count: { description: 'How many steps the wizard has.' },
		current: { description: 'The index of the current step.' },
		currentId: { description: 'The current step\'s widget id, or `null` when there is no step.' },
		stepIds: { description: 'The steps\' widget ids, in order.' },
		firstIncomplete: { description: 'The first step that is not complete, or -1 when every step is.' },
		furthest: { description: 'The furthest step the visitor may enter: the first incomplete one (or the last when all are complete).' },
		allComplete: { description: 'Whether every step is complete.' },
	},
})

export const stepChangeDocs: TypeDocs<StepChange> = defineTypeDocs<StepChange>('StepChange', {
	description: 'The payload of the root\'s `stepChanged` Event.',
	fields: {
		from: { description: 'The id of the step the visitor left.' },
		to: { description: 'The id of the step the visitor entered.' },
		fromIndex: { description: 'The index of the step the visitor left.' },
		toIndex: { description: 'The index of the step the visitor entered.' },
		by: { description: 'How the visitor changed step: `next`, `back` or `jump`.' },
	},
})

export const completionDocs: TypeDocs<Completion> = defineTypeDocs<Completion>('Completion', {
	description: 'The payload of the root\'s `completed` Event: every step\'s own `answers`, by step id.',
	fields: {
		answers: { description: 'Every step\'s `answers` Property, by step id.' },
	},
})

export const slotDocs: TypeDocs<Slot> = defineTypeDocs<Slot>('Slot', {
	description: 'An induction slot: a day and a start time.',
	fields: {
		date: { description: 'The day, `YYYY-MM-DD`.' },
		time: { description: 'The start time, `HH:MM`.' },
	},
})

export const bookingOutcomeDocs: TypeDocs<BookingOutcome> = defineTypeDocs<BookingOutcome>('BookingOutcome', {
	description: 'What the booking office answers for a request: confirmed with a reference, or declined with a reason.',
	fields: {
		status: { description: '`confirmed` or `declined`.' },
		reference: { description: 'Confirmed: the booking reference, not empty.' },
		reason: { description: 'Declined: why, not empty.' },
	},
})

const TICKET = 'The ticket of this request: an answer is applied only while it is still the newest.'

export const slotRequestDocs: TypeDocs<SlotRequest> = defineTypeDocs<SlotRequest>('SlotRequest', {
	description: 'The payload of the induction\'s `slotRequested` Event: what the host is asked to book.',
	fields: {
		date: { description: 'The requested day, `YYYY-MM-DD`.' },
		time: { description: 'The requested start time, `HH:MM`.' },
		ticket: { description: TICKET },
	},
})

export const slotConfirmationDocs: TypeDocs<SlotConfirmation> = defineTypeDocs<SlotConfirmation>('SlotConfirmation', {
	description: 'The payload of `slotConfirmed`.',
	fields: {
		date: { description: 'The booked day, `YYYY-MM-DD`.' },
		time: { description: 'The booked start time, `HH:MM`.' },
		ticket: { description: TICKET },
		reference: { description: 'The booking reference the office gave.' },
	},
})

export const slotDeclinedDocs: TypeDocs<SlotDeclined> = defineTypeDocs<SlotDeclined>('SlotDeclined', {
	description: 'The payload of `slotDeclined`.',
	fields: {
		date: { description: 'The requested day, `YYYY-MM-DD`.' },
		time: { description: 'The requested start time, `HH:MM`.' },
		ticket: { description: TICKET },
		reason: { description: 'Why the office declined.' },
	},
})

export const slotCancelledDocs: TypeDocs<SlotCancelled> = defineTypeDocs<SlotCancelled>('SlotCancelled', {
	description: 'The payload of `slotCancelled`: the request or booking the visitor gave up.',
	fields: {
		date: { description: 'The day of the request or booking, `YYYY-MM-DD`.' },
		time: { description: 'The start time of the request or booking, `HH:MM`.' },
		ticket: { description: TICKET },
		wasConfirmed: { description: '`true` when the booking had been confirmed already, `false` when the request was still waiting for an answer.' },
	},
})

export const inductionAnswersDocs: TypeDocs<InductionAnswers> = defineTypeDocs<InductionAnswers>('InductionAnswers', {
	description: 'What the induction step contributes to the `completed` Event.',
	fields: {
		slot: { description: 'The booked slot, or `null` when none is confirmed.', ref: slotDocs },
		reference: { description: 'The booking reference, or `null` when none is confirmed.' },
	},
})

export const accountAnswersDocs: TypeDocs<AccountAnswers> = defineTypeDocs<AccountAnswers>('AccountAnswers', {
	description: 'What the account step contributes.',
	fields: {
		name: { description: 'The trimmed name.' },
		email: { description: 'The trimmed e-mail address.' },
	},
})

// -------------------------------------------------------------------------------------------------
// Configs
// -------------------------------------------------------------------------------------------------

const RECOVERED = { description: 'Whether this is the fallback of a config that failed validation.' }

export const onboardingRawConfigDocs = defineFieldDocs<OnboardingRawConfig>()({
	description: 'The authored config of an Onboarding.',
	fields: {
		title: { description: 'The title of the wizard.', ref: i18nTextDocs },
		startStep: { description: 'The index of the step the wizard opens on, counted from 0: a whole number, at least 0. Defaults to 0. Opening on a later step does not make the earlier ones complete: the wizard still lets the visitor go back, and Next and Finish still check the steps.' },
	},
})

export const onboardingConfigDocs = defineFieldDocs<OnboardingConfig>()({
	description: 'The resolved config of an Onboarding.',
	fields: {
		title: { description: 'The title of the wizard.', ref: i18nTextDocs },
		startStep: { description: 'The index of the step the wizard opens on.' },
		recovered: RECOVERED,
	},
})

export const accountRawConfigDocs = defineFieldDocs<AccountRawConfig>()({
	description: 'The authored config of an AccountStep.',
	fields: {
		title: { description: 'The title of the step.', ref: i18nTextDocs },
		prefill: {
			description: 'Values filled in at the start. A viewer can change them.',
			fields: {
				name: { description: 'The name filled in at the start.' },
				email: { description: 'The e-mail address filled in at the start (empty or an address).' },
			},
		},
	},
})

export const accountConfigDocs = defineFieldDocs<AccountConfig>()({
	description: 'The resolved config of an AccountStep.',
	fields: {
		title: { description: 'The title of the step.', ref: i18nTextDocs },
		name: { description: 'The name filled in at the start; empty when none was.' },
		email: { description: 'The e-mail address filled in at the start; empty when none was.' },
		recovered: RECOVERED,
	},
})

export const interestsRawConfigDocs = defineFieldDocs<InterestsRawConfig>()({
	description: 'The authored config of an InterestsStep.',
	fields: {
		title: { description: 'The title of the step.', ref: i18nTextDocs },
		options: { description: 'The interests the visitor can pick from: at least one.', items: { ref: interestOptionDocs } },
		minimum: { description: 'How many interests the visitor must pick before the step is complete: a whole number, at least 0. Defaults to 1; it cannot be more than the number of options.' },
		preselected: { description: `The ids picked at the start, each once; each must be the id of an option: ${ID_RULE}.` },
	},
})

export const interestsConfigDocs = defineFieldDocs<InterestsConfig>()({
	description: 'The resolved config of an InterestsStep.',
	fields: {
		title: { description: 'The title of the step.', ref: i18nTextDocs },
		options: { description: 'The interests the visitor can pick from.', items: { ref: interestOptionDocs } },
		minimum: { description: 'How many interests the visitor must pick before the step is complete.' },
		preselected: { description: 'The ids picked at the start.' },
		recovered: RECOVERED,
	},
})

export const safetyRawConfigDocs = defineFieldDocs<SafetyRawConfig>()({
	description: 'The authored config of a SafetyStep.',
	fields: {
		title: { description: 'The title of the step.', ref: i18nTextDocs },
		rules: { description: 'The safety rules the visitor must acknowledge, one by one, before the step is complete: at least one.', items: { ref: safetyRuleDocs } },
		acknowledged: { description: `The ids of the rules acknowledged at the start, each once; each must be the id of a rule: ${ID_RULE}.` },
	},
})

export const safetyConfigDocs = defineFieldDocs<SafetyConfig>()({
	description: 'The resolved config of a SafetyStep.',
	fields: {
		title: { description: 'The title of the step.', ref: i18nTextDocs },
		rules: { description: 'The safety rules the visitor must acknowledge.', items: { ref: safetyRuleDocs } },
		acknowledged: { description: 'The ids of the rules acknowledged at the start.' },
		recovered: RECOVERED,
	},
})

export const inductionRawConfigDocs = defineFieldDocs<InductionRawConfig>()({
	description: 'The authored config of an InductionStep.',
	fields: {
		title: { description: 'The title of the step.', ref: i18nTextDocs },
		days: { description: 'The days an induction can be booked, written `YYYY-MM-DD` (`^\\d{4}-\\d{2}-\\d{2}$`): at least one, each once. Requesting any other date is an invalid Method call. Whether the booking office still has room is not known here (the host asks it).' },
		times: { description: 'The start times offered on each day, written `HH:MM` (`^(?:[01]\\d|2[0-3]):[0-5]\\d$`): at least one, each once.' },
	},
})

export const inductionConfigDocs = defineFieldDocs<InductionConfig>()({
	description: 'The resolved config of an InductionStep.',
	fields: {
		title: { description: 'The title of the step.', ref: i18nTextDocs },
		days: { description: 'The days an induction can be booked, `YYYY-MM-DD`.' },
		times: { description: 'The start times offered on each day, `HH:MM`.' },
		recovered: RECOVERED,
	},
})
