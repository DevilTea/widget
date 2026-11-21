import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { translatePresentationMessage } from './presentation-messages'

/**
 * Issue #230 (audit U09): every fixed string the Events surfaces pass to `i18n.t()` as a literal has a zh-TW translation
 * (an untranslated one would silently show English in a zh-TW Lab). Event names, widget ids, payloads and plugin-authored
 * descriptions never go through these calls.
 */
const files = [
	'../components/panels/EventsPanel.vue',
	'../components/events/EventLogEntryRow.vue',
	'../components/events/DeclaredEvents.vue',
	'../components/NonClosableTab.vue',
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

describe('events strings', () => {
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

	it('translates the panel description the Workbench passes as a prop, and keeps the vocabulary in English', () => {
		const source = readFileSync(fileURLToPath(new URL('../components/panels/EventsPanel.vue', import.meta.url)), 'utf8')
		const text = /text="([^"]+)"/.exec(source)![1]!
		expect(translatePresentationMessage('zh-TW', text))
			.not
			.toBe(text)
		expect(translatePresentationMessage('zh-TW', 'Events'))
			.toBe('Events')
	})

	it('translates the read-only Method tag and its explanation', () => {
		expect(translatePresentationMessage('zh-TW', 'read-only'))
			.toBe('唯讀')
		expect(translatePresentationMessage('zh-TW', 'Writes no State and emits no Event, itself or through the Methods it invokes, so a Property may depend on it'))
			.toContain('Property 可以依賴它')
	})

	it('keeps a singular English Event singular in zh-TW', () => {
		const singular = [
			'{count} Event recorded',
			'{total} recorded Event',
			'{shown} of {total} recorded Event shown',
			'Paused: {count} Event was not recorded.',
			'{count} Event was not recorded while the log was paused.',
			'{count} declared Event',
			'Could not subscribe to {count} Event.',
		]
		const plural = singular.filter(message => /\bEvents\b/.test(translatePresentationMessage('zh-TW', message)))
		expect(plural)
			.toEqual([])
	})

	it('leaves the strings verbatim in English', () => {
		expect(translatePresentationMessage('en', 'Only the selected widget'))
			.toBe('Only the selected widget')
	})
})
