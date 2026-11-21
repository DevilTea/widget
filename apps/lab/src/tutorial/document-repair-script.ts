/**
 * The Legacy document repair tour's script (issue #230), authored against the repair desk
 * (`showcases/document-repair/presets.ts`, preset `repair-default`): the deterministic starting state, like the other tours.
 * Every widget id and member name below is that preset's.
 *
 * It teaches one thing from several sides: **a stored document that no longer compiles is repaired by the application, not
 * by Core.** Core compiles any source and says where the problems are, applies the `SourcePatch` the host sends, and creates
 * a Runtime only for a valid document. Migration is the application's own policy (`planRepair`), and nothing is persisted.
 * Each step is do -> observe -> name where the Preview can observe the "do":
 * - **findings**: the diagnostics of a stored draft, located by `getSourcePath`, and the raw-slot placement;
 * - **opening a copy**: `createWidgetDocument` keeps the source it is given, so the host hands over a copy;
 * - **the plan and its `test` guards**: the application's steps are patches that start with `test` operations;
 * - **`expectedRevision`**: another editor saves, the app's next step is refused with `document-revision-conflict`, and the
 *   app re-reads and plans again;
 * - **all-or-nothing validity**: a draft the application has no rule for stays invalid and Core creates no Runtime for it.
 *
 * Predicates see only State and the Property results the Preview has already evaluated (`inspection-reader.ts`), never a
 * `WidgetDocument` result. The host mirrors its sessions into the drafts' State (`revision`, `appRevision`, `repaired`), so the
 * steps whose "do" is a button are gated on that; the steps whose "do" leaves nothing behind (reading the plan, previewing)
 * are narrated by their reveal.
 */

import type { TutorialScript } from './types'

export const DOCUMENT_REPAIR_TOUR_ID = 'document-repair'

function numberOf(value: unknown): number {
	return typeof value === 'number' ? value : Number.NaN
}

