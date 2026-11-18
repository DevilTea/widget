/**
 * The headless JSON-in/JSON-out evaluation (`evaluate.ts`, the function the Web Worker runs), against REAL Runtimes.
 *
 * The invariant the showcase stands on: for any document and answers, the quote the evaluation returns is the very
 * JSON a live Runtime of the same document gives after the same answers were written. These tests write the answers
 * into a live Runtime through the State API, read `quote.properties.quote` and `answers`, and compare with what the
 * evaluation made of the document and those answers, as JSON text.
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { referencesOf } from '../../styles/boundary-support'
import { evaluateQuote, evaluateQuoteJson, readQuoteOutcome } from './evaluate'
import { createQuoteRuntime, parsedPreset, presetText, valueOf, widgetOfType } from './test-support'

type Answers = Record<string, Record<string, unknown>>

/** Writes `answers` into a live Runtime of `document` and returns what the host would send. */
function liveRuntime(document: unknown, answers: Answers) {
	const { runtime } = createQuoteRuntime(JSON.stringify(document))
	for (const [id, members] of Object.entries(answers)) {
		const widget = runtime.getWidget(id) as unknown as { state: Record<string, { set: (value: unknown) => unknown }> }
		for (const [member, value] of Object.entries(members))
			widget.state[member]!.set(value)
	}
	const quote = widgetOfType(runtime, 'quote', 'Quote')
	return { runtime, request: { quote: document, answers: valueOf(quote.properties.answers.get()) } }
}

const scenarios: readonly { readonly name: string, readonly answers: Answers }[] = [
	{ name: 'the document\'s own answers', answers: {} },
	{ name: 'rush, courier and gloss flyers in another quantity', answers: { flyers: { quantity: 90, paper: 'gloss' }, rush: { enabled: true }, delivery: { method: 'courier' } } },
	{ name: 'free courier delivery on a big subtotal', answers: { poster: { quantity: 14 }, delivery: { method: 'courier' } } },
	{ name: 'a quantity just under a tier', answers: { flyers: { quantity: 47 } } },
]

describe('the same JSON as a live Runtime', () => {
	it.each(scenarios)('$name', ({ answers }) => {
		const document = parsedPreset()
		const { runtime, request } = liveRuntime(document, answers)
		const live = readQuoteOutcome(runtime)
		const evaluation = JSON.parse(evaluateQuoteJson(JSON.stringify(request))) as ReturnType<typeof evaluateQuote>
		expect(live.ok)
			.toBe(true)
		expect(JSON.stringify(evaluation.outcome))
			.toBe(JSON.stringify(live))
		expect(evaluation.rejected)
			.toEqual([])
	})

	it('is the answers Property of a live Runtime, written back, that makes the same quote: a round trip', () => {
		const document = parsedPreset()
		const { runtime, request } = liveRuntime(document, { flyers: { quantity: 1234 }, cards: { paper: 'linen' } })
		const fresh = evaluateQuote(request)
		expect(request.answers)
			.toMatchObject({ flyers: { quantity: 1234 }, cards: { paper: 'linen' } })
		expect(fresh.outcome)
			.toEqual(readQuoteOutcome(runtime))
	})

	it('answers the same, however often it is asked: it keeps nothing between calls', () => {
		const request = { quote: parsedPreset(), answers: { flyers: { quantity: 77 } } }
		const first = evaluateQuoteJson(JSON.stringify(request))
		const other = evaluateQuoteJson(JSON.stringify({ quote: parsedPreset(), answers: { flyers: { quantity: 3000 } } }))
		expect(evaluateQuoteJson(JSON.stringify(request)))
			.toBe(first)
		expect(other)
			.not
			.toBe(first)
	})
})

describe('failures are data', () => {
	it('reports a rule that throws as an exception outcome, the same on both sides', () => {
		const document = JSON.parse(presetText('quote-buggy-rule'))
		const { runtime, request } = liveRuntime(document, { flyers: { quantity: 50 } })
		const live = readQuoteOutcome(runtime)
		expect(live)
			.toMatchObject({ ok: false, failure: { kind: 'exception', widgetId: 'volume', member: 'adjustment', name: 'TypeError' } })
		expect(evaluateQuote(request).outcome)
			.toEqual(live)
	})

	it('reports a paper the item does not offer with that item\'s own diagnostic', () => {
		const document = parsedPreset()
		const { runtime, request } = liveRuntime(document, { flyers: { paper: 'velvet' } })
		const live = readQuoteOutcome(runtime)
		expect(live)
			.toMatchObject({ ok: false, failure: { kind: 'diagnostics', diagnostics: [{ widgetId: 'flyers', member: 'line', reason: 'unknown-paper' }] } })
		expect(evaluateQuote(request).outcome)
			.toEqual(live)
	})

	it('reports an invalid document with its located diagnostics, the library\'s messages verbatim', () => {
		const evaluation = evaluateQuote({ quote: JSON.parse(presetText('quote-invalid')), answers: {} })
		expect(evaluation.outcome.ok)
			.toBe(false)
		const failure = !evaluation.outcome.ok && evaluation.outcome.failure
		expect(failure && failure.kind)
			.toBe('invalid-document')
		expect(failure && failure.kind === 'invalid-document' && failure.diagnostics.map(({ widgetId, message }) => ({ widgetId, message })))
			.toEqual([
				{ widgetId: 'flyers', message: 'Invalid type: Expected number but received "9"' },
				{ widgetId: 'cards', message: 'Invalid integer: Received 2.5' },
				{ widgetId: 'cards', message: 'Invalid key: Expected never but received "finish"' },
				{ widgetId: 'volume', message: 'Invalid value: Expected <=100 but received 120' },
				{ widgetId: 'rush', message: 'Invalid key: Expected "en" but received undefined' },
				{ widgetId: 'quote', message: 'Invalid format: Expected /^[A-Z]{3}$/ but received "euro"' },
			])
	})

	it('refuses a request that is not { quote, answers }, and text that is not JSON', () => {
		for (const request of [null, 'x', { quote: {} }, { quote: {}, answers: [] }]) {
			expect(evaluateQuote(request).outcome, JSON.stringify(request))
				.toMatchObject({ ok: false, failure: { kind: 'invalid-request' } })
		}
		expect(JSON.parse(evaluateQuoteJson('{nope')).outcome)
			.toMatchObject({ ok: false, failure: { kind: 'invalid-request', message: 'The request is not valid JSON.' } })
	})
})

