/**
 * The "One document, two renderer packs" tour's script (issue #230), authored against the workspace settings page
 * (`showcases/renderer-packs/presets.ts`, preset `packs-default`): the deterministic starting state, like the other tours. Every
 * widget id and member name below is that preset's.
 *
 * It teaches one thing from several sides: **a renderer pack is a host-level choice over one Runtime.** The same Document, the same
 * Runtime and the same State are drawn by hand-written controls or by a component library, one at a time or side by side; switching
 * replaces the controls and keeps every value, because the choice is not widget State and never touches the Runtime. Each step is
 * do -> observe -> name where the Preview can observe the "do":
 * - **State is the shared fact**: a value typed in one pack is the value in the other;
 * - **named providers, not provider shadowing**: fields read the Appearance and a DangerAction calls the Notifier through
 *   `dep.widget(id)` with the id in their own config; Core has no nearest-ancestor lookup;
 * - **a Method that invokes another widget's Method**: `confirm` calls the Notifier's `notify`, writes State and emits `confirmed`;
 * - **overlays are contained**: the confirmation is a modal inside the Preview, so the Lab around it stays usable, and the Nuxt UI
 *   pack's overlays stay inside the pack's own root.
 *
 * Predicates see only State and the Property results the Preview has already evaluated (`inspection-reader.ts`). The pack choice is
 * the host's, not State, so the steps about it are narrated; the others are gated on the State the visitor's action leaves.
 */

import type { TutorialScript } from './types'

export const RENDERER_PACKS_TOUR_ID = 'renderer-packs'

