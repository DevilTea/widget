// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { encodeInspectableValue } from './value'

describe('encodeInspectableValue', () => {
	it('encodes primitives and special numeric values with JSON-safe tags', () => {
		const values = [
			encodeInspectableValue(undefined),
			encodeInspectableValue(Number.NaN),
			encodeInspectableValue(Infinity),
			encodeInspectableValue(-Infinity),
			encodeInspectableValue(-0),
			encodeInspectableValue(123n),
		]

		expect(values)
			.toEqual([
				{ type: 'undefined' },
				{ type: 'number-special', value: 'nan' },
				{ type: 'number-special', value: 'positive-infinity' },
				{ type: 'number-special', value: 'negative-infinity' },
				{ type: 'number-special', value: 'negative-zero' },
				{ type: 'bigint', value: '123' },
			])
		expect(() => JSON.stringify(values)).not.toThrow()
	})

	it('bounds strings, entries, and depth explicitly', () => {
		const value = {
			alpha: 'abcdef',
			beta: { nested: { tooDeep: true } },
			gamma: 3,
		}
		const encoded = encodeInspectableValue(value, {
			maxDepth: 2,
			maxEntries: 2,
			maxStringLength: 3,
		})

		expect(encoded)
			.toMatchObject({ type: 'object', truncated: true })
		if (encoded.type !== 'object')
			throw new Error('Expected object encoding.')
		expect(encoded.entries)
			.toEqual([
				{ key: 'alpha', value: { type: 'string', value: 'abc', truncated: true } },
				{
					key: 'beta',
					value: {
						type: 'object',
						id: expect.any(Number),
						entries: [{ key: 'nested', value: { type: 'truncated', reason: 'max-depth' } }],
						truncated: false,
					},
				},
			])
	})

	it('represents cycles and repeated references without throwing', () => {
		const shared: Record<string, unknown> = { value: 1 }
		const root: Record<string, unknown> = { first: shared, second: shared }
		root.self = root

		const encoded = encodeInspectableValue(root)
		expect(encoded.type)
			.toBe('object')
		const json = JSON.stringify(encoded)
		expect(json)
			.toContain('"type":"reference"')
		expect(() => JSON.parse(json)).not.toThrow()
	})

	it('never executes accessors or application toJSON()', () => {
		const getter = vi.fn(() => 'secret')
		const toJSON = vi.fn(() => ({ leaked: true }))
		const value = Object.create(null) as Record<string, unknown>
		Object.defineProperty(value, 'danger', { enumerable: true, get: getter })
		Object.defineProperty(value, 'toJSON', { enumerable: true, value: toJSON })

		const encoded = encodeInspectableValue(value)
		expect(getter).not.toHaveBeenCalled()
		expect(toJSON).not.toHaveBeenCalled()
		if (encoded.type !== 'object')
			throw new Error('Expected object encoding.')
		expect(encoded.entries.find(entry => entry.key === 'danger')?.value)
			.toEqual({ type: 'opaque', kind: 'uninspectable' })
		expect(encoded.entries.find(entry => entry.key === 'toJSON')?.value)
			.toEqual({ type: 'opaque', kind: 'function' })
	})

	it('turns functions, symbols, DOM nodes, class instances, and hostile proxies into opaque previews', () => {
		class Example {}
		const proxy = new Proxy({}, {
			getPrototypeOf() {
				throw new Error('blocked')
			},
		})

		expect(encodeInspectableValue(() => {}))
			.toEqual({ type: 'opaque', kind: 'function' })
		expect(encodeInspectableValue(Symbol('x')))
			.toEqual({ type: 'opaque', kind: 'symbol' })
		expect(encodeInspectableValue(document.createElement('div')))
			.toEqual({ type: 'opaque', kind: 'dom-node' })
		const instance = new Example()
		expect(encodeInspectableValue(instance))
			.toEqual({ type: 'opaque', kind: 'class-instance' })
		expect(encodeInspectableValue({ first: instance, second: instance }))
			.toMatchObject({
				type: 'object',
				entries: [
					{ key: 'first', value: { type: 'opaque', kind: 'class-instance' } },
					{ key: 'second', value: { type: 'opaque', kind: 'class-instance' } },
				],
			})
		expect(encodeInspectableValue(proxy))
			.toEqual({ type: 'opaque', kind: 'uninspectable' })
	})
})