describe('answers the Runtime refuses', () => {
	it('lists each one, applies the rest, and leaves the refused State as it was', () => {
		const evaluation = evaluateQuote({
			quote: parsedPreset(),
			answers: {
				flyers: { quantity: 0, colour: 'blue', paper: 'gloss' },
				ghost: { quantity: 1 },
				tax: { percent: 5 },
				rush: 'yes',
			},
		})
		expect(evaluation.rejected)
			.toEqual([
				{ widgetId: 'flyers', member: 'quantity', reason: 'invalid-value', messages: ['Invalid value: Expected >=1 but received 0'] },
				{ widgetId: 'flyers', member: 'colour', reason: 'unknown-state', messages: [] },
				{ widgetId: 'ghost', member: null, reason: 'unknown-widget', messages: [] },
				{ widgetId: 'tax', member: null, reason: 'unknown-widget', messages: [] },
				{ widgetId: 'rush', member: null, reason: 'unknown-widget', messages: [] },
			])
		// quantity stayed 500 and paper became gloss: 500 x 12 + 3500 + 2900 = 12400
		expect(evaluation.outcome.ok && evaluation.outcome.quote.subtotalCents)
			.toBe(12400)
	})
})

describe('where it runs', () => {
	it('says whether a document and a window existed (neither does in a Node test, nor in a Worker)', () => {
		expect(evaluateQuote({ quote: parsedPreset(), answers: {} }).environment)
			.toEqual({ hasDocument: false, hasWindow: false })
	})
})

describe('the Worker bundle is DOM-free and Vue-free', () => {
	const here = dirname(fileURLToPath(import.meta.url))
	const ALLOWED_PACKAGES = new Set(['@deviltea/widget-core', 'valibot', '@valibot/to-json-schema'])

	function resolveLocal(from: string, specifier: string): string | null {
		const base = resolve(dirname(from), specifier)
		for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
			if (statSync(candidate, { throwIfNoEntry: false })
				?.isFile()) {
				return candidate
			}
		}
		return null
	}

	function graphOf(entry: string): { files: Set<string>, packages: Set<string>, opaque: string[] } {
		const files = new Set<string>()
		const packages = new Set<string>()
		const opaque: string[] = []
		const queue = [entry]
		while (queue.length > 0) {
			const file = queue.pop()!
			if (files.has(file))
				continue
			files.add(file)
			const references = referencesOf(readFileSync(file, 'utf8'))
			opaque.push(...references.opaque)
			for (const specifier of references.specifiers) {
				if (specifier.startsWith('.')) {
					const target = resolveLocal(file, specifier)
					if (target === null)
						throw new Error(`${file} refers to ${specifier}, which does not resolve`)
					queue.push(target)
				}
				else {
					packages.add(specifier.startsWith('@')
						? specifier.split('/')
								.slice(0, 2)
								.join('/')
						: specifier.split('/')[0]!)
				}
			}
		}
		return { files, packages, opaque }
	}

	const graph = graphOf(join(here, 'quote.worker.ts'))

	it('imports only Core, the schema library and files of this showcase outside renderers/', () => {
		expect([...graph.packages].sort())
			.toEqual([...ALLOWED_PACKAGES].sort())
		for (const file of graph.files) {
			expect(file.startsWith(`${here}/`), file)
				.toBe(true)
			expect(file, file)
				.not
				.toMatch(/\/renderers\/|\.vue$|showcase-host/)
		}
		expect(graph.opaque)
			.toEqual([])
	})

	it('reaches for no DOM global anywhere in it (the one `typeof` that reports their absence aside)', () => {
		for (const file of graph.files) {
			const source = readFileSync(file, 'utf8')
				.split('\n')
				.filter(line => !line.trimStart()
					.startsWith('*') && !line.trimStart()
					.startsWith('//') && !line.trimStart()
					.startsWith('/*'))
				.join('\n')
				.replaceAll(/typeof (document|window) !== 'undefined'/g, '')
			expect(source, file)
				.not
				.toMatch(/(?<![.\w])(?:document|window|self|globalThis)\s*[.[]|\b(?:localStorage|sessionStorage|navigator|HTMLElement|requestAnimationFrame)\b/)
		}
	})
})
