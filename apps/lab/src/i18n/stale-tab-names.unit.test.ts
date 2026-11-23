import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Lab UX phase 3B replaced the six-tab tool group (Author, Selected widget, Blueprint, Runtime, Events, Dependencies) with Edit /
 * Explain / Tools and expert views opened from the Tools menu. No text a person reads may still send them to a tab that is gone:
 * this reads the string literals of the message tables (en keys and zh-TW values), the tours, the showcases' own messages and the
 * expert views' names, and the literals the components pass to `i18n.t()`.
 *
 * What counts as stale: "Author" as a word (the tab; the lower-case "author command" of Core's vocabulary is not it), "Author >",
 * "<view> tab" for a view that is now an expert view, the old zh-TW tab name 編寫 and "<view> 分頁" for the same views, and "the
 * Runtime panel" (the view is "the Runtime tree" now). Comments are not read; quoted literals only.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url))

function files(directory: string, keep: (path: string) => boolean): string[] {
	return readdirSync(directory)
		.flatMap((name) => {
			const path = join(directory, name)
			if (statSync(path)
				.isDirectory()) {
				return files(path, keep)
			}
			return keep(path) ? [path] : []
		})
}

const notTest = (path: string): boolean => !path.endsWith('.unit.test.ts')
const SOURCES = [
	...files(join(SRC, 'i18n'), path => path.endsWith('.ts') && notTest(path)),
	...files(join(SRC, 'tutorial'), path => path.endsWith('-script.ts')),
	...files(join(SRC, 'showcases'), path => path.endsWith('/messages.ts')),
	join(SRC, 'lab/tools.ts'),
]
const COMPONENTS = files(join(SRC, 'components'), path => path.endsWith('.vue'))

/** Single-quoted literals outside comments (the files use single quotes for every string). */
function literals(source: string): string[] {
	const code = source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '')
	return [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map(match => match[1]!.replace(/\\'/g, '\''))
}

/** Every literal inside an `i18n.t(...)` call of a component. */
function literalsPassedToT(source: string): string[] {
	return [...source.matchAll(/i18n\.t\(((?:[^()]|\([^()]*\))*)\)/g)].flatMap(call => literals(call[1]!))
}

const STALE: readonly RegExp[] = [
	/\bAuthor\b/,
	/\b(?:Blueprint|Runtime|Events|Dependencies|Selected widget|Implementation|Document Tools|Catalog) tab\b/,
	/編寫/,
	/(?:Blueprint|Runtime|Events|Dependencies|相依性|選取的 widget) ?分頁/,
	/\bthe Runtime panel\b/,
	/Runtime 面板/,
]

function staleIn(texts: readonly string[]): string[] {
	return texts.filter(text => STALE.some(pattern => pattern.test(text)))
}

describe('no visible text names a tab that phase 3B removed', () => {
	it('reads real text (the scan is not empty)', () => {
		expect(SOURCES.length)
			.toBeGreaterThan(10)
		expect(literals(readFileSync(join(SRC, 'i18n/workbench-messages.ts'), 'utf8')))
			.toContain('Browse widget types')
	})

	it.each(SOURCES.map(path => [relative(SRC, path), path] as const))('%s', (_name, path) => {
		expect(staleIn(literals(readFileSync(path, 'utf8'))))
			.toEqual([])
	})

	it('the components pass no such text to i18n.t()', () => {
		const found = COMPONENTS.flatMap(path => staleIn(literalsPassedToT(readFileSync(path, 'utf8')))
			.map(text => `${relative(SRC, path)}: ${text}`))
		expect(found)
			.toEqual([])
	})

	it('catches the names it is meant to catch', () => {
		expect(staleIn(['Open the Events tab', 'in Author > Structure', '打開 Blueprint 分頁', '編寫', 'the Runtime panel shows', 'Runtime 面板']))
			.toHaveLength(6)
		expect(staleIn(['The author command could not be applied', 'Open the Events log', 'Edit > Structure', 'Runtime tree', 'the Runtime shows']))
			.toEqual([])
	})
})
