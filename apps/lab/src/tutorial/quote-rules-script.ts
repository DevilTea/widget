/**
 * The Quote rules tour's script (issue #230, showcase 2), authored against the Corner Press print job
 * (`showcases/quote-rules/presets.ts`, preset `quote-default`): the deterministic starting state, like the other
 * tours. Every widget id and member name below is that preset's (the isolated-exception step is the one that asks
 * the visitor to load `quote-buggy-rule`, which has the same `flyers` and `volume` widgets).
 *
 * It teaches four things the other tours do not, each as do -> observe -> name:
 * - **the same rules outside a page**: the Quote's `answers` and `quote` Properties are the request and the
 *   response of a JSON-in/JSON-out call, and a Web Worker with no DOM prices the same document again;
 * - **a schema library through Standard Schema**: the validators and the config JSON Schema of the plugins come from
 *   one Valibot schema each, and the Structure editor builds its controls from that JSON Schema;
 * - **validation messages that are the library's own**: the invalid preset's diagnostics are Valibot's, verbatim;
 * - **isolated exceptions**: a rule whose code throws while a subscription recomputes it, and the page that
 *   receives the exception through `setIsolatedErrorHandler`.
 *
 * Property predicates see only values the Preview has already evaluated (`inspection-reader.ts` never forces
 * evaluation), and Core's inspection reports only a Property's latest *completed* result: a Property whose
 * `compute` threw still shows the result before it. So the isolated-exception step is gated on State (the flyers
 * quantity in the buggy preset, whose document has no `rush` widget) and says what the Lab cannot show.
 */

import type { TutorialRuntimeReader, TutorialScript } from './types'

export const QUOTE_RULES_TOUR_ID = 'quote-rules'

/** The authored starting quantity of the flyers in `quote-default`. */
const FLYERS_START = 500

function flyersQuantity(reader: TutorialRuntimeReader): unknown {
	return reader.readState('flyers', 'quantity')
}