export const documentRepairTourScript: TutorialScript = {
	id: DOCUMENT_REPAIR_TOUR_ID,
	observationTargets: [
		{ widgetId: 'draft-v1', member: { type: 'state', key: 'revision' } },
		{ widgetId: 'draft-v1', member: { type: 'state', key: 'appRevision' } },
		{ widgetId: 'draft-v1', member: { type: 'state', key: 'repaired' } },
		{ widgetId: 'draft-poll', member: { type: 'state', key: 'revision' } },
		{ widgetId: 'draft-poll', member: { type: 'state', key: 'repaired' } },
	],
	steps: [
		{
			id: 'orient',
			title: 'This is the Legacy document repair showcase',
			target: 'repair-desk',
			onEnter: actions => actions.setFocus('desk'),
			stages: [{
				prompt: 'This is a notice-board app at format v3, with four drafts that older versions of the app saved.',
				reveal: 'This is a notice-board app at format v3, with four drafts that older versions saved. The Lab\'s own document is the repair desk (RepairDesk and SavedDraft widgets); each draft keeps the stored document as its config, and the notice board is a second System that lives inside the showcase. Core does not migrate, version, repair or quarantine anything. The repair rules are the application\'s own code, and nothing is saved anywhere: the drafts are fixtures in memory.',
			}],
		},
		{
			id: 'findings',
			title: 'Core says where a stored draft is wrong',
			target: 'repair-draft-v1',
			onEnter: actions => actions.setFocus('draft-v1', { type: 'property', name: 'findings' }),
			stages: [{
				prompt: 'Open the "Stored draft, as Core sees it" details of the draft saved with 1.x, and read its diagnostics and nodes.',
				reveal: 'The findings Property compiles the stored source with the notice board System, and the page lists what Core reported: each diagnostic has a code and the path of its node inside the source, from blueprint.getSourcePath(node), which is also a valid SourcePatch path. The old slot "items" is a raw-slot placement: Core keeps its children as recovered nodes, but they stay invalid. The Banner nodes are unresolved (unknown type), and they keep their id and type as hints; the one without an id has no hint at all.',
			}],
			links: [
				{ id: 'see-findings', label: 'See findings in Selected widget', run: (actions) => {
					actions.setFocus('draft-v1', { type: 'property', name: 'findings' })
					actions.activateTab('widget')
				} },
				{ id: 'open-blueprint', label: 'Open the Blueprint tab', run: actions => actions.activateTab('blueprint') },
			],
		},
		{
			id: 'open-draft',
			title: 'Opening a draft works on a copy',
			target: 'repair-draft-v1',
			onEnter: actions => actions.setFocus('draft-v1', { type: 'state', name: 'revision' }),
			stages: [{
				prompt: 'Press "Open in the app" on the draft saved with 1.x.',
				isComplete: reader => numberOf(reader.readState('draft-v1', 'revision')) >= 0,
				reveal: 'The app called createWidgetDocument with a structuredClone of the stored source: the document is at revision 0, and the page says the stored draft is untouched. Core keeps the source it is given by reference and shares untouched parts with every later revision, so a host that wants its stored copy unchanged hands over a copy. The draft\'s State revision, appRevision and repaired mirror the session: Selected widget and Runtime show them.',
			}],
			links: [
				{ id: 'see-session-state', label: 'See the draft State in Selected widget', run: (actions) => {
					actions.setFocus('draft-v1', { type: 'state', name: 'revision' })
					actions.activateTab('widget')
				} },
			],
		},
		{
			id: 'plan',
			title: 'The plan is the application\'s policy',
			target: 'repair-plan',
			onEnter: actions => actions.setFocus('draft-v1', { type: 'property', name: 'plan' }),
			stages: [{
				prompt: 'Read the plan in the editing session, and open "Show the patch" on a step.',
				reveal: 'The plan is an ordered list of steps, computed by planRepair from the document\'s current snapshot and the version the draft was saved with. Core knows nothing about versions: which patch repairs which legacy shape is the application\'s decision. Every step is a SourcePatch whose first operations are test guards for the value the step was planned against, so a step fails as a whole, with test-failed, if the document is no longer what it expected. The first step moves the slot "items" to "notices"; the last replaces a whole array element, the repair floor for a node that has no id.',
			}],
			links: [
				{ id: 'see-plan', label: 'See plan in Selected widget', run: (actions) => {
					actions.setFocus('draft-v1', { type: 'property', name: 'plan' })
					actions.activateTab('widget')
				} },
			],
		},
		{
			id: 'first-step',
			title: 'One step is one patch',
			target: 'repair-result',
			onEnter: actions => actions.setFocus('draft-v1', { type: 'state', name: 'revision' }),
			stages: [{
				prompt: 'Press "Apply next step" once.',
				isComplete: reader => numberOf(reader.readState('draft-v1', 'revision')) >= 1,
				reveal: 'The app called applyPatch(step.patch, { expectedRevision: 0 }) and Core answered { ok: true, changed: true }: revision 1. The document listener, which hears every commit as (snapshot, { previous, patch }), logged it with its number of operations. The app then read the new snapshot and planned again, so the diagnostics and the plan changed: the slot is "notices" now and the plan has one step fewer. Patches are copy-on-write, so the stored draft is still what it was.',
			}],
		},
		{
			id: 'other-editor',
			title: 'Someone else saves first',
			target: 'repair-log',
			onEnter: actions => actions.setFocus('draft-v1', { type: 'state', name: 'appRevision' }),
			stages: [{
				prompt: 'Press "Another editor saves".',
				isComplete: reader => numberOf(reader.readState('draft-v1', 'revision')) > numberOf(reader.readState('draft-v1', 'appRevision')) && numberOf(reader.readState('draft-v1', 'appRevision')) >= 1,
				reveal: 'A second writer applied a small valid edit (the board title) to the same document, without an expected revision. The document moved to a new revision and the log says who saved it, but the app did not read it: State appRevision is still the revision the app planned from, so it is now behind revision.',
			}],
		},
		{
			id: 'conflict',
			title: 'A stale revision is refused',
			target: 'repair-result',
			onEnter: actions => actions.setFocus('draft-v1', { type: 'state', name: 'appRevision' }),
			stages: [{
				prompt: 'Now press "Apply next step".',
				reveal: 'The app sent its step with expectedRevision set to the revision it planned from, and Core refused it before evaluating any operation: document-revision-conflict, carrying expectedRevision and actualRevision. Nothing was applied, so the document did not change. The page\'s one alert explains it, and the result shows the failure code. This is how a host avoids overwriting an edit it has not seen: the revision check is the application\'s to supply, and Core enforces it.',
			}],
		},
		{
			id: 're-plan',
			title: 'Re-read, then plan again',
			target: 'repair-plan',
			onEnter: actions => actions.setFocus('draft-v1', { type: 'state', name: 'appRevision' }),
			stages: [{
				prompt: 'Press "Re-read and re-plan".',
				isComplete: reader => numberOf(reader.readState('draft-v1', 'revision')) >= 2 && numberOf(reader.readState('draft-v1', 'appRevision')) === numberOf(reader.readState('draft-v1', 'revision')),
				reveal: 'The app read the current snapshot and ran planRepair on it again. Because the plan is a pure function of the source, it did not need to know what the other editor changed: the steps that still apply are the same, and the next patch carries the new revision. The stale-revision notice is gone, and the next step is accepted.',
			}],
		},
		{
			id: 'finish-repair',
			title: 'Apply the rest of the plan',
			target: 'repair-draft-v1',
			onEnter: actions => actions.setFocus('draft-v1', { type: 'state', name: 'repaired' }),
			stages: [{
				prompt: 'Keep pressing "Apply next step" until the document is valid.',
				isComplete: reader => reader.readState('draft-v1', 'repaired') === true,
				reveal: 'The last step replaced the notice that had no id with a complete one, and the diagnostics list is empty: the Blueprint is valid. Only a valid Blueprint has createRuntime, so only now can the app create a Runtime for it.',
			}],
		},
		{
			id: 'preview',
			title: 'Preview and export the repaired board',
			target: 'repair-preview',
			onEnter: actions => actions.setFocus('draft-v1', { type: 'state', name: 'repaired' }),
			stages: [{
				prompt: 'Press "Preview the repaired board", then "Export".',
				reveal: 'Preview created a Runtime of the notice board System from the valid Blueprint and rendered it with plain Vue components in a nested widget-vue root. Export shows the repaired JSON text: the slot is "notices", the type is "Notice", the style is kept in meta, the repeated id has a new one. Nothing was saved: a real application would write the exported text to its own storage, and Core has no part in that.',
			}],
		},
		{
			id: 'no-rule',
			title: 'No rule, no Runtime',
			target: 'repair-draft-poll',
			onEnter: actions => actions.setFocus('draft-poll', { type: 'state', name: 'repaired' }),
			stages: [{
				prompt: 'Open the draft "Open-day poll" and apply its one step.',
				isComplete: reader => numberOf(reader.readState('draft-poll', 'revision')) >= 1,
				reveal: 'This draft holds a Poll widget that the application knows no rule for, so its plan has only the date step and the document stays invalid: the diagnostics list still has unknown-widget-type, and no preview is offered. Validity is all-or-nothing: Core creates no Runtime for an invalid document, runs no valid part of it and quarantines nothing. What to do with a draft nobody can repair is the application\'s decision.',
			}],
			links: [
				{ id: 'see-poll-findings', label: 'See findings in Selected widget', run: (actions) => {
					actions.setFocus('draft-poll', { type: 'property', name: 'findings' })
					actions.activateTab('widget')
				} },
			],
		},
		{
			id: 'map-the-views',
			title: 'Map the views',
			target: null,
			stages: [{
				prompt: 'Each of these views is a real navigation shortcut — try one.',
				reveal: 'Blueprint = the repair desk\'s own widgets and diagnostics, not the notice board\'s · Selected widget = a draft\'s Properties findings and plan, and the State that mirrors the session · Runtime = every draft\'s State and Properties · Dependencies = this showcase has none between widgets: each draft is independent · Implementation = the plan, the host\'s session code and the notice board plugins behind these widgets.',
			}],
			links: [
				{ id: 'view-blueprint', label: 'Blueprint', run: actions => actions.activateTab('blueprint') },
				{ id: 'view-widget-tab', label: 'Selected widget', run: actions => actions.activateTab('widget') },
				{ id: 'view-runtime', label: 'Runtime', run: actions => actions.activateTab('runtime') },
				{ id: 'view-dependencies', label: 'Dependencies', run: actions => actions.activateTab('dependencies') },
				{ id: 'view-implementation', label: 'Implementation', run: actions => actions.openImplementation() },
			],
		},
		{
			id: 'hand-back',
			title: 'Try it yourself',
			target: null,
			finishLabel: 'Finish',
			stages: [{
				prompt: 'You have seen diagnostics located in a stored document, a repair plan written by the application, patches guarded by test operations, a stale revision refused by Core and a draft that never gets a Runtime.',
				reveal: 'Edit the JSON (change a draft\'s savedWith, or its stored source) and press Apply, load "Draft with mistakes" to see config diagnostics in the desk itself, or open the Implementation of SavedDraft to read planRepair and the session code.',
			}],
		},
	],
}
