/**
 * `Trip`: the root of a trip budget. It holds the trip language (State `language`) and lays out the four
 * parts of a trip in slots: `settings` (exactly one Currency), `people`, `expenses` and `summary` (the
 * Settlement). It has no Method: everything a viewer changes is State on the widget it belongs to.
 *
 * Its Properties are `title` (the authored title in the trip language) and `view` (the language and the base
 * currency; the renderers look the built-in texts up from the language). Every other widget has the same `view`, derived from the root's
 * language, so a language switch reaches every widget through a declared dependency.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { TripConfig, TripRawConfig } from '../config'
import type { TripView } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkTripConfig, resolveTripConfig } from '../config'
import { tripConfigDocs, tripRawConfigDocs, tripViewDocs } from '../docs'
import { DEFAULT_TRIP_LANGUAGE, isTripLanguage, localize } from '../domain'
import { baseRead, viewFrom } from './reads'

export interface TripInterfaces extends WidgetInterfaces {
	config: { raw: TripRawConfig, resolved: TripConfig }
	slots: {
		settings: 'Currency'
		people: 'Person'
		expenses: 'Expense'
		summary: 'Settlement'
	}
	state: {
		language: string
	}
	properties: {
		title: string
		view: TripView
	}
}

export const TripPlugin = createWidgetPlugin('Trip')
	.description('The root of a trip budget. Holds the trip language (State `language`: en or zh-TW) and lays out the Currency (`settings`), the Persons (`people`), the Expenses (`expenses`) and the Settlement (`summary`). Properties: `title` (the title in the trip language) and `view` (the language and the base currency).')
	.interfaces<TripInterfaces>()
	.config({
		description: 'The trip title per language (`en` is required, other languages fall back to it).',
		raw: tripRawConfigDocs,
		resolved: tripConfigDocs,
		validate: (input, ctx): input is TripRawConfig => {
			checkTripConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveTripConfig,
	})
	.slots({
		settings: {
			description: 'Exactly one Currency: the base currency, the rates and the transfer rounding.',
			validateStructure: ({ children, addDiagnostic }) => {
				if (children.length !== 1)
					addDiagnostic({ message: `The settings slot needs exactly one Currency, found ${children.length}.`, reason: 'settings-needs-one-currency' })
				children.forEach((child, index) => {
					if (child.resolved && child.type !== 'Currency')
						addDiagnostic({ message: `"${child.type}" is not a Currency.`, index, reason: 'not-a-currency' })
				})
			},
		},
		people: {
			description: 'The people on the trip, in the order they are listed: Person widgets.',
			validateStructure: ({ children, addDiagnostic }) => {
				children.forEach((child, index) => {
					if (child.resolved && child.type !== 'Person')
						addDiagnostic({ message: `"${child.type}" is not a Person.`, index, reason: 'not-a-person' })
				})
			},
		},
		expenses: {
			description: 'The expense lines in display order: Expense widgets.',
			validateStructure: ({ children, addDiagnostic }) => {
				children.forEach((child, index) => {
					if (child.resolved && child.type !== 'Expense')
						addDiagnostic({ message: `"${child.type}" is not an Expense.`, index, reason: 'not-an-expense' })
				})
			},
		},
		summary: {
			description: 'The settlement summary: at most one Settlement widget.',
			validateStructure: ({ children, addDiagnostic }) => {
				if (children.length > 1)
					addDiagnostic({ message: `The summary slot takes at most one Settlement, found ${children.length}.`, index: 1, reason: 'too-many-settlements' })
				children.forEach((child, index) => {
					if (child.resolved && child.type !== 'Settlement')
						addDiagnostic({ message: `"${child.type}" is not a Settlement.`, index, reason: 'not-a-settlement' })
				})
			},
		},
	})
	.structure(({ widget, blueprint, addDiagnostic }) => {
		if (blueprint.getParent(widget) !== null)
			addDiagnostic({ message: 'A Trip must be the root widget.', reason: 'trip-not-root' })
	})
	.state(state => state.language({
		description: 'The trip language: `en` or `zh-TW`.',
		validate: (input): input is string => isTripLanguage(input),
		default: () => DEFAULT_TRIP_LANGUAGE,
	}))
	.properties(properties => properties
		.title({
			description: 'The authored title in the trip language.',
			registerDeps: ({ dep }) => ({ language: dep.self.state.get('language') }),
			compute: ({ deps, config }) => {
				const language = deps.language()
				return localize(config.title, language.ok && language.value !== null ? language.value : DEFAULT_TRIP_LANGUAGE)
			},
		})
		.view({
			description: 'The trip language and the base currency; the renderers look the built-in texts up from the language.',
			ref: tripViewDocs,
			registerDeps: ({ dep, blueprint }) => ({
				language: dep.self.state.get('language'),
				...baseRead(dep, blueprint),
			}),
			compute: ({ deps }) => viewFrom(deps),
		}))
	.done()
