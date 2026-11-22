/**
 * Renderer-packs curated Implementation-explorer registry: one entry per `packsPlugins` type (`./plugins/index.ts`) with the
 * plugin file, BOTH renderer files (the hand-written one and the Nuxt UI one: the same widget, drawn twice) and the files that
 * carry the interesting part: `domain.ts` (the rules every pack shares), `plugins/structure.ts` (widgets that name other widgets)
 * and, for the page, the host and the Nuxt UI pack's nested app. Every file is a lazy `?raw` thunk (see
 * `../../showcase-host/sources.ts`), so this module stays small and pulls no source text into the shell's initial chunks.
 */

import type { CuratedSourceFile, SourcesRegistry } from '../../showcase-host'

const ROOT = 'apps/lab/src/showcases/renderer-packs'

const domain: CuratedSourceFile = {
	kind: 'domain',
	title: 'domain.ts',
	path: `${ROOT}/domain.ts`,
	load: () => import('./domain.ts?raw').then(module => module.default),
}

const structure: CuratedSourceFile = {
	kind: 'domain',
	title: 'structure.ts',
	path: `${ROOT}/plugins/structure.ts`,
	load: () => import('./plugins/structure.ts?raw').then(module => module.default),
}

const host: CuratedSourceFile = {
	kind: 'renderer',
	title: 'packs-host.ts',
	path: `${ROOT}/renderers/packs-host.ts`,
	load: () => import('./renderers/packs-host.ts?raw').then(module => module.default),
}

const nestedApp: CuratedSourceFile = {
	kind: 'renderer',
	title: 'nested-app.ts',
	path: `${ROOT}/renderers/nuxt-ui/nested-app.ts`,
	load: () => import('./renderers/nuxt-ui/nested-app.ts?raw').then(module => module.default),
}

const page: CuratedSourceFile = {
	kind: 'renderer',
	title: 'page.ts',
	path: `${ROOT}/renderers/page.ts`,
	load: () => import('./renderers/page.ts?raw').then(module => module.default),
}

const handIndex: CuratedSourceFile = {
	kind: 'renderer',
	title: 'handwritten/index.ts',
	path: `${ROOT}/renderers/handwritten/index.ts`,
	load: () => import('./renderers/handwritten/index.ts?raw').then(module => module.default),
}

const nuiIndex: CuratedSourceFile = {
	kind: 'renderer',
	title: 'nuxt-ui/index.ts',
	path: `${ROOT}/renderers/nuxt-ui/index.ts`,
	load: () => import('./renderers/nuxt-ui/index.ts?raw').then(module => module.default),
}

export const packsSources: SourcesRegistry = {
	SettingsPage: {
		files: [
			{ kind: 'plugin', title: 'settings-page.ts', path: `${ROOT}/plugins/settings-page.ts`, load: () => import('./plugins/settings-page.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'HandSettingsPage.vue', path: `${ROOT}/renderers/handwritten/HandSettingsPage.vue`, load: () => import('./renderers/handwritten/HandSettingsPage.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'NuiSettingsPage.vue', path: `${ROOT}/renderers/nuxt-ui/NuiSettingsPage.vue`, load: () => import('./renderers/nuxt-ui/NuiSettingsPage.vue?raw').then(m => m.default) },
			page,
			host,
			nestedApp,
			handIndex,
			nuiIndex,
			structure,
			domain,
		],
	},
	Appearance: {
		files: [
			{ kind: 'plugin', title: 'appearance.ts', path: `${ROOT}/plugins/appearance.ts`, load: () => import('./plugins/appearance.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'HandAppearance.vue', path: `${ROOT}/renderers/handwritten/HandAppearance.vue`, load: () => import('./renderers/handwritten/HandAppearance.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'NuiAppearance.vue', path: `${ROOT}/renderers/nuxt-ui/NuiAppearance.vue`, load: () => import('./renderers/nuxt-ui/NuiAppearance.vue?raw').then(m => m.default) },
			domain,
		],
	},
	Notifier: {
		files: [
			{ kind: 'plugin', title: 'notifier.ts', path: `${ROOT}/plugins/notifier.ts`, load: () => import('./plugins/notifier.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'HandNotifier.vue', path: `${ROOT}/renderers/handwritten/HandNotifier.vue`, load: () => import('./renderers/handwritten/HandNotifier.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'NuiNotifier.vue', path: `${ROOT}/renderers/nuxt-ui/NuiNotifier.vue`, load: () => import('./renderers/nuxt-ui/NuiNotifier.vue?raw').then(m => m.default) },
			domain,
		],
	},
	Section: {
		files: [
			{ kind: 'plugin', title: 'section.ts', path: `${ROOT}/plugins/section.ts`, load: () => import('./plugins/section.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'HandSection.vue', path: `${ROOT}/renderers/handwritten/HandSection.vue`, load: () => import('./renderers/handwritten/HandSection.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'NuiSection.vue', path: `${ROOT}/renderers/nuxt-ui/NuiSection.vue`, load: () => import('./renderers/nuxt-ui/NuiSection.vue?raw').then(m => m.default) },
		],
	},
	TextField: {
		files: [
			{ kind: 'plugin', title: 'text-field.ts', path: `${ROOT}/plugins/text-field.ts`, load: () => import('./plugins/text-field.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'HandTextField.vue', path: `${ROOT}/renderers/handwritten/HandTextField.vue`, load: () => import('./renderers/handwritten/HandTextField.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'NuiTextField.vue', path: `${ROOT}/renderers/nuxt-ui/NuiTextField.vue`, load: () => import('./renderers/nuxt-ui/NuiTextField.vue?raw').then(m => m.default) },
			structure,
			domain,
		],
	},
	Toggle: {
		files: [
			{ kind: 'plugin', title: 'toggle.ts', path: `${ROOT}/plugins/toggle.ts`, load: () => import('./plugins/toggle.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'HandToggle.vue', path: `${ROOT}/renderers/handwritten/HandToggle.vue`, load: () => import('./renderers/handwritten/HandToggle.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'NuiToggle.vue', path: `${ROOT}/renderers/nuxt-ui/NuiToggle.vue`, load: () => import('./renderers/nuxt-ui/NuiToggle.vue?raw').then(m => m.default) },
			structure,
		],
	},
	Choice: {
		files: [
			{ kind: 'plugin', title: 'choice.ts', path: `${ROOT}/plugins/choice.ts`, load: () => import('./plugins/choice.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'HandChoice.vue', path: `${ROOT}/renderers/handwritten/HandChoice.vue`, load: () => import('./renderers/handwritten/HandChoice.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'NuiChoice.vue', path: `${ROOT}/renderers/nuxt-ui/NuiChoice.vue`, load: () => import('./renderers/nuxt-ui/NuiChoice.vue?raw').then(m => m.default) },
			structure,
		],
	},
	DangerAction: {
		files: [
			{ kind: 'plugin', title: 'danger-action.ts', path: `${ROOT}/plugins/danger-action.ts`, load: () => import('./plugins/danger-action.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'HandDangerAction.vue', path: `${ROOT}/renderers/handwritten/HandDangerAction.vue`, load: () => import('./renderers/handwritten/HandDangerAction.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'NuiDangerAction.vue', path: `${ROOT}/renderers/nuxt-ui/NuiDangerAction.vue`, load: () => import('./renderers/nuxt-ui/NuiDangerAction.vue?raw').then(m => m.default) },
			host,
			structure,
		],
	},
}
