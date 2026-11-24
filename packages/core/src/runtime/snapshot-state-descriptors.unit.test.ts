/**
 * `snapshotState()` hands back plain objects whose entries are own, enumerable, writable and configurable
 * data properties, for ordinary keys and for keys that also exist on `Object.prototype` alike.
 */

import type { WidgetChild } from '../types'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, undocumented } from '../index'

interface KeyedInterfaces {
	slots: { children: WidgetChild }
	state: {
		ordinary: number
		constructor: number
		toString: number
		valueOf: number
	}
}

const isNumber = (input: unknown): input is number => typeof input === 'number'

const keyed = createWidgetPlugin('keyed')
	.description(undocumented)
	.interfaces<KeyedInterfaces>()
	.slots({ children: { description: undocumented } })
	.state(state => state
		.ordinary({ description: undocumented, validate: isNumber, default: () => 1 })
		.constructor({ description: undocumented, validate: isNumber, default: () => 2 })
		.toString({ description: undocumented, validate: isNumber, default: () => 3 })
		.valueOf({ description: undocumented, validate: isNumber, default: () => 4 }))
	.done()

const system = createWidgetSystem({ plugins: [keyed] })
const compiled = system.createBlueprint({
	id: 'root',
	type: 'keyed',
	slots: { children: [{ id: 'toString', type: 'keyed' }, { id: '__proto__', type: 'keyed' }, { id: 'ordinary', type: 'keyed' }] },
})
if (compiled.status !== 'valid')
	throw new Error('fixture setup error: expected a valid Blueprint')

const DATA_PROPERTY = { writable: true, enumerable: true, configurable: true }

describe('snapshotState property descriptors', () => {
	it('defines ordinary keys and Object.prototype-named keys as the same kind of own data property', () => {
		const snapshot = compiled.createRuntime()
			.snapshotState()

		expect(Object.getPrototypeOf(snapshot))
			.toBe(Object.prototype)
		const widgetIds = ['root', 'toString', '__proto__', 'ordinary']
		expect(Reflect.ownKeys(snapshot))
			.toEqual(widgetIds)
		for (const widgetId of widgetIds) {
			const values = Object.getOwnPropertyDescriptor(snapshot, widgetId)
			expect(values)
				.toMatchObject(DATA_PROPERTY)

			expect(Object.getPrototypeOf(values?.value))
				.toBe(Object.prototype)
			const keys = Reflect.ownKeys(values?.value as object)
			expect(keys)
				.toEqual(['ordinary', 'constructor', 'toString', 'valueOf'])
			keys.forEach((key, index) => {
				expect(Object.getOwnPropertyDescriptor(values?.value, key))
					.toEqual({ value: index + 1, ...DATA_PROPERTY })
			})
		}
	})

	it('leaves Object.prototype untouched and the entries writable like ordinary properties', () => {
		const values: Record<string, unknown> = compiled.createRuntime()
			.snapshotState()
			.root!

		values.ordinary = 10
		Reflect.set(values, 'toString', 30)
		expect(values.ordinary)
			.toBe(10)
		expect(Object.getOwnPropertyDescriptor(values, 'toString')?.value)
			.toBe(30)
		expect(Object.prototype.toString)
			.toBeTypeOf('function')
		expect(({} as Record<string, unknown>).constructor)
			.toBe(Object)
	})
})
