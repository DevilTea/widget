/**
 * The Onboarding tour's script (issue #230, showcase 3), authored against the Tidepool Makers wizard
 * (`showcases/onboarding/presets.ts`, preset `onboarding-default`): the deterministic starting state, like the other
 * tours. Every widget id and member name below is that preset's; the two steps that load another preset
 * (`onboarding-deep-link`, `onboarding-ready-to-book`) have the same widget ids.
 *
 * It teaches what the other tours do not, each as do -> observe -> name where the Preview can observe the "do":
 * - **Events with a host listener**: a Method emits `stepChanged`, the Lab's Events log lists it with its payload, and
 *   the page (the host) heard it and moved focus;
 * - **Method failures**: a refused move is a Method diagnostic, listed in the Events log as a Method failure (not an
 *   Event) and shown on the Method's row of Selected widget; a successful call clears it;
 * - **argument validation**: `invalid-method-arguments` (`validateArgs`, before `execute` runs) against
 *   `invalid-method-result` (`execute` refused);
 * - **async work kept at the host**: `slotRequested`, the host's wait, `settleBooking`, and the ticket that makes a
 *   stale answer harmless.
 *
 * Predicates see only State and the Property results the Preview has already evaluated (`inspection-reader.ts`), never
 * a Method's diagnostics or an Event. So the steps whose "do" leaves no State behind (pressing a refused Next, typing
 * a bad step number) are narrated by their reveal, and the two that load a preset are gated on the State that preset
 * starts in.
 */

import type { TutorialScript } from './types'

export const ONBOARDING_TOUR_ID = 'onboarding'

