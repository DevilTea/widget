/**
 * The quote Web Worker's import graph, read from the source text the way the isolation guards read it: everything
 * `showcases/quote-rules/quote.worker.ts` pulls in (the evaluation, the system, the plugins) must be free of Vue, of the
 * renderers, of the showcase host contract and of any DOM global, because it runs in a realm that has none. This lives
 * with the Lab's boundary tests, not in the showcase, because it reads files (a showcase test may import only its own
 * directory). The behavioural half (the same JSON as a live Runtime, and the worker saying it has no `document`) is in
 * `showcases/quote-rules/evaluate.unit.test.ts` and `e2e/quote-rules.spec.ts`.
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { referencesOf } from './boundary-support'

describe('the quote Web Worker bundle is DOM-free and Vue-free', () => {
	const here = join(dirname(fileURLToPath(import.meta.url)), '..', 'showcases', 'quote-rules')
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
