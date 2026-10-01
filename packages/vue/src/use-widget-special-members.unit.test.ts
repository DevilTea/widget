// @vitest-environment happy-dom

import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { mountWidgetBridge } from './test-fixtures'

const PROTO_KEY = '__proto__' as const
const CONSTRUCTOR_KEY = 'constructor' as const

interface SpecialMemberInterfaces {
	state: {
		__proto__: number
	}
	properties: {
		__proto__: number
	}
	methods: {
		constructor: () => string
	}
}

const SpecialMemberPlugin = createWidgetPlugin('SpecialMemberProjection')
	.description('Prototype-sensitive useWidget member projection fixture')
	.interfaces<SpecialMemberInterfaces>()
	.state(state => state[PROTO_KEY]({
		validate: (input): input is number => typeof input === 'number',
		default: () => 1,
	}))
	.properties(properties => properties[PROTO_KEY]({
		registerDeps: ({ dep }) => ({ stateValue: dep.self.state.get(PROTO_KEY) }),
		compute: ({ deps }) => {
			const stateValue = deps.stateValue()
			return stateValue.ok && typeof stateValue.value === 'number' ? stateValue.value * 2 : -1
		},
	}))
	.methods(methods => methods[CONSTRUCTOR_KEY]({
		validateArgs: (args): args is [] => args.length === 0,
		execute: () => 'constructor method invoked',
	}))
	.done()

function createSpecialMemberRuntime() {
	const system = createWidgetSystem({ plugins: [SpecialMemberPlugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: SpecialMemberPlugin.type })
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

	return blueprint.createRuntime()
}

describe('useWidget() with prototype-sensitive Core member names', () => {
	it('reads and writes a Core-backed __proto__ state member through useState() bracket access', () => {
		const runtime = createSpecialMemberRuntime()
		const { wrapper, bridge } = mountWidgetBridge(runtime, 'root', SpecialMemberPlugin)

		const state = bridge.useState()[PROTO_KEY]
		expect(state.value)
			.toBe(1)

		state.value = 7
		expect(state.value)
			.toBe(7)
		wrapper.unmount()
	})

	it('reads the Core-backed __proto__ property projection through useProperties() bracket access', () => {
		const runtime = createSpecialMemberRuntime()
		const { wrapper, bridge } = mountWidgetBridge(runtime, 'root', SpecialMemberPlugin)

		const property = bridge.useProperties()[PROTO_KEY]
		expect(property.value)
			.toBe(2)
		wrapper.unmount()
	})

	it('invokes the Core-backed constructor method through useMethods() bracket access', () => {
		const runtime = createSpecialMemberRuntime()
		const { wrapper, bridge } = mountWidgetBridge(runtime, 'root', SpecialMemberPlugin)

		const constructorMethod = bridge.useMethods()[CONSTRUCTOR_KEY]
		expect(constructorMethod())
			.toBe('constructor method invoked')
		wrapper.unmount()
	})
})