export const rendererPacksTourScript: TutorialScript = {
	id: RENDERER_PACKS_TOUR_ID,
	observationTargets: [
		{ widgetId: 'workspace-name', member: { type: 'state', key: 'value' } },
		{ widgetId: 'appearance', member: { type: 'state', key: 'density' } },
		{ widgetId: 'appearance', member: { type: 'state', key: 'mode' } },
		{ widgetId: 'archive-workspace', member: { type: 'state', key: 'confirming' } },
		{ widgetId: 'notifier', member: { type: 'state', key: 'items' } },
	],
	steps: [
		{
			id: 'orient',
			title: 'This is the renderer packs showcase',
			target: 'packs-settings',
			onEnter: actions => actions.setFocus('settings'),
			stages: [{
				prompt: 'This is a workspace settings page, drawn from one Document by hand-written controls.',
				reveal: 'This is a workspace settings page, drawn from one Document and one Runtime. The widgets are ordinary: a SettingsPage with an Appearance and a Notifier as capability widgets, and Sections of text fields, switches, a choice and two dangerous actions. How they are drawn is a second question, answered by a renderer pack: this one is hand-written Vue components with scoped CSS, and a second pack uses Nuxt UI. Both register a renderer for every plugin type of the same System.',
			}],
		},
		{
			id: 'type',
			title: 'State is written by whichever control you use',
			target: 'packs-workspace-name',
			onEnter: actions => actions.setFocus('workspace-name', { type: 'state', name: 'value' }),
			stages: [{
				prompt: 'Change the text of the "Workspace name" box.',
				isComplete: (reader) => {
					const value = reader.readState('workspace-name', 'value')
					return typeof value === 'string' && value !== 'Harbour Studio'
				},
				reveal: 'The box wrote State value of the TextField. Writing State is always accepted, even for a name that is too long: the Property message says so, in both languages, and every pack shows the same message for the same value. Selected widget and Runtime show the State and the Properties.',
			}],
			links: [
				{ id: 'see-value', label: 'See the State in Selected widget', run: (actions) => {
					actions.setFocus('workspace-name', { type: 'state', name: 'value' })
					actions.openTool('widget')
				} },
			],
		},
		{
			id: 'switch-pack',
			title: 'Switch the renderer pack',
			target: 'packs-chooser',
			stages: [{
				prompt: 'Choose "Nuxt UI" in the renderer pack chooser, then look at the Workspace name box.',
				reveal: 'The same text is in the Nuxt UI input. The chooser is a choice of the host, not widget State: the Runtime tree shows no pack, no Method can change it, and the Runtime was neither disposed nor created again. Switching unmounts one pack\'s renderers and mounts the other\'s over the same State. The Nuxt UI pack runs in a nested Vue app of its own, with its own Nuxt UI instance, so the page does not depend on the frame having one.',
			}],
			links: [
				{ id: 'open-runtime', label: 'Open the Runtime tree', run: actions => actions.openTool('runtime') },
			],
		},
		{
			id: 'density',
			title: 'A provider is named, not found by ancestry',
			target: 'packs-appearance',
			onEnter: actions => actions.setFocus('appearance', { type: 'state', name: 'density' }),
			stages: [{
				prompt: 'Choose "Compact" density in the Appearance panel.',
				isComplete: reader => reader.readState('appearance', 'density') === 'compact',
				reveal: 'Every field became denser, in whichever pack is on screen. The fields did not look the Appearance up: each one names it in its own config (appearance) and declares a dependency with dep.widget(id), so its Property density follows the Appearance\'s State. Core has no nearest-ancestor or provider lookup, so there is no provider shadowing either: a field reads exactly the widget it names. Dependencies, in Tools, lists those reads.',
			}],
			links: [
				{ id: 'see-dependencies', label: 'Open Dependencies', run: (actions) => {
					actions.setFocus('workspace-name', { type: 'property', name: 'density' })
					actions.openTool('dependencies')
				} },
			],
		},
		{
			id: 'mode',
			title: 'The mode is State, the theme is the host\'s',
			target: 'packs-appearance',
			onEnter: actions => actions.setFocus('appearance', { type: 'state', name: 'mode' }),
			stages: [{
				prompt: 'Choose "Dark" as the colour mode.',
				isComplete: reader => reader.readState('appearance', 'mode') === 'dark',
				reveal: 'The page turned dark, whatever the Lab\'s own theme is. State mode is auto, light or dark; "auto" means the host theme, which Core does not know, so the pack resolves it. The hand-written pack changes its own custom properties; the Nuxt UI pack puts a dark class on its own root element and never on the frame document.',
			}],
		},
		{
			id: 'ask',
			title: 'A confirmation is State too',
			target: 'packs-archive-workspace',
			onEnter: actions => actions.setFocus('archive-workspace', { type: 'state', name: 'confirming' }),
			stages: [{
				prompt: 'Press "Archive workspace".',
				isComplete: reader => reader.readState('archive-workspace', 'confirming') === true,
				reveal: 'The button called the Method ask, which wrote State confirming, and the pack drew a modal from that fact: a native dialog in the hand-written pack, a UModal in the Nuxt UI pack. The modal is inside the Preview frame, so the Lab around it stays usable: try the Examples menu, then come back. Keep this dialog open for the next step.',
			}],
		},
		{
			id: 'confirm',
			title: 'A Method that calls another widget\'s Method',
			target: 'packs-notifier',
			onEnter: actions => actions.setFocus('archive-workspace', { type: 'method', name: 'confirm' }),
			stages: [{
				prompt: 'Press "Confirm" in the dialog, and keep the Events log open.',
				isComplete: (reader) => {
					const items = reader.readState('notifier', 'items')
					return Array.isArray(items) && items.length >= 1
				},
				reveal: 'confirm did three things: it invoked the Notifier\'s Method notify through a dependency on the widget its config names (notifier), it closed the question, and it emitted confirmed. The Notifier wrote State and emitted notified. The Events log lists both Events with their payloads, and Relations marks confirm as W and E. The page announces the new warning as its one alert; a notification of any other tone would be its one status.',
			}],
			links: [
				{ id: 'open-events', label: 'Open the Events log', run: actions => actions.openTool('events') },
				{ id: 'see-relations', label: 'Open Dependencies', run: (actions) => {
					actions.setFocus('archive-workspace', { type: 'method', name: 'confirm' })
					actions.openTool('dependencies')
				} },
			],
		},
		{
			id: 'side-by-side',
			title: 'Both packs at once',
			target: 'packs-chooser',
			stages: [{
				prompt: 'Choose "Side by side" and change a field in one pane.',
				reveal: 'Both packs draw the same Runtime next to each other, and the other pane follows at once: State is the only source. The page still has one alert, one status and one open confirmation: the first pane carries the live regions, and a confirmation belongs to the pane whose button asked. Both packs stamp inspect anchors on their renderer roots, so Inspect can select a widget in either.',
			}],
		},
		{
			id: 'map-the-views',
			title: 'Map the views',
			target: null,
			stages: [{
				prompt: 'Each of these views is a real navigation shortcut — try one.',
				reveal: 'Tools, beside the Preview: Blueprint tree = the settings document and its diagnostics · Selected widget = a widget\'s State, Properties and Methods · Runtime tree = every widget\'s State and Properties, and no renderer pack: that is the host\'s · Dependencies = the reads and Method calls between widgets, which are the named providers · Implementation = the plugin and both renderers of a widget type, side by side.',
			}],
			links: [
				{ id: 'view-blueprint', label: 'Blueprint tree', run: actions => actions.openTool('blueprint') },
				{ id: 'view-widget-tab', label: 'Selected widget', run: actions => actions.openTool('widget') },
				{ id: 'view-runtime', label: 'Runtime tree', run: actions => actions.openTool('runtime') },
				{ id: 'view-dependencies', label: 'Dependencies', run: actions => actions.openTool('dependencies') },
				{ id: 'view-implementation', label: 'Implementation', run: actions => actions.openTool('implementation') },
			],
		},
		{
			id: 'hand-back',
			title: 'Try it yourself',
			target: null,
			finishLabel: 'Finish',
			stages: [{
				prompt: 'You have seen one Runtime drawn by two renderer packs, providers that are named instead of found, a Method that calls another widget\'s Method and a confirmation that stays inside the Preview.',
				reveal: 'Edit the JSON (change a field\'s appearance or the Notifier\'s limit) and watch the Preview update, load "Draft with mistakes" to see the structure diagnostics for a name that matches no widget, or open the Implementation of TextField to read its plugin next to both of its renderers.',
			}],
		},
	],
}
