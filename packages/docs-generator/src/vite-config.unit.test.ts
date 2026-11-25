/**
 * How a Vite or Vitest config loads `widgetDocs`. Vite bundles a config file's relative imports and externalizes its
 * bare ones, which Node then loads itself: by package name Node loads the built `dist/vite.mjs` (a consumer, the Lab),
 * by relative path the plugin's TypeScript sources are bundled with the config (this package's own test configs).
 * Both find their worker and Core. The package-name test needs `pnpm build` first.
 */

import type { WidgetDocs } from './docs-types'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, loadConfigFromFile } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const scratch = mkdtempSync(join(tmpdir(), 'widget-docs-config-file-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const systems = {
	survey: { module: resolve(packageRoot, 'fixtures/survey-system.ts'), export: 'surveySystem', tsconfig: resolve(packageRoot, 'tsconfig.json') },
}

/** A config file that imports `widgetDocs` from `specifier`. No other import: the scratch directory has no `node_modules`. */
function configFile(directory: string, specifier: string): string {
	const file = join(directory, 'vite.config.ts')
	writeFileSync(file, [
		`import { widgetDocs } from '${specifier}'`,
		'',
		`export default { plugins: [widgetDocs({ systems: ${JSON.stringify(systems)}, cacheDir: false })] }`,
		'',
	].join('\n'))
	return file
}

describe('widgetDocs from a config file', () => {
	it('loads through Vite\'s config loader by relative path, and serves the docs with the runtime cross-check', async () => {
		const directory = mkdtempSync(join(scratch, 'relative-'))
		const specifier = relative(directory, join(here, 'vite'))
			.replaceAll('\\', '/')
		expect(specifier.startsWith('../'))
			.toBe(true)
		const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile(directory, specifier), directory, 'silent')
		const plugins = (loaded?.config.plugins ?? []).flat()
		expect(plugins.map(plugin => (plugin as { name?: string }).name))
			.toEqual(['widget-docs'])

		// The bundled plugin still finds its worker (`import.meta.url` is the source file's) and Core.
		const server = await createServer({ configFile: false, root: packageRoot, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, plugins })
		try {
			const module = await server.ssrLoadModule('virtual:widget-docs/survey') as { default: WidgetDocs }
			expect(module.default.plugins.Rating!.state!.value!.authorWritable)
				.toBe(true)
		}
		finally {
			await server.close()
		}
	}, 120_000)

	it('loads by package name from the built package, whose worker and Core serve the docs with the runtime cross-check', async () => {
		const directory = mkdtempSync(join(scratch, 'package-name-'))
		mkdirSync(join(directory, 'node_modules/@deviltea'), { recursive: true })
		symlinkSync(packageRoot, join(directory, 'node_modules/@deviltea/widget-docs-generator'), 'dir')
		// An ES module project, like the Lab: Vite loads a CommonJS config's externals with `require`, and the package is ESM only.
		writeFileSync(join(directory, 'package.json'), '{ "type": "module" }\n')
		const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile(directory, '@deviltea/widget-docs-generator/vite'), directory, 'silent')
		const plugins = (loaded?.config.plugins ?? []).flat()
		expect(plugins.map(plugin => (plugin as { name?: string }).name))
			.toEqual(['widget-docs'])

		const server = await createServer({ configFile: false, root: packageRoot, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, plugins })
		try {
			const module = await server.ssrLoadModule('virtual:widget-docs/survey') as { default: WidgetDocs }
			// `authorWritable` and the prose only come from the runtime worker (`dist/runtime-worker.mjs`).
			expect(module.default.plugins.Rating!.state!.value!.authorWritable)
				.toBe(true)
			expect(module.default.plugins.Rating!.summary)
				.not
				.toBe('')
		}
		finally {
			await server.close()
		}
	}, 120_000)
})
