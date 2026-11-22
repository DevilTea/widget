/**
 * The Trip budget tour's script (issue #230, showcase 1), authored against the Lisbon weekend trip
 * (`showcases/trip-budget/presets.ts`, preset `trip-default`): the deterministic starting state, like the
 * Survey tour's. Every widget id and member name below is that preset's.
 *
 * It teaches four things the Survey does not, each as do -> observe -> name:
 * - a **chain of Properties across widgets** (change an expense, watch the settlement follow, then read the
 *   chain in Relations);
 * - **read-only Methods called by a Property**: `Currency.convert` (the museum's currency) and
 *   `Currency.roundTransfer` (the rounding step);
 * - **laziness**: `Expense.breakdown` is `Never evaluated` until the Preview opens it. The Lab can show
 *   whether a Property was ever evaluated and its latest result; it cannot show who is subscribed, so the
 *   step says so instead of pretending to;
 * - **`resetState`**: "Reset this expense" is `widget.resetState()`, "Start over" is `runtime.resetState()`.
 *
 * Property predicates see only values the Preview has already evaluated (`inspection-reader.ts` never forces
 * evaluation): the renderers always read the settlement and `amountBase`, never `breakdown` until it is
 * opened, which is exactly what the laziness step observes.
 */

import type { TutorialRuntimeReader, TutorialScript } from './types'

export const TRIP_BUDGET_TOUR_ID = 'trip-budget'

/** The authored starting amount of the hotel expense in `trip-default`. */
const HOTEL_START = 420

function hotelAmount(reader: TutorialRuntimeReader): unknown {
	return reader.readState('hotel', 'amount')
}

