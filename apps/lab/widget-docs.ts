import { fileURLToPath } from 'node:url'
// A relative path, not `@deviltea/widget-skills/vite`: a Vite config bundles its relative imports, while a bare specifier
// is left to Node, which cannot load the plugin's TypeScript sources (apps/widget-skills/AGENTS.md, "The Vite plugin").
import { widgetDocs } from '../widget-skills/src/vite'

/** Showcase id (as in `src/showcases/registry.ts`) to the module and export of its System. */
const SYSTEMS = {
	'survey': ['src/showcases/survey/system.ts', 'surveySystem'],
	'trip-budget': ['src/showcases/trip-budget/system.ts', 'tripBudgetSystem'],
	'quote-rules': ['src/showcases/quote-rules/system.ts', 'quoteSystem'],
	'onboarding': ['src/showcases/onboarding/system.ts', 'onboardingSystem'],
	'document-repair': ['src/showcases/document-repair/system.ts', 'repairSystem'],
	'renderer-packs': ['src/showcases/renderer-packs/system.ts', 'packsSystem'],
	'sandbox': ['src/sandbox/system.ts', 'sandboxSystem'],
} as const

function labPath(path: string): string {
	return fileURLToPath(new URL(path, import.meta.url))
}

/**
 * The one place the Lab configures `widgetDocs()`: each showcase's plugin documentation, generated from the JSDoc of its
 * plugins' `Interfaces` types, is served as `virtual:widget-docs/<showcase id>` (Core 0.3 carries no descriptions at run
 * time). `vite.config.ts`, `vitest.config.ts` and the repository's root `vitest.config.ts` (project `lab`) all call it. The
 * paths are absolute, so the result does not depend on which Vite root loads the plugin, and the disk cache always lives
 * in this app's `node_modules/.cache/widget-docs`. Generating imports each System module (its top-level code runs).
 */
export function labWidgetDocs() {
	const tsconfig = labPath('./tsconfig.app.json')
	return widgetDocs({
		systems: Object.fromEntries(Object.entries(SYSTEMS)
			.map(([name, [module, exportName]]) => [name, { module: labPath(`./${module}`), export: exportName, tsconfig }])),
		cacheDir: labPath('./node_modules/.cache/widget-docs'),
	})
}
