/**
 * Type-level conformance: a semantic callback must not return a PromiseLike/thenable, and ordinary
 * synchronous code always type-checks.
 *
 * Where a callback is written into the builder (`execute`, slot/plugin/system `validateStructure`), the
 * gate checks the callback's own inferred return type, so a `void`, `undefined` or `unknown` declared
 * return rejects an `async` function or any value with a callable `then` alike, while every synchronous
 * value — an `unknown`-typed expression, a value of a type parameter, an object whose `then` is not a
 * function — is accepted. The standalone definition types cannot see the callback's own return type, so
 * they accept every synchronous value and leave the thenable check to the builder and to the runtime
 * guard (the documented hole).
 *
 * Negative assertions use `@ts-expect-error` with a one-line reason.
 */

import type { EmptyRegisteredDeps, ExecutionResult, WidgetInterfaces, WidgetMethodDefinition, WidgetPluginValidateStructure, WidgetSlotDefinition, WidgetSystemValidateStructure } from './index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from './index'

interface VoidInterfaces extends WidgetInterfaces {
	state: { n: number }
	slots: 'items'
	methods: { submit: () => void }
}

interface UnknownInterfaces extends WidgetInterfaces {
	methods: { submit: () => unknown }
}

interface UndefinedInterfaces extends WidgetInterfaces {
	methods: { submit: () => undefined }
}

class Thing {
	run(): void {}
}

const isNumber = (input: unknown): input is number => typeof input === 'number'
const noArgs = (args: readonly unknown[]): args is [] => args.length === 0
const valueOf = (result: ExecutionResult<unknown, unknown>): unknown => result.ok ? result.value : undefined

/** The builder up to its `.methods()` phase, so each test writes `execute` inline. */
function voidMethodsPhase() {
	return createWidgetPlugin('void')
		.description('Test widget')
		.interfaces<VoidInterfaces>()
		.slots({ items: { description: 'Items' } })
		.state(state => state.n({ validate: isNumber }))
}

describe('a void Method\'s execute written into the builder', () => {
	it('accepts every synchronous result', () => {
		const items: number[] = []
		const plugins = [
			voidMethodsPhase()
				.methods(methods => methods.submit({
					validateArgs: noArgs,
					registerDeps: ({ dep }) => ({ n: dep.widget('other').state.get('n') }),
					// An unrefined dependency read is `unknown`.
					execute: ({ deps }) => valueOf(deps.n()),
				}))
				.done(),
			voidMethodsPhase()
				.methods(methods => methods.submit({ validateArgs: noArgs, execute: () => items.push(1) }))
				.done(),
			voidMethodsPhase()
				.methods(methods => methods.submit({ validateArgs: noArgs, execute: () => new Map<string, number>() }))
				.done(),
			voidMethodsPhase()
				.methods(methods => methods.submit({ validateArgs: noArgs, execute: () => new Date() }))
				.done(),
			voidMethodsPhase()
				.methods(methods => methods.submit({ validateArgs: noArgs, execute: () => new Thing() }))
				.done(),
			voidMethodsPhase()
				.methods(methods => methods.submit({ validateArgs: noArgs, execute: () => () => 1 }))
				.done(),
			voidMethodsPhase()
				.methods(methods => methods.submit({ validateArgs: noArgs, execute: () => Symbol('x') }))
				.done(),
			voidMethodsPhase()
				.methods(methods => methods.submit({ validateArgs: noArgs, execute: () => ({ then: 'not-callable' }) }))
				.done(),
		]

		expect(plugins)
			.toHaveLength(8)
	})

	it('accepts a value of a type parameter', () => {
		function create<Value>(value: Value) {
			return createWidgetPlugin('generic')
				.description('Test widget')
				.interfaces<VoidInterfaces>()
				.slots({ items: { description: 'Items', validateStructure: () => value } })
				.structure(() => value)
				.state(state => state.n({ validate: isNumber }))
				.methods(methods => methods.submit({ validateArgs: noArgs, execute: () => value }))
				.done()
		}

		expect(create(1).type)
			.toBe('generic')
	})

	it('rejects an async function and a thenable', () => {
		const asyncPlugin = createWidgetPlugin('async')
			.description('Test widget')
			.interfaces<VoidInterfaces>()
			.slots({ items: { description: 'Items' } })
			.state(state => state.n({ validate: isNumber }))
			.methods(methods => methods.submit({
				validateArgs: noArgs,
				// @ts-expect-error an async execute would write State in its synchronous prefix and fail afterwards
				execute: async () => {},
			}))
		const thenablePlugin = createWidgetPlugin('thenable')
			.description('Test widget')
			.interfaces<VoidInterfaces>()
			.slots({ items: { description: 'Items' } })
			.state(state => state.n({ validate: isNumber }))
			.methods(methods => methods.submit({
				validateArgs: noArgs,
				// @ts-expect-error any value with a callable `then` is a thenable, not only a native Promise
				execute: () => ({ then: (resolve: (value: undefined) => void) => resolve(undefined) }),
			}))

		expect([asyncPlugin, thenablePlugin])
			.toHaveLength(2)
	})
})

