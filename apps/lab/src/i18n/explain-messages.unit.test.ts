import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { translatePresentationMessage } from './presentation-messages'

/** Lab UX phase 2 (M13): every message of the Explain tab has natural Taiwan Chinese, with the placeholders kept. */
const zh = (key: string): string => translatePresentationMessage('zh-TW', key)
const SRC = fileURLToPath(new URL('..', import.meta.url))

// Every quoted literal inside an `i18n.t(...)` call.
function literalsPassedToT(source: string): string[] {
	const found: string[] = []
	for (const call of source.matchAll(/i18n\.t\(((?:[^()]|\([^()]*\))*)\)/g)) {
		for (const literal of call[1]!.matchAll(/'((?:[^'\\]|\\.)*)'/g))
			found.push(literal[1]!.replace(/\\'/g, '\''))
	}
	return found
}

const EXPLAIN_FILES = [
	'components/panels/ExplainPanel.vue',
	...readdirSync(join(SRC, 'components/explain'))
		.filter(name => name.endsWith('.vue'))
		.map(name => `components/explain/${name}`),
]

function placeholders(message: string): string[] {
	return [...message.matchAll(/\{([\w-]+)\}/g)].map(match => match[1]!)
		.sort()
}

describe('explain tab messages', () => {
	// '' is a parameter fallback (`previewRevision ?? ''`), not a message.
	const literals = [...new Set(EXPLAIN_FILES.flatMap(path => literalsPassedToT(readFileSync(join(SRC, path), 'utf8'))))].filter(literal => literal !== '')

	it('reads the messages of every Explain component', () => {
		expect(literals)
			.toEqual(expect.arrayContaining(['Why it behaves this way', '{property} reads {widget}\'s {members}', '{member} (now: {value})', 'Open dependency graph']))
	})

	it('translates every literal with the same placeholders', () => {
		const untranslated = literals.filter(literal => zh(literal) === literal)
		expect(untranslated)
			.toEqual([])
		for (const literal of literals) {
			expect(placeholders(zh(literal)), literal)
				.toEqual(placeholders(literal))
		}
	})

	it('names the tab and the sentences in Taiwan wording', () => {
		expect(zh('Explain'))
			.toBe('說明')
		expect(zh('{property} reads {widget}\'s {members}'))
			.toBe('{property} 讀取 {widget} 的 {members}')
		expect(zh('Click a widget in the Preview (Inspect) or in the Structure tree to see what it is and why it behaves this way.'))
			.toContain('「結構」')
	})
})
