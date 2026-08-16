/**
 * Sales Pipeline CRM curated Implementation-explorer registry (issue #25 P3 Scope A). One entry per
 * `crmPlugins` type (`./plugins/index.ts`). `domain.ts` is curated only for the three CRM-domain
 * semantic widgets (`DealStore`/`DealQuery`/`DealStageForm`, per the issue's own deliverable notes
 * "crm domain.ts for store/query plugins") whose behavior genuinely depends on it (`Deal`/`DealStage`,
 * `stageProbability`, the seed dataset shape); the reusable-style primitives (`structural.ts`/
 * `inputs.ts`/`read-models.ts`/`actions.ts`) only import `domain.ts` for the generic `isPlainObject`
 * guard (and, for the read-model primitives, the cross-showcase `PropertySourceConfig` convention
 * type), neither of which explains those widgets' own behavior.
 */

import type { SourcesRegistry } from '../../implementation/types'

const DOMAIN_PATH = 'apps/widget-lab/src/showcases/crm/domain.ts'

function loadDomain(): Promise<string> {
	return import('./domain.ts?raw').then(module => module.default)
}

function loadStructural(): Promise<string> {
	return import('./plugins/structural.ts?raw').then(module => module.default)
}

function loadInputs(): Promise<string> {
	return import('./plugins/inputs.ts?raw').then(module => module.default)
}

function loadReadModels(): Promise<string> {
	return import('./plugins/read-models.ts?raw').then(module => module.default)
}

function loadActions(): Promise<string> {
	return import('./plugins/actions.ts?raw').then(module => module.default)
}

export const crmSources: SourcesRegistry = {
	AppShell: {
		files: [
			{ kind: 'plugin', title: 'structural.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/structural.ts', load: loadStructural },
			{ kind: 'renderer', title: 'AppShellRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/AppShellRenderer.vue', load: () => import('./renderers/AppShellRenderer.vue?raw').then(m => m.default) },
		],
	},
	Toolbar: {
		files: [
			{ kind: 'plugin', title: 'structural.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/structural.ts', load: loadStructural },
			{ kind: 'renderer', title: 'ToolbarRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/ToolbarRenderer.vue', load: () => import('./renderers/ToolbarRenderer.vue?raw').then(m => m.default) },
		],
	},
	Card: {
		files: [
			{ kind: 'plugin', title: 'structural.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/structural.ts', load: loadStructural },
			{ kind: 'renderer', title: 'CardRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/CardRenderer.vue', load: () => import('./renderers/CardRenderer.vue?raw').then(m => m.default) },
		],
	},
	TextInput: {
		files: [
			{ kind: 'plugin', title: 'inputs.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/inputs.ts', load: loadInputs },
			{ kind: 'renderer', title: 'TextInputRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/TextInputRenderer.vue', load: () => import('./renderers/TextInputRenderer.vue?raw').then(m => m.default) },
		],
	},
	SelectInput: {
		files: [
			{ kind: 'plugin', title: 'inputs.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/inputs.ts', load: loadInputs },
			{ kind: 'renderer', title: 'SelectInputRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/SelectInputRenderer.vue', load: () => import('./renderers/SelectInputRenderer.vue?raw').then(m => m.default) },
		],
	},
	MetricCard: {
		files: [
			{ kind: 'plugin', title: 'read-models.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/read-models.ts', load: loadReadModels },
			{ kind: 'renderer', title: 'MetricCardRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/MetricCardRenderer.vue', load: () => import('./renderers/MetricCardRenderer.vue?raw').then(m => m.default) },
		],
	},
	Table: {
		files: [
			{ kind: 'plugin', title: 'read-models.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/read-models.ts', load: loadReadModels },
			{ kind: 'renderer', title: 'TableRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/TableRenderer.vue', load: () => import('./renderers/TableRenderer.vue?raw').then(m => m.default) },
		],
	},
	DetailPanel: {
		files: [
			{ kind: 'plugin', title: 'read-models.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/read-models.ts', load: loadReadModels },
			{ kind: 'renderer', title: 'DetailPanelRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/DetailPanelRenderer.vue', load: () => import('./renderers/DetailPanelRenderer.vue?raw').then(m => m.default) },
		],
	},
	BarChart: {
		files: [
			{ kind: 'plugin', title: 'read-models.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/read-models.ts', load: loadReadModels },
			{ kind: 'renderer', title: 'BarChartRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/BarChartRenderer.vue', load: () => import('./renderers/BarChartRenderer.vue?raw').then(m => m.default) },
		],
	},
	Button: {
		files: [
			{ kind: 'plugin', title: 'actions.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/actions.ts', load: loadActions },
			{ kind: 'renderer', title: 'ButtonRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/ButtonRenderer.vue', load: () => import('./renderers/ButtonRenderer.vue?raw').then(m => m.default) },
		],
	},
	Modal: {
		files: [
			{ kind: 'plugin', title: 'actions.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/actions.ts', load: loadActions },
			{ kind: 'renderer', title: 'ModalRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/ModalRenderer.vue', load: () => import('./renderers/ModalRenderer.vue?raw').then(m => m.default) },
		],
	},
	DealStore: {
		files: [
			{ kind: 'plugin', title: 'deal-store.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/deal-store.ts', load: () => import('./plugins/deal-store.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'DealStoreRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/DealStoreRenderer.vue', load: () => import('./renderers/DealStoreRenderer.vue?raw').then(m => m.default) },
			{ kind: 'domain', title: 'domain.ts', path: DOMAIN_PATH, load: loadDomain },
		],
	},
	DealQuery: {
		files: [
			{ kind: 'plugin', title: 'deal-query.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/deal-query.ts', load: () => import('./plugins/deal-query.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'DealQueryRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/DealQueryRenderer.vue', load: () => import('./renderers/DealQueryRenderer.vue?raw').then(m => m.default) },
			{ kind: 'domain', title: 'domain.ts', path: DOMAIN_PATH, load: loadDomain },
		],
	},
	DealStageForm: {
		files: [
			{ kind: 'plugin', title: 'deal-stage-form.ts', path: 'apps/widget-lab/src/showcases/crm/plugins/deal-stage-form.ts', load: () => import('./plugins/deal-stage-form.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'DealStageFormRenderer.vue', path: 'apps/widget-lab/src/showcases/crm/renderers/DealStageFormRenderer.vue', load: () => import('./renderers/DealStageFormRenderer.vue?raw').then(m => m.default) },
			{ kind: 'domain', title: 'domain.ts', path: DOMAIN_PATH, load: loadDomain },
		],
	},
}