describe('a Method declared to return unknown or undefined', () => {
	it('rejects an async execute for an unknown return and accepts synchronous values', () => {
		const opaque: unknown = 1
		const sync = createWidgetPlugin('unknown')
			.description('Test widget')
			.interfaces<UnknownInterfaces>()
			.methods(methods => methods.submit({ validateArgs: noArgs, execute: () => opaque }))
			.done()
		const asyncPlugin = createWidgetPlugin('unknown-async')
			.description('Test widget')
			.interfaces<UnknownInterfaces>()
			// @ts-expect-error `unknown` does not reopen the synchronous boundary
			.methods(methods => methods.submit({ validateArgs: noArgs, execute: async () => 1 }))

		expect([sync, asyncPlugin])
			.toHaveLength(2)
	})

	it('rejects an async execute for an undefined return', () => {
		const sync = createWidgetPlugin('undefined')
			.description('Test widget')
			.interfaces<UndefinedInterfaces>()
			.methods(methods => methods.submit({ validateArgs: noArgs, execute: () => undefined }))
			.done()
		const asyncPlugin = createWidgetPlugin('undefined-async')
			.description('Test widget')
			.interfaces<UndefinedInterfaces>()
			// @ts-expect-error `undefined` does not admit a Promise
			.methods(methods => methods.submit({ validateArgs: noArgs, execute: async () => undefined }))

		expect([sync, asyncPlugin])
			.toHaveLength(2)
	})
})

describe('structure validators written into the builder or the System options', () => {
	it('accept synchronous results, including unknown-typed ones', () => {
		const opaque: unknown = 1
		const plugin = createWidgetPlugin('structure')
			.description('Test widget')
			.interfaces<VoidInterfaces>()
			.slots({ items: { description: 'Items', validateStructure: () => opaque } })
			.structure(ctx => ctx.addDiagnostic({ message: 'sync' }))
			.state(state => state.n({ validate: isNumber }))
			.methods(methods => methods.submit({ validateArgs: noArgs, execute: () => {} }))
			.done()
		const system = createWidgetSystem({ plugins: [plugin], validateStructure: () => opaque })

		expect(system.plugins)
			.toHaveLength(1)
	})

	it('reject an async validator at the slot, plugin and system level', () => {
		const slot = createWidgetPlugin('async-slot')
			.description('Test widget')
			.interfaces<VoidInterfaces>()
			// @ts-expect-error an async slot validator would report diagnostics after compilation ended
			.slots({ items: { description: 'Items', validateStructure: async () => {} } })
		const plugin = createWidgetPlugin('async-plugin')
			.description('Test widget')
			.interfaces<VoidInterfaces>()
			.slots({ items: { description: 'Items' } })
			// @ts-expect-error the plugin-level validator must stay synchronous
			.structure(async () => {})
		// @ts-expect-error the system-level validator must stay synchronous
		const system = createWidgetSystem({ plugins: [], validateStructure: async () => {} })

		expect([slot, plugin, system])
			.toHaveLength(3)
	})
})

describe('the standalone definition types', () => {
	it('accept every synchronous result without seeing the callback\'s own return type', () => {
		type Execute = WidgetMethodDefinition<VoidInterfaces, 'submit', EmptyRegisteredDeps>['execute']
		const opaque: unknown = 1
		function fromTypeParameter<Value>(value: Value): Execute {
			return () => value
		}
		const executes: Execute[] = [
			() => opaque,
			() => ({ then: 'not-callable' }),
			fromTypeParameter(1),
		]
		const slot: WidgetSlotDefinition<VoidInterfaces, 'items'> = { description: 'Items', validateStructure: () => opaque }
		const plugin: WidgetPluginValidateStructure<VoidInterfaces> = () => opaque
		const system: WidgetSystemValidateStructure<[]> = () => opaque

		expect([...executes, slot, plugin, system])
			.toHaveLength(6)
	})
})
