/**
 * The expert views of the Tools tab (Lab UX phase 3B, design "information architecture"). The tool group on the left has
 * three tabs, Edit, Explain and Tools; Tools is a menu of these views, and each one opens on request as its own closable,
 * named tab in a separate Dockview group beside the Preview (the Tools group), never inside the Edit/Explain group.
 *
 * The id of a tool is its Dockview panel id. No Vue import here: `Workbench.vue` (the Dockview side), the Tools menu and the
 * tutorial (`tutorial/types.ts` mirrors the ids) read it.
 */

/** In the order the Tools menu lists them. */
export const TOOL_IDS = ['blueprint', 'runtime', 'events', 'dependencies', 'widget', 'document-tools', 'implementation'] as const

export type ToolId = typeof TOOL_IDS[number]

const TOOL_ID_SET: ReadonlySet<string> = new Set(TOOL_IDS)

export function isToolId(id: string): id is ToolId {
	return TOOL_ID_SET.has(id)
}

/** The Dockview component each tool's panel is made of (the panel id is the tool id). */
export const TOOL_COMPONENTS: Readonly<Record<ToolId, string>> = {
	'blueprint': 'blueprint',
	'runtime': 'runtime',
	'events': 'events',
	'dependencies': 'dependencies',
	'widget': 'widget',
	'document-tools': 'documentTools',
	'implementation': 'implementation',
}

/**
 * The tab title (an English message id; Widget words stay English) and the menu's one-line description of each tool.
 * Implementation names its widget in its tab ("Implementation — sessions (MultipleChoice)"); the panel sets that title itself,
 * because it follows the selection.
 */
export const TOOL_TEXT: Readonly<Record<ToolId, { readonly title: string, readonly menuLabel: string, readonly description: string }>> = {
	'blueprint': {
		title: 'Blueprint tree',
		menuLabel: 'Blueprint tree',
		description: 'What the definition compiled into: every widget, its status and its diagnostics.',
	},
	'runtime': {
		title: 'Runtime tree',
		menuLabel: 'Runtime tree',
		description: 'The running preview: live State, Properties and Methods of every widget.',
	},
	'events': {
		title: 'Events log',
		menuLabel: 'Events log',
		description: 'What the widgets announced while you used the preview, and Method failures.',
	},
	'dependencies': {
		title: 'Dependencies',
		menuLabel: 'Dependency graph and Relations',
		description: 'Which widget reads which, as a list (Relations) or a graph.',
	},
	'widget': {
		title: 'Selected widget',
		menuLabel: 'Selected widget',
		description: 'The selected widget\'s declaration and its live values side by side.',
	},
	'document-tools': {
		title: 'Document Tools',
		menuLabel: 'Document Tools',
		description: 'The last change as a SourcePatch, a conflict check and the separated source, for developers.',
	},
	'implementation': {
		title: 'Implementation',
		menuLabel: 'Implementation',
		description: 'The plugin and renderer code behind the selected widget\'s type.',
	},
}
