import { describe, expect, it } from 'vitest'
import { referencesOf } from './boundary-support'

/**
 * `referencesOf` is the one reader the isolation guards trust, so what it does and does not take for a reference is
 * pinned here: every real way a keyword `from`/`import` introduces a specifier is found (the guard stays fail-closed),
 * and the tail of a member access or an attribute value is not mistaken for one.
 */

const specifiers = (source: string): string[] => referencesOf(source).specifiers

describe('referencesOf: static imports', () => {
	it('finds the specifier however the keyword is separated from what precedes it', () => {
		expect(specifiers('import { a } from \'./a\''))
			.toEqual(['./a'])
		expect(specifiers('import {a}from\'./b\''))
			.toEqual(['./b'])
		expect(specifiers('export * from \'./c\''))
			.toEqual(['./c'])
		expect(specifiers('export*from"./d"'))
			.toEqual(['./d'])
		expect(specifiers('const x = 1;import\'./e\''))
			.toEqual(['./e'])
		expect(specifiers('const x = 1\nimport \'./f\''))
			.toEqual(['./f'])
		expect(specifiers('import type { T }\n\tfrom \'./g\''))
			.toEqual(['./g'])
		expect(specifiers('a}from \'./h\''))
			.toEqual(['./h'])
	})

	it('finds a literal dynamic import and reports the others as opaque', () => {
		expect(specifiers('const m = await import(\'./lazy\')'))
			.toEqual(['./lazy'])
		expect(referencesOf('import(path)').opaque)
			.toHaveLength(1)
	})
})

describe('referencesOf: text that only looks like an import', () => {
	it('does not take the end of a member access in a template attribute for a `from` keyword', () => {
		const template = `<li
	:data-payer="transfer.from"
	:data-payee="transfer.to"
>`
		expect(specifiers(template))
			.toEqual([])
		expect(specifiers('<i :title="row.import" :class="x">'))
			.toEqual([])
		expect(specifiers('a.from"x" + b$from\'y\' + c-from"z"'))
			.toEqual([])
	})

	it('does not take a bare identifier that is a whole attribute value or string for one', () => {
		expect(specifiers('<Row :x="from" :y="to" />'))
			.toEqual([])
		expect(specifiers('<Row :x=\'import\' :y=\'to\' />'))
			.toEqual([])
		expect(specifiers('const keys = ["from", "to"]'))
			.toEqual([])
		// The keyword itself still counts, with or without a space before the quote.
		expect(specifiers('import a from"./a"\nimport b from \'./b\'\nimport \'./c.css\''))
			.toEqual(['./a', './b', './c.css'])
	})

	it('does not take a `data-from` attribute for one', () => {
		expect(specifiers('<li data-from="a" data-to="b">'))
			.toEqual([])
	})
})
