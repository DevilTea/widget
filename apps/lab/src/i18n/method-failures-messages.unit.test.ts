import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { translatePresentationMessage } from './presentation-messages'

/**
 * Issue #230 (audit U08): every fixed string the Method failure surfaces pass to `i18n.t()` as a literal has a zh-TW
 * translation (an untranslated one would silently show English in a zh-TW Lab). Core diagnostic text (code, reason, message),
 * Method and widget names and the arguments and results never go through these calls.
 */
const files = [
	'../components/runtime/RuntimeMethodRow.vue',
	'../components/runtime/MethodDiagnosticList.vue',
	'../components/events/MethodFailureEntryRow.vue',
	'../components/panels/EventsPanel.vue',
]

// Widget vocabulary the zh-TW catalog deliberately keeps in English, so its translation equals the key.
const KEPT_IN_ENGLISH: ReadonlySet<string> = new Set(['Widget', 'Preview r{revision}'])

function literalsPassedToT(source: string): string[] {
	const found: string[] = []
	for (const call of source.matchAll(/i18n\.t\(((?:[^()]|\([^()]*\))*)\)/g)) {
		const message = call[1]!.replace(/[!=]==?\s*'(?:[^'\\]|\\.)*'/g, '')
		for (const literal of message.matchAll(/'((?:[^'\\]|\\.)*)'/g))
			found.push(literal[1]!.replace(/\\'/g, '\''))
	}
	return found
}

describe('method failure strings', () => {
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

	it('translates the Events panel description the Workbench passes as a prop', () => {
		const source = readFileSync(fileURLToPath(new URL('../components/panels/EventsPanel.vue', import.meta.url)), 'utf8')
		const text = /text="([^"]+)"/.exec(source)![1]!
		expect(translatePresentationMessage('zh-TW', text))
			.not
			.toBe(text)
	})

	it('keeps Widget vocabulary in English and leaves the strings verbatim in English', () => {
		expect(translatePresentationMessage('zh-TW', 'Method failure'))
			.toContain('Method')
		expect(translatePresentationMessage('en', 'Last call failed'))
			.toBe('Last call failed')
	})
})
