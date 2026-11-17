import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { translatePresentationMessage } from './presentation-messages'

/**
 * Issue #230 PR 3b: every fixed string the layout / Selected widget surfaces pass to `i18n.t()` as a literal has a
 * zh-TW translation (an untranslated string would silently show English in a zh-TW Lab). Core diagnostic text
 * never goes through these files' `t()` calls.
 */
const files = [
	'../components/StatusDetails.vue',
	'../components/panels/SelectedWidgetPanel.vue',
	'../components/runtime/InspectableValueTree.vue',
	'../components/runtime/RuntimeValueRow.vue',
	'../components/blueprint/ConfigView.vue',
]

// Terms the zh-TW catalog deliberately keeps in English (Widget vocabulary), so their translation equals the key.
const KEPT_IN_ENGLISH: ReadonlySet<string> = new Set(['Document', 'Preview', 'Revisions', 'JSON draft'])

// Strings built as `i18n.t(cond ? 'a' : 'b')` are picked up too: every quoted literal inside the call.
function literalsPassedToT(source: string): string[] {
	const found: string[] = []
	for (const call of source.matchAll(/i18n\.t\(((?:[^()]|\([^()]*\))*)\)/g)) {
		for (const literal of call[1]!.matchAll(/'((?:[^'\\]|\\.)*)'/g))
			found.push(literal[1]!.replace(/\\'/g, '\''))
	}
	return found
}

describe('pR 3b strings', () => {
	for (const file of files) {
		it(`${file.split('/')
			.pop()} translates every fixed string to zh-TW`, () => {
			const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
			// Lowercase identifiers (`'array'`, `'syntax-error'`) are comparison tokens inside the same expression, not messages.
			const literals = literalsPassedToT(source)
				.filter(literal => literal !== '' && !/^[a-z][a-z-]*$/.test(literal))
			expect(literals.length)
				.toBeGreaterThan(0)
			// Params (`{name}`) are interpolated after translation, so the key itself is what must exist.
			const untranslated = literals.filter(literal => !KEPT_IN_ENGLISH.has(literal) && translatePresentationMessage('zh-TW', literal) === literal)
			expect(untranslated)
				.toEqual([])
		})
	}

	it('translates the header and panel names added by this PR', () => {
		for (const key of ['Reset layout', 'Selected widget', 'Declaration', 'Runtime values']) {
			expect(translatePresentationMessage('zh-TW', key))
				.not
				.toBe(key)
		}
	})
})
