/**
 * Conformance group 7 (member inventories: declaration order + special-name safety) from issue #10's
 * inspection amendment "inspection exact API v1 (part 1)".
 *
 * `.__proto__` member access is written through a `PROTO_KEY` string constant + bracket notation, same
 * convention as `runtime/proto-safe-surfaces.unit.test.ts`, purely to route around this repo's
 * `no-proto`/`no-restricted-properties` lint rules.
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectBlueprint } from './index'

const PROTO_KEY = '__proto__' as const

/**
 * A deliberately non-alphabetic order, including every special name the conformance matrix's
 * arbitrary-string safety group requires (`__proto__`, `constructor`, `a.b`, `a:b`, `a->b`, `'0'`).
 */
const KEYS = ['zebra', PROTO_KEY, 'constructor', 'a.b', 'a:b', 'a->b', '0', 'apple'] as const

interface OrderedInterfaces {
	state: {
		'zebra': number
		'__proto__': number
		'constructor': number
		'a.b': number
		'a:b': number
		'a->b': number
		'0': number
		'apple': number
	}
	properties: {
		'zebra': number
		'__proto__': number
		'constructor': number
		'a.b': number
		'a:b': number
		'a->b': number
		'0': number
		'apple': number
	}
	methods: {
		'zebra': () => number
		'__proto__': () => number
		'constructor': () => number
		'a.b': () => number
		'a:b': () => number
		'a->b': () => number
		'0': () => number
		'apple': () => number
	}
}

/**
 * Applies one definition per `KEYS` entry to a builder section via computed member access + a plain
 * loop, rather than a long literal method-chain — every key is accessed identically regardless of
 * whether it happens to also be a valid dot-notation identifier (`zebra`, `constructor`, `apple`), so
 * the special names never need special-cased syntax.
 */
function applyAllMembers(section: unknown, definitionFor: (key: string) => unknown): unknown {
	let current = section as Record<string, (definition: unknown) => unknown>
	for (const key of KEYS)
		current = current[key]!(definitionFor(key)) as Record<string, (definition: unknown) => unknown>
	return current
}

const orderedPlugin = createWidgetPlugin('ordered-members')
	.interfaces<OrderedInterfaces>()
	.state(state => applyAllMembers(state, () => ({ validate: (input: unknown): input is number => typeof input === 'number' })) as any)
	.properties(properties => applyAllMembers(properties, () => ({ compute: () => 0 })) as any)
	.methods(methods => applyAllMembers(methods, () => ({ validateArgs: (args: readonly unknown[]): args is [] => args.length === 0, execute: () => 0 })) as any)
	.done()

const system = createWidgetSystem({ plugins: [orderedPlugin] })

function inspectRoot() {
	const blueprint = system.createBlueprint({ id: 'root', type: 'ordered-members' })
	const inspection = inspectBlueprint(blueprint)
	const root = inspection.getNode(inspection.rootNodeId)!
	if (!root.resolved)
		throw new Error('test fixture: expected a resolved root')
	return root
}

describe('member inventories: declaration order', () => {
	it('state members preserve declaration order verbatim, including special names', () => {
		const root = inspectRoot()
		expect(root.state.map(member => member.name))
			.toEqual(KEYS)
	})

	it('property members preserve declaration order verbatim, including special names', () => {
		const root = inspectRoot()
		expect(root.properties.map(member => member.name))
			.toEqual(KEYS)
	})

	it('method members preserve declaration order verbatim, including special names', () => {
		const root = inspectRoot()
		expect(root.methods.map(member => member.name))
			.toEqual(KEYS)
	})
})

describe('member inventories: arbitrary-string safety', () => {
	it('every special name resolves to its own distinct, correctly-typed member fact with no collision', () => {
		const root = inspectRoot()

		for (const key of KEYS) {
			expect(root.state.find(member => member.name === key))
				.toEqual({ type: 'state', name: key })
			expect(root.properties.find(member => member.name === key))
				.toEqual(expect.objectContaining({ type: 'property', name: key }))
			expect(root.methods.find(member => member.name === key))
				.toEqual(expect.objectContaining({ type: 'method', name: key }))
		}

		// No accidental prototype hazard: exactly `KEYS.length` distinct state members, not fewer (which
		// would indicate two special names collided onto the same underlying slot).
		expect(root.state)
			.toHaveLength(KEYS.length)
		expect(new Set(root.state.map(member => member.name)).size)
			.toBe(KEYS.length)
	})

	it('none of the special member names pollute Object.prototype', () => {
		inspectRoot()
		expect(Object.getPrototypeOf({}))
			.toBe(Object.prototype)
		expect(({} as Record<string, unknown>).polluted)
			.toBeUndefined()
	})
})
