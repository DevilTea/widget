/**
 * The member surfaces of a RuntimeWidget, the `emit` surface and `snapshotState()` list their members in
 * declaration order, whatever the order the members are written or used in.
 */

import type { WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface OrderedInterfaces extends WidgetInterfaces {
	state: { zeta: number, alpha: number, mid: number }
	properties: { pz: number, pa: number }
	methods: { mz: () => null, ma: () => null }
	events: { ez: [], ea: [] }
}

const isNumber = (input: unknown): input is number => typeof input === 'number'

const ordered = createWidgetPlugin('ordered')
	.description('Test widget')
	.interfaces<OrderedInterfaces>()
	.state(state => state
		.zeta({ validate: isNumber, default: () => 1 })
		.alpha({ validate: isNumber, default: () => 2 })
		.mid({ validate: isNumber, default: () => 3 }))
	.properties(properties => properties
		.pz({ compute: () => 1 })
		.pa({ compute: () => 2 }))
	.methods(methods => methods
		.mz({ validateArgs: (args): args is [] => args.length === 0, emits: ['ez', 'ea'], execute: ({ emit }) => {
			emit.ez()
			emit.ea()
			return null
		} })
		.ma({ validateArgs: (args): args is [] => args.length === 0, execute: () => null }))
	.events(events => events
		.ez({ description: 'First event' })
		.ea({ description: 'Second event' }))
	.done()

const system = createWidgetSystem({ plugins: [ordered] })
const compiled = system.createBlueprint({ id: 'root', type: 'ordered' })
if (compiled.status !== 'valid')
	throw new Error('fixture setup error: expected a valid Blueprint')

describe('declaration order of member surfaces', () => {
	it('lists State, Property, Method and Event members in declaration order', () => {
		const runtime = compiled.createRuntime()
		const widget = runtime.getWidget('root')!
		widget.state.mid.set(9)
		widget.state.zeta.set(8)

		expect(Object.keys(widget.state))
			.toEqual(['zeta', 'alpha', 'mid'])
		expect(Object.keys(widget.properties))
			.toEqual(['pz', 'pa'])
		expect(Object.keys(widget.methods))
			.toEqual(['mz', 'ma'])
		expect(Object.keys(widget.events))
			.toEqual(['ez', 'ea'])
		expect(Object.keys(runtime.snapshotState().root!))
			.toEqual(['zeta', 'alpha', 'mid'])
	})

	it('emits and delivers events in the order the Method emits them', () => {
		const runtime = compiled.createRuntime()
		const widget = runtime.getWidget('root')!
		const log: string[] = []
		widget.events.ea.subscribe(() => log.push('ea'))
		widget.events.ez.subscribe(() => log.push('ez'))

		widget.methods.mz()

		expect(log)
			.toEqual(['ez', 'ea'])
	})
})
