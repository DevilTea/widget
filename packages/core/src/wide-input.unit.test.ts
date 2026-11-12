/**
 * Wide input — far more keys, elements or diagnostics than an engine accepts as call arguments — must
 * compile, separate and patch to diagnostics or operation failures, never a `RangeError`. Answering
 * whether a value is inside the JSON domain stops at the first violation instead of diagnosing the rest.
 *
 * The sizes are about twice the argument count at which Node 24's default stack rejects
 * `array.push(...items)`, so a spread of the diagnostics into one call would throw here.
 */

import type { JsonValue, WidgetInterfaces } from './index'
import { describe, expect, it } from 'vitest'
import { createWidgetDocument, createWidgetPlugin, createWidgetSystem, isJsonValue, separateWidgetSource } from './index'

const WIDE = 2 ** 18

interface NoteInterfaces extends WidgetInterfaces {
	config: {
		raw: Record<string, JsonValue> | null
		resolved: Record<string, JsonValue>
	}
}

const notePlugin = createWidgetPlugin('note')
	.description('Test widget')
	.interfaces<NoteInterfaces>()
	.config({
		description: 'Test config',
		validate: (_input): _input is Record<string, JsonValue> | null => true,
		resolve: raw => raw ?? {},
	})
	.done()

const leafPlugin = createWidgetPlugin('leaf')
	.description('Test widget')
	.interfaces()
	.done()

const system = createWidgetSystem({ plugins: [notePlugin, leafPlugin] })

function nodeWithUnknownKeys(count: number): Record<string, unknown> {
	const node: Record<string, unknown> = { id: 'root', type: 'leaf' }
	for (let index = 0; index < count; index++)
		node[`x${index}`] = 1
	return node
}

/**
 * An Array of `length` zeros, except `undefined` (outside the JSON domain) at `badIndex`, behind a Proxy
 * that counts how many element descriptors the caller inspects.
 */
function countingArray(length: number, badIndex: number) {
	const target: unknown[] = Array.from({ length })
		.fill(0)
	target[badIndex] = undefined
	const counter = { descriptorReads: 0 }
	const proxy = new Proxy(target, {
		getOwnPropertyDescriptor(object, key) {
			if (key !== 'length')
				counter.descriptorReads++
			return Reflect.getOwnPropertyDescriptor(object, key)
		},
	})
	return { proxy, counter }
}

describe('compilation of wide input', () => {
	it('reports one unexpected-widget-field per unknown key of a very wide node', () => {
		const blueprint = system.createBlueprint(nodeWithUnknownKeys(WIDE))

		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.diagnostics)
			.toHaveLength(WIDE)
		expect(blueprint.diagnostics.every(diagnostic => diagnostic.code === 'unexpected-widget-field'))
			.toBe(true)
		expect(blueprint.root.diagnostics)
			.toHaveLength(WIDE)
	})

	it('reports the same diagnostics through createBlueprintFromJson', () => {
		const blueprint = system.createBlueprintFromJson(JSON.stringify(nodeWithUnknownKeys(WIDE)))

		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.diagnostics)
			.toHaveLength(WIDE)
	})

	it('reports one json-incompatible-value per element of a very wide config Array outside the domain', () => {
		// Growing `length` leaves holes; `Array.from({ length })` holds `undefined` elements.
		const sparse: unknown[] = []
		sparse.length = WIDE
		const holes = system.createBlueprint({ id: 'root', type: 'note', config: { a: sparse } })
		const undefinedElements = system.createBlueprint({ id: 'root', type: 'note', config: { a: Array.from({ length: WIDE }) } })

		expect(holes.sourceJsonCompatible)
			.toBe(false)
		expect(holes.diagnostics)
			.toHaveLength(WIDE)
		expect(holes.diagnostics[WIDE - 1])
			.toMatchObject({ code: 'json-incompatible-value', path: ['config', 'a', WIDE - 1], reason: 'sparse-array' })
		expect(undefinedElements.diagnostics)
			.toHaveLength(WIDE)
		expect(undefinedElements.diagnostics[0])
			.toMatchObject({ code: 'json-incompatible-value', path: ['config', 'a', 0], reason: 'undefined' })
	})

	it('separates a very wide node without throwing', () => {
		expect(separateWidgetSource(nodeWithUnknownKeys(WIDE)).diagnostics)
			.toHaveLength(WIDE)
	})
})

describe('the JSON-domain check answers at the first violation', () => {
	it('isJsonValue stops inspecting elements after the first one outside the domain', () => {
		const { proxy, counter } = countingArray(10_000, 1)

		expect(isJsonValue(proxy))
			.toBe(false)
		expect(counter.descriptorReads)
			.toBe(2)
	})

	it('a SourcePatch operand fails at its first offending part without diagnosing the rest', () => {
		const document = createWidgetDocument({ system, source: { id: 'root', type: 'note', config: {} } })
		const { proxy, counter } = countingArray(10_000, 3)

		expect(document.applyPatch([{ op: 'add', path: '/config/a', value: proxy as never }]))
			.toEqual({ ok: false, failure: expect.objectContaining({ code: 'json-incompatible-value', operationIndex: 0, path: [3], reason: 'undefined' }) })
		expect(counter.descriptorReads)
			.toBe(4)
	})
})
