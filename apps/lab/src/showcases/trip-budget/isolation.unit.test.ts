/**
 * The showcase is isolated from the Lab: the plugins and renderers import no Lab module, use none of the chrome's
 * `--lab-*` tokens and call none of its translators, and the one file that reaches the Lab, `host.ts`, reaches only
 * its locale and theme stores. Curated sources cover every plugin type.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findDanglingRegistryTypes, findUncuratedPluginTypes } from '../../implementation/registry-coverage'
import { tripBudgetSources } from './sources'
import { tripBudgetSystem } from './system'

const root = dirname(fileURLToPath(import.meta.url))

function listFiles(directory: string, files: string[] = []): string[] {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name)
		if (entry.isDirectory())
			listFiles(path, files)
		else
			files.push(path)
	}
	return files
}

const sourceFiles = listFiles(root)
	.filter(file => !/\.unit\.test\.ts$/.test(file) && !file.endsWith('test-support.ts') && !file.endsWith('test-harness.ts'))

function specifiersOf(source: string): string[] {
	// In a Vue file only the script block imports; the template and style hold text that merely looks like it.
	const script = source.includes('<script') ? (/<script[^>]*>([\s\S]*?)<\/script>/.exec(source)?.[1] ?? '') : source
	return [...script.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)].map(match => match[1]!)
}

describe('showcase isolation', () => {
	it('imports nothing from the Lab except host.ts reaching its two presentation stores', () => {
		const outside: string[] = []
		for (const file of sourceFiles) {
			for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
				if (!specifier.startsWith('.'))
					continue
				const target = resolve(dirname(file), specifier)
				if (!target.startsWith(root))
					outside.push(`${relative(root, file)} -> ${specifier}`)
			}
		}
		expect(outside.sort())
			.toEqual([
				'host.ts -> ../../composables/use-lab-i18n',
				'host.ts -> ../../composables/use-lab-theme',
				'sources.ts -> ../../implementation/types',
			])
	})

	it('uses only third-party modules the showcase may rely on', () => {
		const modules = new Set<string>()
		for (const file of sourceFiles) {
			for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
				if (!specifier.startsWith('.'))
					modules.add(specifier)
			}
		}
		expect([...modules].sort())
			.toEqual(['@deviltea/widget-core', '@deviltea/widget-inspector/anchor', '@deviltea/widget-vue', 'vue'])
	})

	it('has no chrome token, no Lab translator and no Tailwind class in any renderer or plugin', () => {
		for (const file of sourceFiles.filter(candidate => !candidate.endsWith('host.ts') || candidate.includes('renderers'))) {
			const text = readFileSync(file, 'utf8')
			const name = relative(root, file)
			expect(text, name).not.toMatch(/--lab-/)
			expect(text, name).not.toMatch(/\bi18n\.t\(|useLabI18n|useLabTheme/)
			expect(text, name).not.toMatch(/\bpika\(|@nuxt\/ui|tailwind/i)
		}
	})
})

describe('curated Implementation sources', () => {
	it('covers every plugin type and names no type the system does not have', () => {
		expect(findDanglingRegistryTypes(tripBudgetSources, tripBudgetSystem as never))
			.toEqual([])
		expect(findUncuratedPluginTypes(tripBudgetSources, tripBudgetSystem as never))
			.toEqual([])
	})

	it('lists files that exist, each with a loadable source text', async () => {
		for (const [type, entry] of Object.entries(tripBudgetSources)) {
			for (const file of entry.files) {
				const text = await file.load()
				expect(text.length, `${type}/${file.title}`)
					.toBeGreaterThan(50)
				expect(file.path.startsWith('apps/lab/src/showcases/trip-budget/'), file.path)
					.toBe(true)
			}
		}
	})
})
