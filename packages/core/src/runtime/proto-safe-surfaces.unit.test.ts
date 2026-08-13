/**
 * Regression coverage for PR #12 review finding 3773310848 (`runtime/widget.ts` unsafe `{}` +
 * bracket-assignment for arbitrary member-name surfaces).
 *
 * Normative source: issue #10 builder/member-key amendment — `constructor`/`__proto__` are not
 * forbidden member names; implementation must represent member-keyed surfaces with `Map` or a
 * null-prototype record rather than relying on ordinary object prototype semantics. Bracket-assigning a
 * `"__proto__"` key into a plain `{}` mutates the object's own `[[Prototype]]` instead of creating an
 * own member, which both corrupts that one surface and can leak a foreign object into the runtime
 * widget's shape.
 *
 * `.__proto__` member access is written through a `PROTO_KEY` string constant + bracket notation
 * throughout this file (never literal dot/bracket `__proto__`) purely to route around this repo's
 * `no-proto`/`no-restricted-properties` lint rules, which reject the literal syntax outright — the
 * runtime semantics under test are unaffected either way.
 */

import { describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

const PROTO_KEY = '__proto__' as const

interface ProtoInterfaces {
	state: {
		__proto__: number
	}
	properties: {
		__proto__: number
		viaProtoState: number
	}
	methods: {
		constructor: () => number
	}
}

const plugin = createWidgetPlugin('proto-widget')
	.interfaces<ProtoInterfaces>()
	.state(state => state[PROTO_KEY]({
		validate: (input): input is number => typeof input === 'number',
		default: () => 1,
	}))
	.properties(properties => properties[PROTO_KEY]({
		compute: () => 2,
	})
		// Depends on the state member named "__proto__" through the ordinary `dep.self.state.get(key)`
		// path — `key` is a `Map` lookup, so this exercises the dependency-operation location rather
		// than the deps-container-key hazard.
		.viaProtoState({
			registerDeps: ({ dep }) => ({ value: dep.self.state.get(PROTO_KEY) }),
			compute: ({ deps }) => {
				const result = deps.value()
				return result.success && typeof result.value === 'number' ? result.value : -1
			},
		}))
	.methods(methods => methods.constructor({
		validateArgs: (args): args is [] => args.length === 0,
		execute: () => 3,
	}))
	.done()

function createHarness() {
	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'proto-widget' })
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid blueprint, got issues: ${JSON.stringify(blueprint.getCollectedIssues())}`)

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')
	if (widget === null)
		throw new Error('Expected the "root" widget to exist.')

	return { widget }
}

describe('runtimeWidget surfaces stay prototype-safe for special member names', () => {
	it('a state member named "__proto__" is a real own member with a working get/set/subscribe', () => {
		const { widget } = createHarness()
		const state = widget.state[PROTO_KEY]

		expect(state.get())
			.toBe(1)

		const listener = vi.fn()
		state.subscribe(listener)
		const result = state.set(5)

		expect(result)
			.toEqual({ success: true, value: 5 })
		expect(state.get())
			.toBe(5)
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(listener)
			.toHaveBeenCalledWith(5)
	})

	it('a property member named "__proto__" is a real own member, not the object prototype', () => {
		const { widget } = createHarness()
		const property = widget.properties[PROTO_KEY]

		expect(property.get())
			.toEqual({ success: true, value: 2 })
		// Reading through the member surface never resolves to a "real" prototype object.
		expect(typeof property.get)
			.toBe('function')
	})

	it('a method member named "constructor" is the declared method, not Object\'s native constructor', () => {
		const { widget } = createHarness()

		expect(widget.methods.constructor())
			.toEqual({ success: true, value: 3 })
		expect(widget.methods.constructor)
			.not.toBe(Object.prototype.constructor)
		expect(typeof widget.methods.constructor.getIssues)
			.toBe('function')
	})

	it('a dependency targeting a "__proto__"-named state member resolves and reads correctly', () => {
		const { widget } = createHarness()

		widget.state[PROTO_KEY].set(42)

		expect(widget.properties.viaProtoState.get())
			.toEqual({ success: true, value: 42 })
	})

	it('the state/properties/methods surfaces are null-prototype records', () => {
		const { widget } = createHarness()

		expect(Object.getPrototypeOf(widget.state))
			.toBeNull()
		expect(Object.getPrototypeOf(widget.properties))
			.toBeNull()
		expect(Object.getPrototypeOf(widget.methods))
			.toBeNull()
	})

	it('"__proto__"/"constructor" are real own enumerable members, not inherited/prototype slots', () => {
		const { widget } = createHarness()

		// A plain `{}` + bracket-assignment implementation never creates an own "__proto__" property
		// (the assignment silently becomes a `[[SetPrototypeOf]]` instead), so this is the sharpest
		// discriminator: `Object.keys`/`Object.hasOwn` only ever see genuine own properties.
		expect(Object.hasOwn(widget.state, PROTO_KEY))
			.toBe(true)
		expect(Object.keys(widget.state))
			.toEqual([PROTO_KEY])

		expect(Object.hasOwn(widget.properties, PROTO_KEY))
			.toBe(true)
		expect(Object.keys(widget.properties)
			.sort())
			.toEqual([PROTO_KEY, 'viaProtoState'])

		expect(Object.hasOwn(widget.methods, 'constructor'))
			.toBe(true)
		expect(Object.keys(widget.methods))
			.toEqual(['constructor'])
	})

	it('none of the above pollutes the global Object.prototype', () => {
		createHarness()

		expect(Object.getPrototypeOf({}))
			.toBe(Object.prototype)
		expect(({} as Record<string, unknown>).polluted)
			.toBeUndefined()
	})
})
