/**
 * Document-repair curated Implementation-explorer registry: one entry per `repairPlugins` type (`./plugins/index.ts`) with the
 * plugin file, the Vue renderer file(s) and the files that carry the interesting part: `domain.ts` (`planRepair`, the
 * application's repair policy), `plugins/findings.ts` (compiling a draft with the inner notice board system),
 * `renderers/repair-host.ts` (the editing session: `WidgetDocument`, `applyPatch`, `expectedRevision`, the listener) and
 * `board/` (the inner system the drafts are compiled with). Every file is a lazy `?raw` thunk (see
 * `../../showcase-host/sources.ts`), so this module stays small and pulls no source text into the shell's initial chunks.
 */

import type { SourcesRegistry } from '../../showcase-host'

const ROOT = 'apps/lab/src/showcases/document-repair'

const domain = {
	kind: 'domain',
	title: 'domain.ts',
	path: `${ROOT}/domain.ts`,
	load: () => import('./domain.ts?raw').then(module => module.default),
} as const

const findings = {
	kind: 'domain',
	title: 'findings.ts',
	path: `${ROOT}/plugins/findings.ts`,
	load: () => import('./plugins/findings.ts?raw').then(module => module.default),
} as const

const host = {
	kind: 'renderer',
	title: 'repair-host.ts',
	path: `${ROOT}/renderers/repair-host.ts`,
	load: () => import('./renderers/repair-host.ts?raw').then(module => module.default),
} as const

const boardPlugins = {
	kind: 'domain',
	title: 'board/plugins.ts',
	path: `${ROOT}/board/plugins.ts`,
	load: () => import('./board/plugins.ts?raw').then(module => module.default),
} as const

const boardConfig = {
	kind: 'domain',
	title: 'board/config.ts',
	path: `${ROOT}/board/config.ts`,
	load: () => import('./board/config.ts?raw').then(module => module.default),
} as const

export const repairSources: SourcesRegistry = {
	RepairDesk: {
		files: [
			{ kind: 'plugin', title: 'repair-desk.ts', path: `${ROOT}/plugins/repair-desk.ts`, load: () => import('./plugins/repair-desk.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'RepairDeskRenderer.vue', path: `${ROOT}/renderers/RepairDeskRenderer.vue`, load: () => import('./renderers/RepairDeskRenderer.vue?raw').then(m => m.default) },
			host,
			{ kind: 'renderer', title: 'index.ts', path: `${ROOT}/renderers/index.ts`, load: () => import('./renderers/index.ts?raw').then(m => m.default) },
			domain,
		],
	},
	SavedDraft: {
		files: [
			{ kind: 'plugin', title: 'saved-draft.ts', path: `${ROOT}/plugins/saved-draft.ts`, load: () => import('./plugins/saved-draft.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'SavedDraftRenderer.vue', path: `${ROOT}/renderers/SavedDraftRenderer.vue`, load: () => import('./renderers/SavedDraftRenderer.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'DraftSession.vue', path: `${ROOT}/renderers/DraftSession.vue`, load: () => import('./renderers/DraftSession.vue?raw').then(m => m.default) },
			host,
			findings,
			domain,
			boardPlugins,
			boardConfig,
		],
	},
}