export const quoteRulesTourScript: TutorialScript = {
	id: QUOTE_RULES_TOUR_ID,
	observationTargets: [
		{ widgetId: 'flyers', member: { type: 'state', key: 'quantity' } },
		{ widgetId: 'rush', member: { type: 'state', key: 'enabled' } },
		{ widgetId: 'delivery', member: { type: 'state', key: 'method' } },
	],
	steps: [
		{
			id: 'orient',
			title: 'This is the Quote rules showcase',
			target: 'quote-quote',
			onEnter: actions => actions.setFocus('quote'),
			stages: [{
				prompt: 'This is a print shop quote: one JSON definition, priced by rule widgets in the page, and priced again by a Web Worker from the very same files.',
				reveal: 'This is a print shop quote: one JSON definition, priced by rule widgets in the page, and priced again by a Web Worker from the very same files.',
			}],
		},
		{
			id: 'same-rules',
			title: 'The same rules, outside the page',
			target: 'quote-same-rules',
			onEnter: actions => actions.setFocus('flyers', { type: 'state', name: 'quantity' }),
			stages: [{
				prompt: 'Try it: change the A5 flyers quantity from 500 to another number.',
				isComplete: reader => typeof flyersQuantity(reader) === 'number' && flyersQuantity(reader) !== FLYERS_START,
				reveal: 'Both columns moved, and both show the same JSON. The right-hand one was computed by a Web Worker, which has no document and no window: it was given only the document and the Quote widget\'s Property answers, as JSON text, wrote the answers into a fresh Runtime and read the Property quote. There is no second implementation of a price rule to keep in step, because the browser and the backend run the same plugin files.',
			}],
			links: [{
				id: 'see-answers',
				label: 'See answers and quote in Selected widget',
				run: (actions) => {
					actions.setFocus('quote', { type: 'property', name: 'answers' })
					actions.activateTab('widget')
				},
			}],
		},
		{
			id: 'rules',
			title: 'Rules are widgets',
			target: 'quote-rush',
			onEnter: actions => actions.setFocus('rush', { type: 'state', name: 'enabled' }),
			stages: [{
				prompt: 'Try it: switch on Rush production and choose Courier as the delivery method.',
				isComplete: reader => reader.readState('rush', 'enabled') === true && reader.readState('delivery', 'method') === 'courier',
				reveal: 'Each rule is its own plugin with its own State: Rush production owns enabled, Delivery owns method. The tax is applied last: Quote.taxableCents reads the discount, the rush surcharge and the delivery fee, and SalesTax.adjustment reads taxableCents. Core checks that chain for loops, and Relations shows it.',
			}],
			links: [{
				id: 'see-chain',
				label: 'Follow the chain in Relations',
				run: (actions) => {
					actions.setFocus('tax', { type: 'property', name: 'adjustment' })
					actions.activateTab('dependencies')
				},
			}],
		},
		{
			id: 'config-schema',
			title: 'One schema, three jobs',
			target: null,
			onEnter: actions => actions.setFocus('volume'),
			stages: [{
				prompt: 'Open Author, then Structure, and look at the volume widget\'s config.',
				reveal: 'The config of every rule is a Valibot schema used through Standard Schema. It is the validator (one small guard turns each issue into a diagnostic), the TypeScript type, and, through Standard JSON Schema, the config JSON Schema that Core publishes in the Catalog. That is why Structure offers a list of tiers with Add and Remove and number boxes: the controls are built from the schema. Core never runs the JSON Schema, and a refinement it cannot express would be missing from it.',
			}],
			links: [
				{ id: 'open-author', label: 'Open Author', run: actions => actions.activateTab('author') },
			],
		},
		{
			id: 'invalid-config',
			title: 'The library\'s own messages',
			target: null,
			stages: [{
				prompt: 'Open the Examples menu and load "Invalid config".',
				reveal: 'The default with mistakes in five widgets. Every message in Problems is Valibot\'s own, word for word, at the place it was found: a string where a number is expected, a quantity of 2.5, an unrecognized key, a percentage over 100. Core only receives what the guard reports, and the Preview keeps the last valid version.',
			}],
		},
		{
			id: 'isolated-exception',
			title: 'A rule that throws',
			target: 'quote-isolated',
			stages: [{
				prompt: 'Open the Examples menu, load "Buggy rule", then set the A5 flyers quantity below 90, for example 50.',
				isComplete: reader => reader.readState('rush', 'enabled') === undefined && typeof flyersQuantity(reader) === 'number' && (flyersQuantity(reader) as number) < 90,
				reveal: 'The write succeeded: flyers is 50. But the volume rule\'s compute threw a TypeError, because no tier covers 52 pieces and the code assumed the first tier starts at 1. A throwing compute is not a Diagnostic. Core isolated it so the write and every other subscriber were unaffected, and handed it to setIsolatedErrorHandler, which this page installed: see Isolated exceptions. The amounts are the last ones that worked, and the page says so. The Lab\'s Runtime and Selected widget still show volume.adjustment\'s last completed value, because Core\'s inspection reports only completed results: it cannot show that exception.',
			}],
			links: [{
				id: 'see-volume',
				label: 'See volume in Selected widget',
				run: (actions) => {
					actions.setFocus('volume', { type: 'property', name: 'adjustment' })
					actions.activateTab('widget')
				},
			}],
		},
		{
			id: 'map-the-views',
			title: 'Map the views',
			target: null,
			stages: [{
				prompt: 'Each of these views is a real navigation shortcut — try one.',
				reveal: 'Dependencies (Relations, Graph) = the declared chain between widgets · Selected widget = one widget\'s declaration and Runtime values · Runtime = every widget\'s State and Properties · Events = Method failures and Events as they happen · Implementation = the plugin, schema and renderer code behind this widget type.',
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
				prompt: 'You have seen the same rules in a page and a Web Worker, a schema library through Standard Schema and an isolated exception.',
				reveal: 'Edit the JSON (change a tier, add a paper, set a tax rate) and press Apply, or open the Implementation of any widget type.',
			}],
		},
	],
}
