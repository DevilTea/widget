import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { translatePresentationMessage } from './presentation-messages'

/**
 * Issue #230 PR 3c: every fixed string the surfaces added or changed by this PR pass to `i18n.t()` as a literal has a
 * zh-TW translation (an untranslated one would silently show English in a zh-TW Lab). Core diagnostic text, plugin
 * descriptions and the survey's own texts never go through these calls.
 */
const files = [
	'../components/author/AuthorProblems.vue',
	'../components/author/ConfigFieldEditor.vue',
	'../components/author/AuthorStructureView.vue',
	'../components/graph/GraphKey.vue',
	'../components/graph/GraphCanvas.vue',
	'../components/graph/GraphLegend.vue',
	'../components/preview/PreviewPanel.vue',
	'../components/dependencies/relations/RelationsView.vue',
	'../components/dependencies/relations/RelationsGroupCard.vue',
]

// Widget vocabulary the zh-TW catalog deliberately keeps in English, so its translation equals the key.
const KEPT_IN_ENGLISH: ReadonlySet<string> = new Set(['Blueprint', 'Runtime', 'Preview', 'Config', 'Document r{revision}'])

// Strings built as `i18n.t(cond ? 'a' : 'b')` are picked up too: every quoted literal inside the call, except the operand of a
// comparison in its condition (`direction === 'in'`), which is a token and not a message.
function literalsPassedToT(source: string): string[] {
	const found: string[] = []
	for (const call of source.matchAll(/i18n\.t\(((?:[^()]|\([^()]*\))*)\)/g)) {
		const message = call[1]!.replace(/[!=]==?\s*'(?:[^'\\]|\\.)*'/g, '')
		for (const literal of message.matchAll(/'((?:[^'\\]|\\.)*)'/g))
			found.push(literal[1]!.replace(/\\'/g, '\''))
	}
	return found
}

describe('pR 3c strings', () => {
	for (const file of files) {
		it(`${file.split('/')
			.pop()} translates every fixed string to zh-TW`, () => {
			const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
			const literals = literalsPassedToT(source)
				.filter(literal => literal !== '')
			expect(literals.length)
				.toBeGreaterThan(0)
			const untranslated = literals.filter(literal => !KEPT_IN_ENGLISH.has(literal) && translatePresentationMessage('zh-TW', literal) === literal)
			expect(untranslated)
				.toEqual([])
		})
	}

	it('names the panels and views in Taiwan Chinese and keeps Widget vocabulary and developer panels in English', () => {
		const zh = (key: string): string => translatePresentationMessage('zh-TW', key)
		expect([zh('Author'), zh('Dependencies'), zh('Relations'), zh('Graph'), zh('Catalog'), zh('Structure')])
			.toEqual(['編寫', '相依性', '關聯', '關係圖', '目錄', '結構'])
		expect([zh('Blueprint'), zh('Runtime'), zh('Preview'), zh('Implementation'), zh('Document Tools'), zh('JSON')])
			.toEqual(['Blueprint', 'Runtime', 'Preview', 'Implementation', 'Document Tools', 'JSON'])
	})

	it('leaves the strings verbatim in English', () => {
		expect(translatePresentationMessage('en', 'Try again'))
			.toBe('Try again')
	})
})
