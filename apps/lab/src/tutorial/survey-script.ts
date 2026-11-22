/**
 * The Survey tour's 10-step script (diagnostic #25 P1 Scope D "Revised Survey step script", Proposal v2),
 * authored against the Maker Space open-day sign-up survey.
 *
 * What is kept from Proposal v2 is the structure and the do -> observe -> name pairing, the direct-State-
 * write-vs-Method contrast, staleness-as-an-interaction and the map of the views. Lab UX phase 2 (report item 14)
 * moved the map to step 2 (it names Selected widget and Events too) and added `edit-and-undo` near the end: the
 * earlier steps only change Preview answers (Runtime State), and this one changes the definition itself (a label in
 * Author > Structure), shows the Preview rebuilt from it, and takes it back with Undo. It comes after the answer steps
 * because a committed edit restarts the Preview, so the answers those steps build on start over.
 * The error step's lesson changed from Proposal v2: the sign-up form keeps answer errors as values (a Numeric answer
 * above its `max` is stored and reported through the `errors` Property), so it teaches "an answer error,
 * and recovery" instead of failure propagation. Every widget id/member name below is `survey-default`'s
 * (`showcases/survey/presets.ts`) — the OWNER-locked deterministic starting state this tour is authored
 * against, not an adaptive script over arbitrary Runtime state.
 *
 * Property predicates see only values the Preview has already evaluated (`inspection-reader.ts` never
 * forces evaluation), so the survey renderers always read `guests.visible`, `guests.errors` while visible,
 * `open-day.changedSinceSubmit` and `mode.text` (the label the edit step watches; `mode` is always visible).
 */

import type { TutorialRuntimeReader, TutorialScript } from './types'

export const SURVEY_TOUR_ID = 'survey'

/** The `open-day` root's `submitted` snapshot is a non-null object once a Submit succeeded. */
function hasSubmitted(reader: TutorialRuntimeReader): boolean {
	const submitted = reader.readState('open-day', 'submitted')
	return typeof submitted === 'object' && submitted !== null
}

/** The completed `guests.errors` array of a successful evaluation, else `undefined`. */
function guestsErrors(reader: TutorialRuntimeReader): readonly { readonly code?: unknown }[] | undefined {
	const errors = reader.readProperty('guests', 'errors')
	if (errors?.status !== 'completed' || !errors.result.ok || !Array.isArray(errors.result.value))
		return undefined
	return errors.result.value as readonly { readonly code?: unknown }[]
}

/** `mode`'s label in `survey-default`, in each survey language: the edit step compares against both. */
export const MODE_DEFAULT_LABELS: readonly string[] = ['How will you join?', '您會如何參加？']

/** The label the Preview shows for `mode` (its `text` Property, which the renderer always reads), else `undefined`. */
function modeLabel(reader: TutorialRuntimeReader): string | undefined {
	const text = reader.readProperty('mode', 'text')
	if (text?.status !== 'completed' || !text.result.ok)
		return undefined
	const label = (text.result.value as { readonly label?: unknown } | null)?.label
	return typeof label === 'string' ? label : undefined
}

/** The successful `guests.visible` value, else `undefined`. */
function guestsVisible(reader: TutorialRuntimeReader): unknown {
	const visible = reader.readProperty('guests', 'visible')
	return visible?.status === 'completed' && visible.result.ok ? visible.result.value : undefined
}