export const onboardingTourScript: TutorialScript = {
	id: ONBOARDING_TOUR_ID,
	observationTargets: [
		{ widgetId: 'onboarding', member: { type: 'state', key: 'current' } },
		{ widgetId: 'account', member: { type: 'state', key: 'name' } },
		{ widgetId: 'account', member: { type: 'state', key: 'email' } },
		{ widgetId: 'induction', member: { type: 'state', key: 'status' } },
	],
	steps: [
		{
			id: 'orient',
			title: 'This is the Onboarding showcase',
			target: 'onboarding-onboarding',
			onEnter: actions => actions.setFocus('onboarding'),
			stages: [{
				prompt: 'This is a new-member onboarding wizard: four steps, each a widget, under one Onboarding root.',
				reveal: 'This is a new-member onboarding wizard: four steps, each a widget, under one Onboarding root. The page around the widgets is the host: it listens to their Events, does the waiting for a booking office, and writes the answers back. The rest of this tour is about that line between the widgets and the host.',
			}],
		},
		{
			id: 'declared-events',
			title: 'Events are declared, and the host listens',
			target: null,
			onEnter: actions => actions.setFocus('induction'),
			stages: [{
				prompt: 'Open Selected widget and look at the Events of the induction step.',
				reveal: 'Two plugins declare Events: Onboarding (stepChanged, completed) and InductionStep (slotRequested, slotConfirmed, slotDeclined, slotCancelled). An Event is a public notification with a typed payload, emitted by a Method that lists it in emits. A widget cannot subscribe to an Event: only the host can, and it does, through runtime.getWidget(id).events.<name>.subscribe(). The Events log of this Lab listens too, from outside the page.',
			}],
			links: [
				{
					id: 'see-declared-events',
					label: 'See the declared Events in Selected widget',
					run: (actions) => {
						actions.setFocus('induction')
						actions.openTool('widget')
					},
				},
				{ id: 'open-events', label: 'Open the Events log', run: actions => actions.openTool('events') },
			],
		},
		{
			id: 'first-move',
			title: 'A move that emits an Event',
			target: 'onboarding-actions',
			onEnter: actions => actions.setFocus('onboarding', { type: 'method', name: 'next' }),
			stages: [{
				prompt: 'Try it: fill in your name and an e-mail address, then press Next. Keep the Events log open.',
				isComplete: reader => reader.readState('onboarding', 'current') === 1,
				reveal: 'Next wrote State current and emitted stepChanged, in one call. In the Events log the entry carries its payload: the step it left and the step it entered, and how. The page heard the same Event: its activity list says so, and it moved focus to the new step\'s heading. Next is a writing, emitting Method, so Core marks it W and E in Relations, and no Property may depend on it.',
			}],
			links: [
				{ id: 'see-next', label: 'See next() in Selected widget', run: (actions) => {
					actions.setFocus('onboarding', { type: 'method', name: 'next' })
					actions.openTool('widget')
				} },
				{ id: 'open-events-after-move', label: 'Open the Events log', run: actions => actions.openTool('events') },
			],
		},
		{
			id: 'refused-move',
			title: 'A refused move is a Method failure',
			target: 'onboarding-problem',
			onEnter: actions => actions.setFocus('onboarding', { type: 'method', name: 'finish' }),
			stages: [{
				prompt: 'Open the Examples menu and load "Deep link — opens on step 4, nothing filled in".',
				isComplete: reader => reader.readState('onboarding', 'current') === 3 && reader.readState('account', 'name') === '',
				reveal: 'The wizard opened on the last step with nothing filled in. Press Finish: it is refused. Nothing changed and nothing was emitted, so there is no Event. What happened is the Method\'s diagnostic, invalid-method-result with reason steps-incomplete: the Events log lists it as a Method failure (a different kind of entry from an Event), and Selected widget shows it on the finish() row as "Last call failed". The page explains the reason in its own words in its one alert. Finish stays refused until every step is complete, and the next successful call of a Method replaces its failure.',
			}],
			links: [
				{ id: 'see-finish', label: 'See finish() in Selected widget', run: (actions) => {
					actions.setFocus('onboarding', { type: 'method', name: 'finish' })
					actions.openTool('widget')
				} },
				{ id: 'open-events-after-refusal', label: 'Open the Events log', run: actions => actions.openTool('events') },
			],
		},
		{
			id: 'arguments',
			title: 'Arguments are validated before the Method runs',
			target: 'onboarding-jump',
			onEnter: actions => actions.setFocus('onboarding', { type: 'method', name: 'goTo' }),
			stages: [{
				prompt: 'Try it: type 1.5 into "Go to step number" and press Go, then 9, then 2.',
				reveal: 'Type 1.5 and press Go: invalid-method-arguments with reason not-a-whole-number. validateArgs refused it, so execute never ran. Type 9: the argument is a whole number, so it passes, but execute finds there is no such step, and that is invalid-method-result with reason no-such-step. validateArgs sees only the arguments and the config, never the Blueprint or the other widgets, so a rule that needs them is checked in execute. Type 2 while the steps before it are incomplete: step-locked, because the read-only Method canEnter, which goTo calls, says no. In the Events log each one is a Method failure; the page only translates the reason.',
			}],
			links: [
				{ id: 'see-go-to', label: 'See goTo() in Selected widget', run: (actions) => {
					actions.setFocus('onboarding', { type: 'method', name: 'goTo' })
					actions.openTool('widget')
				} },
				{ id: 'see-can-enter', label: 'See canEnter() in Selected widget', run: (actions) => {
					actions.setFocus('onboarding', { type: 'method', name: 'canEnter' })
					actions.openTool('widget')
				} },
			],
		},
		{
			id: 'load-booking',
			title: 'Booking is asynchronous work',
			target: 'onboarding-onboarding',
			onEnter: actions => actions.setFocus('induction'),
			stages: [{
				prompt: 'Open the Examples menu and load "Ready to book — only the induction left".',
				isComplete: reader => reader.readState('onboarding', 'current') === 3 && reader.readState('account', 'name') !== '',
				reveal: 'The first three steps are already complete, so the wizard opens on the induction. Core is synchronous on purpose: a Method cannot wait for anything, a Promise from a callback is a contract violation, and the emit and deps callables of a Method stop working when it returns. So the widget will never wait for the booking. It records the request in State and emits slotRequested; the page, as the host, does the waiting.',
			}],
		},
		{
			id: 'async-booking',
			title: 'The widget asks, the host waits',
			target: 'onboarding-induction-status',
			onEnter: actions => actions.setFocus('induction', { type: 'state', name: 'status' }),
			stages: [{
				prompt: 'Try it: choose a date (5 December 2026), keep 10:00 and press Request this slot.',
				isComplete: reader => reader.readState('induction', 'status') === 'confirmed',
				reveal: 'requestSlot returned at once, with a ticket, after writing status requesting and emitting slotRequested (Events log). The host heard it and asked the simulated booking office, which answered about a second and a half later; the host then called settleBooking(ticket, outcome), an ordinary synchronous Method call from outside Core, which wrote the reference and emitted slotConfirmed. Nothing inside Core waited. Try the 17:00 slot too: the office declines it (slotDeclined). Request a date that is not offered, or with no date at all: invalid-method-arguments, from the config.',
			}],
			links: [
				{ id: 'see-request-slot', label: 'See requestSlot() in Selected widget', run: (actions) => {
					actions.setFocus('induction', { type: 'method', name: 'requestSlot' })
					actions.openTool('widget')
				} },
				{ id: 'open-events-after-booking', label: 'Open the Events log', run: actions => actions.openTool('events') },
			],
		},
		{
			id: 'stale-answers',
			title: 'A late answer is ignored',
			target: 'onboarding-office',
			onEnter: actions => actions.setFocus('induction', { type: 'state', name: 'status' }),
			stages: [{
				prompt: 'Try it: cancel the booking. If the office declined your last request (17:00), there is nothing to cancel: request 10:00 again first.',
				// The previous step ends with a confirmed booking: cancelling it is what leaves that status. Its reveal invites a
				// 17:00 request, which ends declined, where no Cancel button is shown; the prompt says how to get back.
				isComplete: reader => reader.readState('induction', 'status') === 'idle',
				reveal: 'Cancelling emitted slotCancelled. Every request has a ticket, kept in State, and settleBooking applies an answer only if its ticket is still the newest. Cancelling a request that is still waiting makes the host recall it, so no answer comes. If the office cannot recall a request, the answer still arrives later, and settleBooking returns false and changes nothing. Switch off "The office can recall a cancelled request", request a slot, cancel it, request another and let the office answer: the page\'s activity list says the first answer was ignored. Core\'s guide calls this the guard for work that cannot be cancelled.',
			}],
			links: [
				{ id: 'see-settle', label: 'See settleBooking() in Selected widget', run: (actions) => {
					actions.setFocus('induction', { type: 'method', name: 'settleBooking' })
					actions.openTool('widget')
				} },
			],
		},
		{
			id: 'map-the-views',
			title: 'Map the views',
			target: null,
			stages: [{
				prompt: 'Each of these views is a real navigation shortcut — try one.',
				reveal: 'Tools, beside the Preview: Dependencies (Relations, Graph) = the declared chain between widgets, with W and E on the Methods that write State or emit · Selected widget = one widget\'s declaration, Events and Runtime values, with each Method\'s last failure · Runtime tree = every widget\'s State and Properties · Events log = Events and Method failures as they happen · Implementation = the plugin, host and renderer code behind this widget type.',
			}],
			links: [
				{ id: 'view-dependencies', label: 'Dependencies', run: actions => actions.openTool('dependencies') },
				{ id: 'view-widget-tab', label: 'Selected widget', run: actions => actions.openTool('widget') },
				{ id: 'view-runtime', label: 'Runtime tree', run: actions => actions.openTool('runtime') },
				{ id: 'view-events-tab', label: 'Events log', run: actions => actions.openTool('events') },
				{ id: 'view-implementation', label: 'Implementation', run: actions => actions.openTool('implementation') },
			],
		},
		{
			id: 'hand-back',
			title: 'Try it yourself',
			target: null,
			finishLabel: 'Finish',
			stages: [{
				prompt: 'You have seen Events with a host listener, refused moves as Method failures, argument validation and async work kept at the host.',
				reveal: 'Edit the JSON (add a safety rule, change the offered days) and watch the Preview update, load "Draft with mistakes" to see config diagnostics, or open the Implementation of InductionStep to read the host that does the waiting.',
			}],
		},
	],
}
