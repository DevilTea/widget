/**
 * Sandbox curated Implementation-explorer registry (issue #25 P3 Scope A). Sandbox is the Lab's
 * default showcase and Inspect already works there (issue #25 P2 merge-gate blocker 2), so the
 * Implementation explorer curates it too rather than treating it as a lesser fixture. Both the plugin
 * and renderer sides live in one file each (`plugins.ts` / `renderers.ts`) — every entry below points
 * at the same two files; Vite's `?raw` dynamic import is deduped per specifier, so this never re-fetches
 * either file's text more than once regardless of how many widget types reference it.
 */

import type { SourcesRegistry } from '../implementation/types'

const PLUGINS_PATH = 'apps/widget-lab/src/sandbox/plugins.ts'
const RENDERERS_PATH = 'apps/widget-lab/src/sandbox/renderers.ts'

function loadPlugins(): Promise<string> {
	return import('./plugins.ts?raw').then(module => module.default)
}

function loadRenderers(): Promise<string> {
	return import('./renderers.ts?raw').then(module => module.default)
}

export const sandboxSources: SourcesRegistry = {
	Text: {
		files: [
			{ kind: 'plugin', title: 'plugins.ts', path: PLUGINS_PATH, load: loadPlugins },
			{ kind: 'renderer', title: 'renderers.ts', path: RENDERERS_PATH, load: loadRenderers },
		],
	},
	Counter: {
		files: [
			{ kind: 'plugin', title: 'plugins.ts', path: PLUGINS_PATH, load: loadPlugins },
			{ kind: 'renderer', title: 'renderers.ts', path: RENDERERS_PATH, load: loadRenderers },
		],
	},
	Section: {
		files: [
			{ kind: 'plugin', title: 'plugins.ts', path: PLUGINS_PATH, load: loadPlugins },
			{ kind: 'renderer', title: 'renderers.ts', path: RENDERERS_PATH, load: loadRenderers },
		],
	},
	Stack: {
		files: [
			{ kind: 'plugin', title: 'plugins.ts', path: PLUGINS_PATH, load: loadPlugins },
			{ kind: 'renderer', title: 'renderers.ts', path: RENDERERS_PATH, load: loadRenderers },
		],
	},
	Summary: {
		files: [
			{ kind: 'plugin', title: 'plugins.ts', path: PLUGINS_PATH, load: loadPlugins },
			{ kind: 'renderer', title: 'renderers.ts', path: RENDERERS_PATH, load: loadRenderers },
		],
	},
}
