/**
 * The Survey tour's 9-step script (issue #25 P1 Scope D "Revised Survey step script", Proposal v2).
 *
 * Authored verbatim against the structure and teaching content locked in Proposal v2 — copy is
 * paraphrased only where the rail's shorter card format needs it, never the do -> observe -> name
 * pairing, the failure+recovery-in-one-step shape (step 4), the direct-State-write-vs-Method contrast
 * (step 6), staleness-as-an-interaction (step 7), or the six-view map (step 8). Every widget id/member
 * name below is `survey-default`'s (`showcases/survey/presets.ts`) — the OWNER-locked deterministic
 * starting state this tour is authored against, not an adaptive script over arbitrary Runtime state.
 */

import type { TutorialScript } from './types'

export const SURVEY_TOUR_ID = 'survey'

export const surveyTourScript: TutorialScript = {
	id: SURVEY_TOUR_ID,
	observationTargets: [
		{ widgetId: 'adults', member: { type: 'state', key: 'answer' } },
		{ widgetId: 'children', member: { type: 'state', key: 'answer' } },
		{ widgetId: 'trip-metrics', member: { type: 'property', key: 'tripDays' } },
		{ widgetId: 'trip-survey', member: { type: 'state', key: 'phase' } },
		{ widgetId: 'trip-survey', member: { type: 'property', key: 'resultFresh' } },
	],
	steps: [
		{
			id: 'orient',
			title: 'This is the Interactive Survey',
			target: 'preview',
			onEnter: actions => actions.setFocus('trip-survey'),
			stages: [{
				prompt: 'This is the Interactive Survey — a trip-planning form.',
				reveal: 'This is the Interactive Survey — a trip-planning form.',
			}],
		},
		{
			id: 'state',
			title: 'One answer, stored as State',
			target: 'survey-adults',
			onEnter: actions => actions.setFocus('adults', { type: 'state', name: 'answer' }),
			stages: [{
				prompt: 'Try it: change Adults to a different number.',
				isComplete: (reader) => {
					const value = reader.readState('adults', 'answer')
					return typeof value === 'number' && value !== 2
				},
				reveal: 'The Live estimate just updated. Your answer is stored as State on the adults widget — the Vue input presents that State and forwards your typing to it, but the Runtime owns the value.',
			}],
			links: [{
				id: 'see-in-runtime',
				label: 'See it in Runtime',
				run: (actions) => {
					actions.setFocus('adults', { type: 'state', name: 'answer' })
					actions.activateTab('runtime')
				},
			}],
		},
		{
			id: 'property',
			title: 'A derived value',
			target: 'survey-trip-metrics',
			onEnter: actions => actions.setFocus('trip-metrics', { type: 'property', name: 'tripDays' }),
			stages: [{
				prompt: 'Trip days and costs recomputed by themselves — no action needed here.',
				reveal: 'Trip days and costs recomputed by themselves. They are Properties: values derived from other widgets’ State. The Runtime owns the rule — no Vue code computed them.',
			}],
		},
		{
			id: 'failure-and-recovery',
			title: 'Failure — and recovery',
			target: 'survey-return-date',
			onEnter: actions => actions.setFocus('return', { type: 'state', name: 'answer' }),
			stages: [
				{
					prompt: 'Try it: set Return date to a day before Departure date.',
					isComplete: (reader) => {
						const tripDays = reader.readProperty('trip-metrics', 'tripDays')
						return tripDays?.status === 'completed' && !tripDays.result.success
					},
					reveal: 'Trip days fails with a reason, and every value that depends on it says exactly why it is unavailable — that is failure propagation.',
				},
				{
					prompt: 'Now fix Return date so it is after Departure again.',
					isComplete: (reader) => {
						const tripDays = reader.readProperty('trip-metrics', 'tripDays')
						return tripDays?.status === 'completed' && tripDays.result.success
					},
					reveal: 'The same Properties recovered. Failures are current Runtime results — never a permanently broken page.',
				},
			],
		},
		{
			id: 'dependency',
			title: 'A declared dependency',
			target: 'survey-children',
			onEnter: actions => actions.setFocus('children', { type: 'state', name: 'answer' }),
			// Two stages, deliberately ending back at 0 (per point below): this both demonstrates the
			// dependency reacting in BOTH directions (appear, then disappear) — a stronger observation than
			// prose alone — and keeps the deterministic script submittable at step 6: `TripReadiness`
			// (`plugins/trip-readiness.ts`) only requires `family-priority` while `children > 0`, and
			// `survey-default` deliberately leaves `family-priority` unanswered, so leaving Children at a
			// nonzero value here would make step 6's Submit fail through the exact contextual-requirement
			// path the `survey-not-ready` preset exists to demonstrate — never this tour's own script.
			stages: [
				{
					prompt: 'Try it: set Children to a value above zero.',
					isComplete: (reader) => {
						const value = reader.readState('children', 'answer')
						return typeof value === 'number' && value > 0
					},
					reveal: 'A new "Family preferences" section appeared. That visibility rule is a declared dependency — the section reads the children answer.',
				},
				{
					prompt: 'Now set Children back to 0 to confirm the section reacts both ways.',
					isComplete: reader => reader.readState('children', 'answer') === 0,
					reveal: 'The section disappeared again — the same declared dependency, read live, both ways.',
				},
			],
		},
		{
			id: 'direct-write-vs-method',
			title: 'A direct write vs. a Method',
			target: 'survey-actions',
			onEnter: actions => actions.setFocus('trip-survey', { type: 'method', name: 'submit' }),
			stages: [{
				prompt: 'Press Submit, then Generate result.',
				isComplete: reader => reader.readState('trip-survey', 'phase') === 'result',
				reveal: 'Changing Adults wrote one State value through the semantic bridge. Submit and Generate result invoke named Methods — explicit semantic actions that can enforce rules, coordinate several changes, and update State.',
			}],
		},
		{
			id: 'stale-snapshot',
			title: 'Snapshot vs. live',
			target: 'survey-recommendation',
			onEnter: actions => actions.setFocus('trip-survey', { type: 'property', name: 'resultFresh' }),
			stages: [{
				prompt: 'Now change any answer again (for example, Adults) and watch the Recommendation.',
				isComplete: (reader) => {
					const resultFresh = reader.readProperty('trip-survey', 'resultFresh')
					return resultFresh?.status === 'completed' && resultFresh.result.success && resultFresh.result.value === false
				},
				reveal: 'The live estimate moved, while the Recommendation kept its old values and gained the Stale marker. The result is a stored State snapshot; the estimate is a live Property.',
			}],
		},
		{
			id: 'map-the-views',
			title: 'Map the views',
			target: null,
			stages: [{
				prompt: 'Each of these views is a real navigation shortcut — try one.',
				reveal: 'Source = the declarative definition you edit · Blueprint = what the applied Source compiled into · Runtime = live State/Properties/Methods/Issues · Graph = declared dependencies · Preview = the Vue presentation · Implementation = the plugin + renderer code behind this widget type.',
			}],
			links: [
				{ id: 'view-source', label: 'Source', run: actions => actions.activateTab('source') },
				{ id: 'view-blueprint', label: 'Blueprint', run: actions => actions.activateTab('blueprint') },
				{ id: 'view-runtime', label: 'Runtime', run: actions => actions.activateTab('runtime') },
				{ id: 'view-graph', label: 'Graph', run: actions => actions.activateTab('graph') },
				{ id: 'view-preview', label: 'Preview', run: actions => actions.activateTab('preview') },
				// issue #25 P3: a real affordance now — opens the Implementation panel for whichever widget
				// is currently held in shared focus (this step never changes focus itself, matching every
				// other link in this step).
				{ id: 'view-implementation', label: 'Implementation', run: actions => actions.openImplementation() },
			],
		},
		{
			id: 'hand-back',
			title: 'Try it yourself',
			target: null,
			finishLabel: 'Finish',
			stages: [{
				prompt: 'You now know State, Property, Method, and dependency.',
				reveal: 'Try the CRM tour, open any inspector, or edit the Source JSON and press Apply.',
			}],
		},
	],
}
