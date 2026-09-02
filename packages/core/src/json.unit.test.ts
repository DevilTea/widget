import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from './index'
import { inspectJsonValue, isJsonValue } from './json'

describe('authored JSON runtime domain', () => {
	it('rejects symbol-keyed objects and arrays', () => {
		const object = { value: 1 }
		Object.defineProperty(object, Symbol('malformed'), { value: true })
		const array = [1]
		Object.defineProperty(array, Symbol('malformed'), { value: true })

		expect(isJsonValue(object))
			.toBe(false)
		expect(isJsonValue(array))
			.toBe(false)
	})

	it('rejects named array properties outside indices and length', () => {
		const array = [1]
		Object.defineProperty(array, 'metadata', { value: 'not JSON array material' })

		expect(isJsonValue(array))
			.toBe(false)
	})

	it('fails closed for sparse, accessor-backed, cyclic, custom, and non-finite values', () => {
		const sparse = Array.from({ length: 1 })
		class CustomArray extends Array<number> {}
		const accessor: Record<string, unknown> = {}
		Object.defineProperty(accessor, 'value', { get: () => 1 })
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic
		const custom = Object.create({ inherited: true })
		custom.value = 1

		expect(isJsonValue(sparse))
			.toBe(false)
		expect(isJsonValue(new CustomArray(1)))
			.toBe(false)
		expect(isJsonValue(accessor))
			.toBe(false)
		expect(isJsonValue(cyclic))
			.toBe(false)
		expect(isJsonValue(custom))
			.toBe(false)
		expect(isJsonValue(Number.NaN))
			.toBe(false)
		expect(isJsonValue(Number.POSITIVE_INFINITY))
			.toBe(false)
	})

	it('keeps the Blueprint source proof false for forged symbol and named-array material', () => {
		const plugin = createWidgetPlugin('leaf')
			.description('Leaf widget')
			.interfaces<Record<never, never>>()
			.done()
		const system = createWidgetSystem({ plugins: [plugin] })
		const symbolSource = { id: 'root', type: 'leaf' }
		Object.defineProperty(symbolSource, Symbol('malformed'), { value: true })
		const namedArray = [{ id: 'root', type: 'leaf' }]
		Object.defineProperty(namedArray, 'metadata', { value: true })

		expect(system.createBlueprint(symbolSource).sourceJsonCompatible)
			.toBe(false)
		expect(system.createBlueprint(namedArray).sourceJsonCompatible)
			.toBe(false)
	})

	it('classifies the frozen JSON compatibility reason taxonomy', () => {
		const custom = Object.create({ inherited: true }) as Record<string, unknown>
		custom.value = 1
		const symbolKey = Symbol('malformed')
		const symbolObject = { value: 1 }
		Object.defineProperty(symbolObject, symbolKey, { value: true })
		const accessor: Record<string, unknown> = {}
		let getterCalls = 0
		Object.defineProperty(accessor, 'value', { get: () => {
			getterCalls++
			return 1
		} })
		const sparse: unknown[] = []
		sparse.length = 1
		const namedArray = [1]
		Object.defineProperty(namedArray, 'metadata', { value: true })
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic

		const cases: readonly [unknown, string, readonly PropertyKey[]][] = [
			[undefined, 'undefined', []],
			[Number.NaN, 'non-finite-number', []],
			[1n, 'bigint', []],
			[Symbol('value'), 'symbol', []],
			[() => 1, 'function', []],
			[new Date(), 'unsupported-object-prototype', []],
			[custom, 'unsupported-object-prototype', []],
			[symbolObject, 'symbol-key', [symbolKey]],
			[accessor, 'accessor-property', ['value']],
			[sparse, 'sparse-array', [0]],
			[namedArray, 'array-extra-property', ['metadata']],
			[cyclic, 'cyclic-reference', ['self']],
		]

		for (const [value, reason, path] of cases) {
			const inspection = inspectJsonValue(value)
			expect(inspection.compatible)
				.toBe(false)
			expect(inspection.diagnostics)
				.toEqual([expect.objectContaining({
					code: 'json-incompatible-value',
					location: { type: 'source' },
					path,
					reason,
				})])
		}
		expect(getterCalls)
			.toBe(0)
	})

	it('distinguishes unsafe source access from confirmed JSON incompatibility and locally continues siblings', () => {
		const { proxy, revoke } = Proxy.revocable({}, {})
		revoke()
		const source = {
			first: undefined,
			hostile: proxy,
			last: 1n,
		}

		const inspection = inspectJsonValue(source)

		expect(inspection.compatible)
			.toBe(false)
		expect(inspection.diagnostics.map(diagnostic => ({
			code: diagnostic.code,
			path: diagnostic.path,
			reason: 'reason' in diagnostic ? diagnostic.reason : undefined,
		})))
			.toEqual([
				{ code: 'json-incompatible-value', path: ['first'], reason: 'undefined' },
				{ code: 'source-access-failed', path: ['hostile'], reason: undefined },
				{ code: 'json-incompatible-value', path: ['last'], reason: 'bigint' },
			])
	})

	it('accepts repeated acyclic aliases while rejecting only active-path cycles', () => {
		const shared = { value: 1 }
		expect(inspectJsonValue({ left: shared, right: shared }))
			.toEqual({ compatible: true, diagnostics: [] })
	})

	it('retains source-level JSON facts only on the Blueprint aggregate', () => {
		const plugin = createWidgetPlugin('leaf')
			.description('Leaf widget')
			.interfaces<Record<never, never>>()
			.done()
		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'leaf', extra: new Date() })

		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.sourceJsonCompatible)
			.toBe(false)
		expect(blueprint.diagnostics)
			.toEqual([expect.objectContaining({
				code: 'json-incompatible-value',
				location: { type: 'source' },
				path: ['extra'],
				reason: 'unsupported-object-prototype',
			})])
		expect(blueprint.root.diagnostics)
			.toEqual([])
		expect(Object.isFrozen(blueprint.diagnostics))
			.toBe(true)
		const diagnostic = blueprint.diagnostics[0]!
		expect(Object.isFrozen(diagnostic))
			.toBe(true)
		expect(Object.isFrozen(diagnostic.location))
			.toBe(true)
		if (diagnostic.code !== 'json-incompatible-value')
			throw new Error('Expected a JSON compatibility diagnostic.')
		expect(Object.isFrozen(diagnostic.path))
			.toBe(true)
	})

	it('publishes source-access-failed on a Blueprint when exact-source inspection is unproven', () => {
		const plugin = createWidgetPlugin('leaf')
			.description('Leaf widget')
			.interfaces<Record<never, never>>()
			.done()
		const system = createWidgetSystem({ plugins: [plugin] })
		const { proxy, revoke } = Proxy.revocable({ id: 'root', type: 'leaf' }, {})
		revoke()

		const blueprint = system.createBlueprint(proxy)

		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.sourceJsonCompatible)
			.toBe(false)
		expect(blueprint.diagnostics)
			.toContainEqual(expect.objectContaining({
				code: 'source-access-failed',
				location: { type: 'source' },
				path: [],
			}))
	})
})
