import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { translatePresentationMessage } from './presentation-messages'

/**
 * Lab UX phase 3 (one commit model): the surfaces that changed have a zh-TW translation for every string they pass to
 * `i18n.t()` (an untranslated one would silently show English in a zh-TW Lab), and no surface still offers Apply, Revert or
 * an "unapplied draft" that no longer exists.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url))
const zh = (key: string): string => translatePresentationMessage('zh-TW', key)

function sourceFiles(directory: string): string[] {
	return readdirSync(directory)
		.flatMap((name) => {
			const path = join(directory, name)
			if (statSync(path)
				.isDirectory()) {
				return sourceFiles(path)
			}
			return /\.(?:vue|ts)$/.test(name) && !name.endsWith('.unit.test.ts') ? [path] : []
		})
}

// Every quoted literal inside an `i18n.t(...)` call, except comparison tokens (`origin === 'json'`).
function literalsPassedToT(source: string): string[] {
	const found: string[] = []
	for (const call of source.matchAll(/i18n\.t\(((?:[^()]|\([^()]*\))*)\)/g)) {
		const message = call[1]!.replace(/[!=]==?\s*'(?:[^'\\]|\\.)*'/g, '')
		for (const literal of message.matchAll(/'((?:[^'\\]|\\.)*)'/g))
			found.push(literal[1]!.replace(/\\'/g, '\''))
	}
	return found
}

const CHANGED = [
	'components/LabHeader.vue',
	'components/author/AuthorJsonView.vue',
	'components/author/AuthorStructureView.vue',
	'components/author/ConfigFieldEditor.vue',
	'components/editor/MonacoJsonEditor.vue',
	'components/preview/ReplacedDocumentNotice.vue',
	'components/StatusDetails.vue',
]
const KEPT_IN_ENGLISH: ReadonlySet<string> = new Set(['Document', 'Preview', 'Revisions', 'Widget Lab', 'JSON', 'Config', 'config', 'Document r{revision}'])

describe('lab UX phase 3 wording', () => {
	it('translates every string the changed surfaces show', () => {
		for (const file of CHANGED) {
			const untranslated = literalsPassedToT(readFileSync(join(SRC, file), 'utf8'))
				.filter(literal => !KEPT_IN_ENGLISH.has(literal) && zh(literal) === literal)
			expect(untranslated, file)
				.toEqual([])
		}
	})

	it('names the status chip states in plain Taiwan Chinese', () => {
		expect([zh('Up to date'), zh('Preview restarted'), zh('JSON syntax error — not applied'), zh('Preview unavailable')])
			.toEqual(['已是最新', '預覽已重新啟動', 'JSON 語法錯誤，尚未套用', '無法預覽'])
		expect(zh('{count} problems · Preview shows the last working version'))
			.toBe('{count} 個問題 · 預覽顯示最後一個可運作的版本')
	})

	it('no Lab surface still offers Apply, Revert or an unapplied draft', () => {
		const retired = [
			'Apply',
			'Applying…',
			'Revert',
			'Set value',
			'Unapplied changes',
			'Preview shows the last applied version',
			'Apply your edits to the document and preview',
			'Nothing to apply: no unapplied edits',
			'Nothing to revert: no unapplied edits',
			'Apply or revert your unapplied edits before undoing',
			'Wait for the current Apply to finish',
			'Apply or Revert the JSON draft before using Structure commands.',
			'The JSON view has unapplied changes. Apply or discard the JSON draft to edit here.',
			'Expert JSON view: edit the draft, then use Apply. JSON is parsed into one root SourcePatch.',
			'Format the JSON draft',
		]
		const offenders = sourceFiles(SRC)
			.flatMap(path => literalsPassedToT(readFileSync(path, 'utf8'))
				.filter(literal => retired.includes(literal))
				.map(literal => `${path}: ${literal}`))
		expect(offenders)
			.toEqual([])
		// Nor does a tutorial step still tell the user to press Apply.
		const pressApply = sourceFiles(join(SRC, 'tutorial'))
			.filter(path => readFileSync(path, 'utf8')
				.includes('press Apply'))
		expect(pressApply)
			.toEqual([])
	})
})
