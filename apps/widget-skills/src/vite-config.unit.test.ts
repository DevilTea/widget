/**
 * How a Vite or Vitest config loads `widgetDocs`. Vite bundles a config file's relative imports and externalizes its
 * bare ones, which Node then loads itself: by relative path the plugin's TypeScript sources are bundled with the
 * config, by package name Node gets `src/vite.ts` and fails on its extensionless relative imports. The supported
 * spelling is the relative path; AGENTS.md and README.md say so.
 */

import type { WidgetDocs } from './docs-types'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

	it('fails by package name (documented as unsupported)', async () => {
		const directory = mkdtempSync(join(scratch, 'package-name-'))
		mkdirSync(join(directory, 'node_modules/@deviltea'), { recursive: true })
		symlinkSync(packageRoot, join(directory, 'node_modules/@deviltea/widget-skills'), 'dir')
		await expect(loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile(directory, '@deviltea/widget-skills/vite'), directory, 'silent'))
			.rejects
			.toThrow(/Cannot find module '.*\/src\/check'/)

		// If this starts to work, update the docs (and this test) rather than leaving the limitation documented.
		for (const document of ['AGENTS.md', 'README.md']) {
			expect(readFileSync(join(packageRoot, document), 'utf8'))
				.toContain('not by its package name')
		}
	}, 120_000)
})