export const tripBudgetTourScript: TutorialScript = {
	id: TRIP_BUDGET_TOUR_ID,
	observationTargets: [
		{ widgetId: 'hotel', member: { type: 'state', key: 'amount' } },
		{ widgetId: 'hotel', member: { type: 'property', key: 'breakdown' } },
		{ widgetId: 'museum', member: { type: 'state', key: 'currency' } },
		{ widgetId: 'currency', member: { type: 'state', key: 'roundStep' } },
	],
	steps: [
		{
			id: 'orient',
			title: 'This is the Trip budget splitter',
			target: 'preview',
			onEnter: actions => actions.setFocus('lisbon'),
			stages: [{
				prompt: 'This is the Trip budget splitter — four friends, five expenses and a settlement, rendered from one JSON definition.',
				reveal: 'This is the Trip budget splitter — four friends, five expenses and a settlement, rendered from one JSON definition.',
			}],
		},
		{
			id: 'chain',
			title: 'A chain of Properties across widgets',
			target: 'trip-hotel',
			onEnter: actions => actions.setFocus('hotel', { type: 'state', name: 'amount' }),
			stages: [{
				prompt: 'Try it: change the Hotel amount from 420 to anything else.',
				isComplete: reader => typeof hotelAmount(reader) === 'number' && hotelAmount(reader) !== HOTEL_START,
				reveal: 'The settlement moved, and nobody told it to. The amount is State on the hotel widget. Everything after it is a Property that reads the one before: amountBase, then shares, then each person\'s owed and balance, then the Settlement\'s balances and transfers. Open Relations to see that chain.',
			}],
			links: [{
				id: 'see-chain',
				label: 'Follow the chain in Relations',
				run: (actions) => {
					actions.setFocus('settlement', { type: 'property', name: 'transfers' })
					actions.activateTab('dependencies')
				},
			}],
		},
		{
			id: 'read-only-method',
			title: 'A read-only Method called by a Property',
			target: 'trip-museum',
			onEnter: actions => actions.setFocus('museum', { type: 'property', name: 'amountBase' }),
			stages: [{
				prompt: 'Try it: change the Museum tickets currency from USD to GBP.',
				isComplete: reader => reader.readState('museum', 'currency') === 'GBP',
				reveal: 'The converted amount changed. The museum widget knows no rates: its amountBase Property calls the Currency widget\'s Method convert(amount, currency). Core only lets a Property depend on a Method that is read-only: it writes no State and emits no Event. In Relations, select convert: it is marked read-only, with neither a W (writes State) nor an E (emits an Event) badge.',
			}],
			links: [{
				id: 'see-method',
				label: 'Follow the Method in Relations',
				run: (actions) => {
					actions.setFocus('currency', { type: 'method', name: 'convert' })
					actions.activateTab('dependencies')
				},
			}],
		},
		{
			id: 'rounding',
			title: 'Another Method, reading State',
			target: 'trip-currency',
			onEnter: actions => actions.setFocus('currency', { type: 'state', name: 'roundStep' }),
			stages: [{
				prompt: 'Try it: set "Round transfers to" to a whole unit.',
				isComplete: reader => reader.readState('currency', 'roundStep') === 100,
				reveal: 'The payments are now whole euros and a note says how far they are from the exact balances. Settlement.transfers calls the Currency\'s second read-only Method, roundTransfer, which reads State roundStep. A Method can read State, so changing the step changes what the Method returns and recomputes every Property that calls it.',
			}],
		},
		{
			id: 'laziness',
			title: 'Computed only when read',
			target: 'trip-hotel',
			onEnter: actions => actions.setFocus('hotel', { type: 'property', name: 'breakdown' }),
			stages: [
				{
					prompt: 'Select the Runtime tab: on the hotel widget, breakdown says Never evaluated.',
					reveal: 'On the hotel widget, breakdown says Never evaluated (Runtime or Selected widget). It is a Property, and Properties are lazy: Core runs one only when something reads it, and nothing in the page does yet. The same holds for each person\'s ledger.',
				},
				{
					prompt: 'Try it: press "Show breakdown" on Hotel.',
					isComplete: (reader) => {
						const breakdown = reader.readProperty('hotel', 'breakdown')
						return breakdown?.status === 'completed' && breakdown.result.ok
					},
					reveal: 'Now breakdown has a value. Opening it mounts a component that reads the Property, which subscribes and makes Core run it. Close it and the subscription is released: Core keeps the last result but runs nothing until something reads it again. The Lab shows whether a Property was ever evaluated and its latest result; it cannot show who is subscribed.',
				},
			],
			links: [{
				id: 'see-breakdown',
				label: 'See breakdown in Selected widget',
				run: (actions) => {
					actions.setFocus('hotel', { type: 'property', name: 'breakdown' })
					actions.activateTab('widget')
				},
			}],
		},
		{
			id: 'reset-state',
			title: 'Starting over with resetState',
			target: 'trip-hotel',
			onEnter: actions => actions.setFocus('hotel', { type: 'state', name: 'amount' }),
			stages: [
				{
					prompt: 'Make sure the Hotel amount is not 420 (type another number).',
					isComplete: reader => typeof hotelAmount(reader) === 'number' && hotelAmount(reader) !== HOTEL_START,
					reveal: 'The Hotel amount is not the 420 the document authored.',
				},
				{
					prompt: 'Try it: press "Reset this expense" on Hotel.',
					isComplete: reader => hotelAmount(reader) === HOTEL_START,
					reveal: 'Hotel went back to 420, the value the document authored, and the settlement followed. "Reset this expense" asks the host for widget.resetState(): every State member of that widget returns to its initial value. "Start over" calls runtime.resetState() for all widgets, and the root renderer then writes the interface language back, so the page does not switch language. It resets State only: Property and Method diagnostics are not cleared.',
				},
			],
		},
		{
			id: 'diagnostics',
			title: 'Two kinds of failure',
			target: null,
			stages: [{
				prompt: 'Open the Examples menu and load "Draft with mistakes", then "Run-time failure".',
				reveal: 'Draft with mistakes has four located diagnostics (a rate of 0, percentages that add up to 90, a negative amount, a payer who is not on the trip): they appear in Problems, and the Preview keeps the last valid version. Run-time failure compiles, but its museum currency has no rate: Currency.convert fails when it runs, and every Property that depends on it fails too. Select the museum widget in Selected widget: amountBase and shares say Failed, with the diagnostic.',
			}],
			links: [
				{ id: 'view-widget', label: 'Selected widget', run: actions => actions.activateTab('widget') },
			],
		},
		{
			id: 'map-the-views',
			title: 'Map the views',
			target: null,
			stages: [{
				prompt: 'Each of these views is a real navigation shortcut — try one.',
				reveal: 'Dependencies (Relations, Graph) = the declared chain between widgets · Selected widget = one widget\'s declaration and Runtime values · Runtime = every widget\'s State and Properties (Never evaluated until something reads them) · Events = Method failures and Events as they happen · Implementation = the plugin and renderer code behind this widget type.',
			}],
			links: [
				{ id: 'view-dependencies', label: 'Dependencies', run: actions => actions.activateTab('dependencies') },
				{ id: 'view-widget-tab', label: 'Selected widget', run: actions => actions.activateTab('widget') },
				{ id: 'view-runtime', label: 'Runtime', run: actions => actions.activateTab('runtime') },
				{ id: 'view-events-tab', label: 'Events', run: actions => actions.activateTab('events') },
				{ id: 'view-implementation', label: 'Implementation', run: actions => actions.openImplementation() },
			],
		},
		{
			id: 'hand-back',
			title: 'Try it yourself',
			target: null,
			finishLabel: 'Finish',
			stages: [{
				prompt: 'You have seen a Property chain, read-only Methods, laziness and resetState.',
				reveal: 'Edit the JSON (add an expense, a person or a rate) and watch the Preview update, or open the Implementation of any widget type.',
			}],
		},
	],
}