export const surveyTourScript: TutorialScript = {
	id: SURVEY_TOUR_ID,
	observationTargets: [
		{ widgetId: 'mode', member: { type: 'state', key: 'answer' } },
		{ widgetId: 'guests', member: { type: 'property', key: 'errors' } },
		{ widgetId: 'guests', member: { type: 'property', key: 'visible' } },
		{ widgetId: 'open-day', member: { type: 'state', key: 'submitted' } },
		{ widgetId: 'open-day', member: { type: 'property', key: 'changedSinceSubmit' } },
		{ widgetId: 'mode', member: { type: 'property', key: 'text' } },
	],
	steps: [
		{
			id: 'orient',
			title: 'This is the Interactive Survey',
			target: 'preview',
			onEnter: actions => actions.setFocus('open-day'),
			stages: [{
				prompt: 'This is the Interactive Survey — a sign-up form rendered from one JSON definition.',
				reveal: 'This is the Interactive Survey — a sign-up form rendered from one JSON definition.',
			}],
		},
		{
			// Early (Lab UX phase 2): the visitor knows where things are before the steps send them there.
			// TODO(phase 3): drop the views the IA moves into Tools.
			id: 'map-the-views',
			title: 'Map the views',
			target: null,
			stages: [{
				prompt: 'Each of these views is a real navigation shortcut — try one.',
				reveal: 'Author = the definition you edit (Structure, or the JSON) · Preview = the running app · Explain = select a widget (Inspect in the Preview, or the Structure tree) to see what it is and why it behaves this way · Selected widget = its config and live values side by side · Events = what the widgets announced · Blueprint = what the definition compiled into · Runtime = live State, Properties and Methods · Dependencies = which widget reads which · Implementation = the plugin and renderer code behind a widget type.',
			}],
			links: [
				{ id: 'view-author', label: 'Author', run: actions => actions.activateTab('author') },
				{ id: 'view-preview', label: 'Preview', run: actions => actions.activateTab('preview') },
				{ id: 'view-explain', label: 'Explain', run: actions => actions.activateTab('explain') },
				{ id: 'view-widget', label: 'Selected widget', run: actions => actions.activateTab('widget') },
				{ id: 'view-events', label: 'Events', run: actions => actions.activateTab('events') },
				{ id: 'view-blueprint', label: 'Blueprint', run: actions => actions.activateTab('blueprint') },
				{ id: 'view-runtime', label: 'Runtime', run: actions => actions.activateTab('runtime') },
				{ id: 'view-dependencies', label: 'Dependencies', run: actions => actions.activateTab('dependencies') },
				// diagnostic #25 P3: opens the Implementation panel for whichever widget is currently held in shared focus
				// (this step never changes focus itself, matching every other link in this step).
				{ id: 'view-implementation', label: 'Implementation', run: actions => actions.openImplementation() },
			],
		},
		{
			id: 'state',
			title: 'One answer, stored as State',
			target: 'survey-mode',
			onEnter: actions => actions.setFocus('mode', { type: 'state', name: 'answer' }),
			stages: [{
				prompt: 'Try it: choose "On site" for "How will you join?".',
				isComplete: reader => reader.readState('mode', 'answer') === 'onsite',
				reveal: 'Guests and Phone reacted. Your choice is stored as State on the mode widget — the radio buttons present that State and forward your click to it, but the Runtime owns the value.',
			}],
			links: [{
				id: 'see-in-runtime',
				label: 'See it in Runtime',
				run: (actions) => {
					actions.setFocus('mode', { type: 'state', name: 'answer' })
					actions.activateTab('runtime')
				},
			}],
		},
		{
			id: 'property',
			title: 'A derived value',
			target: 'survey-mode',
			onEnter: actions => actions.setFocus('mode', { type: 'property', name: 'errors' }),
			stages: [{
				prompt: 'The required message under "How will you join?" went away by itself — no action needed here.',
				reveal: 'The required message under "How will you join?" disappeared, and Phone now says it is required. errors and required are Properties: values derived from State by rules in the definition. The Runtime owns the rule — no Vue code computed them.',
			}],
		},
		{
			id: 'error-and-recovery',
			title: 'An answer error — and recovery',
			target: 'survey-guests',
			onEnter: actions => actions.setFocus('guests', { type: 'property', name: 'errors' }),
			stages: [
				{
					prompt: 'Try it: set Guests to 5.',
					isComplete: reader => guestsErrors(reader)
						?.some(error => error.code === 'max') === true,
					reveal: 'Guests reports an error, yet your number is still stored: answer errors are data — the form, the submit button and a backend all read the same errors Property.',
				},
				{
					prompt: 'Now set Guests to 2.',
					isComplete: reader => guestsErrors(reader)?.length === 0,
					reveal: 'The error is gone. Errors are current Runtime results — never a permanently broken page.',
				},
			],
		},
		{
			id: 'dependency',
			title: 'A declared dependency',
			target: 'survey-mode',
			onEnter: actions => actions.setFocus('guests', { type: 'property', name: 'visible' }),
			// Two stages, deliberately ending back on "On site": the dependency reacts in BOTH directions
			// (Guests disappears, then returns still holding 2), and the deterministic script stays
			// submittable at step 6 — Guests is visible, valid and answered.
			stages: [
				{
					prompt: 'Try it: switch "How will you join?" to "Online".',
					isComplete: reader => guestsVisible(reader) === false,
					reveal: 'Guests disappeared. Its visibility rule is a declared dependency on the value of the mode question — and a hidden question has no value.',
				},
				{
					prompt: 'Now switch back to "On site".',
					isComplete: reader => guestsVisible(reader) === true,
					reveal: 'Guests is back, still holding your answer: hiding never erased the stored answer. The same declared dependency, read live, both ways.',
				},
			],
		},
		{
			id: 'direct-write-vs-method',
			title: 'A direct write vs. a Method',
			target: 'survey-actions',
			onEnter: actions => actions.setFocus('open-day', { type: 'method', name: 'submit' }),
			stages: [{
				prompt: 'Tick a session, type a phone number, then press Submit.',
				isComplete: hasSubmitted,
				reveal: 'Your answers were direct State writes. Submit invokes a named Method: it checks that the survey has no errors, refuses otherwise, and on success stores the response and emits a submitted Event for the host.',
			}],
		},
		{
			id: 'stale-snapshot',
			title: 'Snapshot vs. live',
			target: 'survey-submitted',
			onEnter: actions => actions.setFocus('open-day', { type: 'property', name: 'changedSinceSubmit' }),
			stages: [{
				prompt: 'Now change any answer (for example, Guests) and watch the Submitted panel.',
				isComplete: (reader) => {
					const changed = reader.readProperty('open-day', 'changedSinceSubmit')
					return changed?.status === 'completed' && changed.result.ok && changed.result.value === true
				},
				reveal: 'The submitted copy kept its values and gained the "Answers changed since you submitted" marker. The submission is a stored State snapshot; the response is a live Property — open "Response — what a backend reads" below the form to see its current values.',
			}],
		},
		{
			// Lab UX phase 2 (report item 14): every step above changes answers; this one changes the definition. A Structure
			// edit is a Document commit, so the Preview is rebuilt from it (its answers start over), and Undo takes it back as a
			// new revision. Gated on what the Preview shows: `mode.text` is the label the renderer reads, in the survey language.
			id: 'edit-and-undo',
			title: 'Change the definition, then undo',
			target: 'author-structure',
			onEnter: (actions) => {
				actions.setFocus('mode')
				actions.activateTab('author', 'structure')
			},
			stages: [
				{
					prompt: 'Try it: in Author > Structure, change the label of "How will you join?" (its en text, or zh-TW if the survey shows Chinese), then press Enter.',
					isComplete: (reader) => {
						const label = modeLabel(reader)
						return label !== undefined && !MODE_DEFAULT_LABELS.includes(label)
					},
					reveal: 'The Preview shows your new label. You changed the definition, not an answer: the change was committed to the Document at once and the Preview was rebuilt from it, which is why its answers started over.',
				},
				{
					prompt: 'Now press Undo in the header.',
					isComplete: (reader) => {
						const label = modeLabel(reader)
						return label !== undefined && MODE_DEFAULT_LABELS.includes(label)
					},
					reveal: 'The label is back. Undo restores the previous version of the definition, whether the change came from Structure, the JSON view or a preset.',
				},
			],
		},
		{
			id: 'hand-back',
			title: 'Try it yourself',
			target: null,
			finishLabel: 'Finish',
			stages: [{
				prompt: 'You now know State, Property, Method, and dependency.',
				reveal: 'Open any inspector, or keep editing in Author: Structure applies each change at once, and Undo takes it back.',
			}],
		},
	],
}
