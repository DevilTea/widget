/**
 * The guided tours the Lab ships, one per showcase that has one. A tour id is the id of the showcase it
 * teaches (`showcases/registry.ts`), and each tour is authored against that showcase's default preset, the
 * deterministic starting state (`deterministic-start.ts`): starting or restarting a tour always reloads it.
 *
 * Framework-agnostic and free of Vue and of the showcase registry, so the Preview frame
 * (`preview-frame-main.ts`), the parent (`composables/use-tutorial.ts`) and the host protocol
 * (`preview-host/protocol.ts`) share one list without importing each other.
 */

import type { TutorialScript } from './types'
import { ONBOARDING_TOUR_ID, onboardingTourScript } from './onboarding-script'
import { QUOTE_RULES_TOUR_ID, quoteRulesTourScript } from './quote-rules-script'
import { SURVEY_TOUR_ID, surveyTourScript } from './survey-script'
import { TRIP_BUDGET_TOUR_ID, tripBudgetTourScript } from './trip-budget-script'

export interface TourEntry {
	/** Also the id of the showcase the tour teaches. */
	readonly id: string
	readonly script: TutorialScript
	/** The preset a start or restart reloads: the showcase's default. */
	readonly defaultPresetId: string
	/**
	 * Shown when starting would replace an unapplied draft. English message id: the dialog translates it, and a
	 * tour with its own wording needs its own entry in `i18n/`.
	 */
	readonly startConfirmMessage: string
}

/** The tour the Welcome card and the header start when the open showcase has none (the default showcase's). */
export const DEFAULT_TOUR_ID = SURVEY_TOUR_ID

export const tours: readonly TourEntry[] = [
	{
		id: SURVEY_TOUR_ID,
		script: surveyTourScript,
		defaultPresetId: 'survey-default',
		startConfirmMessage: 'Starting the tutorial will load the Survey teaching example and replace your unapplied changes.',
	},
	{
		id: TRIP_BUDGET_TOUR_ID,
		script: tripBudgetTourScript,
		defaultPresetId: 'trip-default',
		startConfirmMessage: 'Starting the tutorial will load the Trip budget teaching example and replace your unapplied changes.',
	},
	{
		id: QUOTE_RULES_TOUR_ID,
		script: quoteRulesTourScript,
		defaultPresetId: 'quote-default',
		startConfirmMessage: 'Starting the tutorial will load the Quote rules teaching example and replace your unapplied changes.',
	},
	{
		id: ONBOARDING_TOUR_ID,
		script: onboardingTourScript,
		defaultPresetId: 'onboarding-default',
		startConfirmMessage: 'Starting the tutorial will load the Onboarding teaching example and replace your unapplied changes.',
	},
]

/** The ids of every tour, for the host protocol's validation. */
export const TOUR_IDS: readonly string[] = tours.map(tour => tour.id)

export function getTour(id: string): TourEntry | undefined {
	return tours.find(tour => tour.id === id)
}

/** The tour to run when `showcaseId` is open: its own, or the default tour when the showcase has none (a hidden fixture). */
export function tourForShowcase(showcaseId: string): TourEntry {
	return getTour(showcaseId) ?? getTour(DEFAULT_TOUR_ID)!
}
