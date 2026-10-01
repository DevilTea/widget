import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, createWidgetValueContract } from '../index'
import { inspectBlueprint, inspectPlugin } from './index'

interface TranslationResult {
	readonly value: string
	readonly warnings: readonly string[]
}

const stringContract = createWidgetValueContract<string>('example/string')
const sameStringContract = createWidgetValueContract<string>('example/string')
const translationResultContract = createWidgetValueContract<TranslationResult>('example/translation-result')
const PROTO_KEY = '__proto__' as const

interface FixtureInterfaces {
	state: {
		authorVisible: number
		internal: number
	}
	properties: {
		text: string
		translated: TranslationResult
		untyped: number
	}
	events: {
		changed: [value: string]
	}
}

let computeCalls = 0

const plugin = createWidgetPlugin('plugin-inspection')
	.description('Plugin inspection fixture')
	.interfaces<FixtureInterfaces>()
	.state(state => state
		.authorVisible({
			authorWritable: true,
			validate: (input): input is number => typeof input === 'number',
		})
		.internal({
			validate: (input): input is number => typeof input === 'number',
		}))
	.properties(properties => properties
		.text({
			valueContract: stringContract,
			compute: () => {
				computeCalls += 1
				return 'text'
			},
		})
		.translated({
			valueContract: translationResultContract,
			compute: () => {
				computeCalls += 1
				return { value: 'translated', warnings: [] }
			},
		})
		.untyped({
			compute: () => {
				computeCalls += 1
				return 1
			},
		}))
	.events(events => events.changed({ description: 'Value changed' }))
	.done()

describe('plugin inspection', () => {
	it('is identity-stable and projects only passive State/Property/Event declaration facts', () => {
		const first = inspectPlugin(plugin)
		const second = inspectPlugin(plugin)

		expect(first)
			.toBe(second)
		expect(first.state?.get('authorVisible'))
			.toEqual({ type: 'state', name: 'authorVisible', authorWritable: true })
		expect(first.state?.get('internal'))
			.toEqual({ type: 'state', name: 'internal', authorWritable: false })
		expect(first.properties?.get('text'))
			.toEqual({ type: 'property', name: 'text', valueContractId: 'example/string' })
		expect(first.properties?.get('translated'))
			.toEqual({ type: 'property', name: 'translated', valueContractId: 'example/translation-result' })
		expect(first.properties?.get('untyped'))
			.toEqual({ type: 'property', name: 'untyped', valueContractId: null })
		expect(first.events?.get('changed'))
			.toEqual({ type: 'event', name: 'changed', description: 'Value changed' })
		expect(Object.keys(first.properties?.get('text') ?? {}))
			.toEqual(['type', 'name', 'valueContractId'])
		expect(computeCalls)
			.toBe(0)
	})

	it('exposes runtime-immutable maps and member facts without leaking contract object identity', () => {
		const inspection = inspectPlugin(plugin)
		const text = inspection.properties?.get('text')

		expect(Object.isFrozen(inspection))
			.toBe(true)
		expect(Object.isFrozen(inspection.state))
			.toBe(true)
		expect(Object.isFrozen(inspection.properties))
			.toBe(true)
		expect(Object.isFrozen(inspection.events))
			.toBe(true)
		expect(Object.isFrozen(text))
			.toBe(true)
		expect(text?.valueContractId)
			.toBe(sameStringContract.id)
		expect(text)
			.not.toHaveProperty('valueContract')
		expect(text)
			.not.toHaveProperty('compute')
	})

	it('distinguishes absent capabilities from explicitly declared empty capabilities', () => {
		const absent = createWidgetPlugin('inspection-absent-members')
			.description('Absent members')
			.interfaces<Record<never, never>>()
			.done()
		const empty = createWidgetPlugin('inspection-empty-members')
			.description('Empty members')
			.interfaces<{
			state: Record<never, never>
			properties: Record<never, never>
			events: Record<never, never>
		}>()
			.state(state => state)
			.properties(properties => properties)
			.events(events => events)
			.done()

		expect(inspectPlugin(absent).state)
			.toBeNull()
		expect(inspectPlugin(absent).properties)
			.toBeNull()
		expect(inspectPlugin(absent).events)
			.toBeNull()
		expect(inspectPlugin(empty).state?.size)
			.toBe(0)
		expect(inspectPlugin(empty).properties?.size)
			.toBe(0)
		expect(inspectPlugin(empty).events?.size)
			.toBe(0)
	})

	it('preserves declaration order and arbitrary JavaScript-special member names', () => {
		interface SpecialInterfaces {
			state: {
				__proto__: number
				constructor: number
			}
			properties: {
				__proto__: string
				constructor: string
			}
			events: {
				__proto__: []
				constructor: []
			}
		}

		const special = createWidgetPlugin('inspection-special-names')
			.description('Special-name fixture')
			.interfaces<SpecialInterfaces>()
			.state(state => state[PROTO_KEY]({ validate: (input): input is number => typeof input === 'number' })
				.constructor({ validate: (input): input is number => typeof input === 'number' }))
			.properties(properties => properties[PROTO_KEY]({ valueContract: stringContract, compute: () => '__proto__' })
				.constructor({ valueContract: stringContract, compute: () => 'constructor' }))
			.events(events => events[PROTO_KEY]({ description: 'Prototype event' })
				.constructor({ description: 'Constructor event' }))
			.done()
		const inspection = inspectPlugin(special)

		expect([...inspection.state!.keys()])
			.toEqual(['__proto__', 'constructor'])
		expect([...inspection.properties!.keys()])
			.toEqual(['__proto__', 'constructor'])
		expect([...inspection.events!.keys()])
			.toEqual(['__proto__', 'constructor'])
	})

	it('projects the same declaration facts through Blueprint inspection without evaluating Properties', () => {
		computeCalls = 0
		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'plugin-inspection' })
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)
		if (root === null || !root.resolved)
			throw new Error('test fixture: expected a resolved root')

		expect(root.state)
			.toEqual([
				{ type: 'state', name: 'authorVisible', authorWritable: true },
				{ type: 'state', name: 'internal', authorWritable: false },
			])
		expect(root.properties.map(({ type, name, valueContractId }) => ({ type, name, valueContractId })))
			.toEqual([
				{ type: 'property', name: 'text', valueContractId: 'example/string' },
				{ type: 'property', name: 'translated', valueContractId: 'example/translation-result' },
				{ type: 'property', name: 'untyped', valueContractId: null },
			])
		expect(root.events)
			.toEqual([{ type: 'event', name: 'changed', description: 'Value changed' }])
		expect(computeCalls)
			.toBe(0)
	})
})
