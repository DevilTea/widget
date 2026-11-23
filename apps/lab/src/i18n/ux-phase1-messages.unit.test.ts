import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TOOL_TEXT } from '../lab/tools'
import { translatePresentationMessage } from './presentation-messages'

/**
 * Lab UX phase 1 wording: Undo is named after what it does ("last change", not "last apply"), the Structure outcome
 * line drops the "Author command applied to Document rN" jargon, the zh-TW Revert and Undo are no longer near-synonyms,
 * the tab strip is translated, and the overflow menu's language entry says it is the Lab's.
 */
const zh = (key: string): string => translatePresentationMessage('zh-TW', key)
const SRC = fileURLToPath(new URL('..', import.meta.url))

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

describe('lab UX phase 1 wording', () => {
	it('names Undo after the change it takes back, in both languages', () => {
		expect(zh('Undo'))
			.toBe('復原上一步')
		expect(zh('Undo last change'))
			.toBe('復原上一步')
		expect(zh('Undo last change: restore the previous version as a new revision'))
			.toMatch(/^復原上一步：/)
	})

	// Lab UX phase 3 removed Revert; "Discard JSON changes" took its place (only while the JSON does not parse), and keeps the rule.
	it('gives discarding a zh-TW label that cannot be read as Undo', () => {
		expect(zh('Discard JSON changes'))
			.toBe('捨棄 JSON 變更')
		// Every zh-TW string about discarding JSON text says 捨棄 and never 還原 (the old Revert label, a near-synonym of 復原).
		for (const key of ['Discard JSON changes', 'Fix or discard the JSON that can\'t be applied before undoing', 'The JSON view has changes that are not in the document yet. Fix or discard them, then try again.', 'The JSON can\'t be applied, so nothing from it is in the document. Fix it in the JSON view, or use Discard JSON changes, to edit here.']) {
			expect(zh(key), key)
				.toContain('捨棄')
			expect(zh(key), key)
				.not
				.toContain('還原')
		}
	})

	it('says "the last change" instead of "the last Apply", and the Structure outcome is plain language', () => {
		expect([zh('From the last change'), zh('From the last change. Locations follow your current text.')])
			.toEqual(['來自上次變更', '來自上次變更；位置以你目前的文字為準。'])
		expect(zh('Change applied. Use Undo to take it back.'))
			.toBe('已套用變更。可用「復原上一步」撤回。')
	})

	it('no Lab surface still passes the old wording to i18n.t()', () => {
		const retired = ['Undo last apply', 'From the last Apply', 'From the last Apply. Locations follow your current text.', 'Author command applied to Document r{revision}.', 'Undo last apply: restore the previously applied version as a new revision']
		const offenders = sourceFiles(SRC)
			.flatMap(path => literalsPassedToT(readFileSync(path, 'utf8'))
				.filter(literal => retired.includes(literal))
				.map(literal => `${path}: ${literal}`))
		expect(offenders)
			.toEqual([])
	})

	it('labels the overflow menu\'s language entry as the Lab\'s own', () => {
		const header = readFileSync(join(SRC, 'components/LabHeader.vue'), 'utf8')
		expect(literalsPassedToT(header))
			.toContain('Lab language')
		expect(literalsPassedToT(header))
			.not
			.toContain('Language')
		expect(zh('Lab language'))
			.toBe('Lab 介面語言')
	})

	it('translates every tab title the workbench passes to i18n.t()', () => {
		const workbench = readFileSync(join(SRC, 'components/Workbench.vue'), 'utf8')
		const titles = literalsPassedToT(workbench)
		expect(titles)
			.toEqual(['Edit', 'Explain', 'Tools'])
		// The expert views' titles come from `lab/tools.ts` (Lab UX phase 3B); Implementation sets its own, naming its widget.
		const toolTitles = Object.values(TOOL_TEXT)
			.flatMap(text => [text.title, text.menuLabel, text.description])
		expect(toolTitles)
			.toEqual(expect.arrayContaining(['Blueprint tree', 'Runtime tree', 'Selected widget', 'Dependencies', 'Events log', 'Implementation', 'Document Tools']))
		expect([...titles, ...toolTitles, 'Implementation — {subject}'].filter(title => zh(title) === title))
			.toEqual([])
	})
})
