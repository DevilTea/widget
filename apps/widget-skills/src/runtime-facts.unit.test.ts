import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { createDocsCache } from './docs-cache'
import { importRuntimeFacts } from './runtime-facts'

const here = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(here, '../../..')
// Core's sources, as `tsconfig.source.json` maps them: one file serves the type checker and tsx.
const coreSource = resolve(repositoryRoot, 'packages/core/src')
const corePaths = {
	'@deviltea/widget-core': [join(coreSource, 'index.ts')],
	'@deviltea/widget-core/inspection': [join(coreSource, 'inspection/index.ts')],
}

const scratch = mkdtempSync(join(tmpdir(), 'widget-docs-runtime-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A Badge plugin with the given State members, each a number. */
function systemSource(members: readonly string[]): string {
	return [
		'import { createWidgetPlugin, createWidgetSystem } from \'@deviltea/widget-core\'',
		'/** A badge. */',
		'interface BadgeInterfaces {',
		'\tstate: {',
		...members.map(member => `\t\t/** ${member}. */\n\t\t${member}: number`),
		'\t}',
		'}',
		'const Badge = createWidgetPlugin(\'Badge\')',
		'\t.interfaces<BadgeInterfaces>()',
		`\t.state(state => state${members.map(member => `.${member}({ validate: (input): input is number => typeof input === 'number', default: () => 0${member === 'count' ? ', authorWritable: true' : ''} })`)
			.join('')})`,
		'\t.done()',
		'export const system = createWidgetSystem({ plugins: [Badge] as const })',
		'',
	].join('\n')
}

/**
 * A System in the OS temporary directory, where no `node_modules` resolves `@deviltea/widget-core`: only the source
 * tsconfig's `paths` (to Core's sources) do, for the type checker and, through the plugin, for tsx.
 */
function isolatedSystem(): { directory: string, module: string, tsconfig: string, sourceTsconfig: string } {
	const directory = mkdtempSync(join(scratch, 'system-'))
	// The module must load as ESM: tsx cannot import a CommonJS-typed `.ts` file in a namespace.
	writeFileSync(join(directory, 'package.json'), '{ "type": "module" }\n')
	writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({
		compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler', target: 'esnext', skipLibCheck: true, types: [] },
		include: ['./*.ts'],
	}))
	writeFileSync(join(directory, 'tsconfig.source.json'), JSON.stringify({
		compilerOptions: {
			paths: corePaths,
		},
	}))
	writeFileSync(join(directory, 'system.ts'), systemSource(['count']))
	return { directory, module: join(directory, 'system.ts'), tsconfig: join(directory, 'tsconfig.json'), sourceTsconfig: join(directory, 'tsconfig.source.json') }
}

describe('importRuntimeFacts', () => {
	it('resolves the System through the source tsconfig\'s paths, as the type checker does', async () => {
		const system = isolatedSystem()
		const result = await createDocsCache({ cacheDir: null, root: system.directory })
			.load('badge', { module: system.module, export: 'system', tsconfig: system.tsconfig, sourceTsconfig: system.sourceTsconfig })
		// `authorWritable` comes from inspectPlugin: the worker imported the System and Core's inspection entry.
		expect(result.docs.plugins.Badge!.state)
			.toMatchObject({ count: { summary: 'count.', authorWritable: true } })

		// Without the paths, nothing resolves Core from the temporary directory.
		await expect(importRuntimeFacts(system.module, 'system', { tsconfig: system.tsconfig })).rejects.toThrow(/@deviltea\/widget-core/)
	}, 120_000)

	it('sees an edited module on the next call (a fresh worker per call)', async () => {
		const system = isolatedSystem()
		const paths = corePaths
		const before = await importRuntimeFacts(system.module, 'system', { tsconfig: system.tsconfig, paths })
		expect(before.plugins[0]!.state)
			.toEqual([{ name: 'count', authorWritable: true }])

		writeFileSync(system.module, systemSource(['count', 'total']))
		const after = await importRuntimeFacts(system.module, 'system', { tsconfig: system.tsconfig, paths })
		expect(after.plugins[0]!.state)
			.toEqual([{ name: 'count', authorWritable: true }, { name: 'total', authorWritable: false }])
	}, 120_000)

	it('rejects with the module\'s own error', async () => {
		const directory = mkdtempSync(join(scratch, 'throws-'))
		writeFileSync(join(directory, 'package.json'), '{ "type": "module" }\n')
		writeFileSync(join(directory, 'system.ts'), 'throw new Error(\'top-level failure\')\n')
		await expect(importRuntimeFacts(join(directory, 'system.ts'), 'system')).rejects.toThrow('top-level failure')
		writeFileSync(join(directory, 'empty.ts'), 'export const other = 1\n')
		await expect(importRuntimeFacts(join(directory, 'empty.ts'), 'system')).rejects.toThrow('has no export "system"')
	}, 120_000)
})
