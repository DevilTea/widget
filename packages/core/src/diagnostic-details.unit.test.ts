/**
 * Conformance coverage for `Interfaces['reasons']` and diagnostic `details` (Discussion #12, "Interfaces are
 * the single source of a plugin's shape and documentation (0.3.0)", Core API item 5): `reason` and `details`
 * of every plugin-authored diagnostic input are typed by the declaration, `details` must be a JSON value, and
 * the diagnostics carry it through Blueprint, Runtime and inspection.
 *
 * Only public entries are imported.
 */

import type {
	BlueprintConfigDiagnostic,
	BlueprintStructureDiagnostic,
	JsonValue,
	RelativeSystemStructureDiagnosticInput,
	RuntimeMethodArgsDiagnostic,
	RuntimeMethodResultDiagnostic,
	RuntimePropertyResultDiagnostic,
	RuntimeStateDiagnostic,
	WidgetChild,
	WidgetConfigValidateContext,
	WidgetInterfacesViolationOf,
	WidgetMethodExecuteContext,
	WidgetMethodValidateArgsContext,
	WidgetPluginValidateStructureContext,
	WidgetPropertyComputeContext,
	WidgetSlotValidateStructureContext,
	WidgetStateValidateContext,
} from './index'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from './index'
import { inspectBlueprint } from './inspection/index'

interface TooLarge {
	readonly limit: number
	readonly received: number
}

interface CounterInterfaces {
	config: {
		raw: { readonly limit: number } | null
		resolved: { readonly limit: number }
	}
	slots: { items: WidgetChild }
	state: { count: number }
	properties: { doubled: number }
	methods: { add: (amount: number) => number }
	reasons: {
		/** The value is above the configured limit. */
		'too-large': TooLarge
		/** The value is not a number. */
		'not-a-number': void
		/** The slot holds more children than it accepts. */
		'too-many': { readonly max: number }
	}
}

interface PlainInterfaces {
	state: { count: number }
}

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

describe('declared reasons type `reason` and `details` of every plugin-authored diagnostic input', () => {
	it('accepts a declared reason with its payload, and rejects everything else', () => {
		// Never called: the rejected inputs below would be recorded (or throw) at run time.
		const typeOnly = (ctx: WidgetStateValidateContext<CounterInterfaces>) => {
			ctx.addDiagnostic({ message: 'no reason' })
			ctx.addDiagnostic({ message: 'no payload', reason: 'not-a-number' })
			ctx.addDiagnostic({ message: 'payload', reason: 'too-large', details: { limit: 1, received: 2 } })
			ctx.addDiagnostic({ message: 'payload', path: ['a', 0], reason: 'too-many', details: { max: 2 } })
			// @ts-expect-error 'other' is not a declared reason
			ctx.addDiagnostic({ message: 'unknown reason', reason: 'other' })
			// @ts-expect-error 'too-large' requires its payload
			ctx.addDiagnostic({ message: 'missing payload', reason: 'too-large' })
			// @ts-expect-error a `void` reason forbids `details`
			ctx.addDiagnostic({ message: 'forbidden payload', reason: 'not-a-number', details: 1 })
			// @ts-expect-error the payload is the one of 'too-large', not of 'too-many'
			ctx.addDiagnostic({ message: 'wrong payload', reason: 'too-large', details: { max: 2 } })
			// @ts-expect-error `details` needs a `reason`
			ctx.addDiagnostic({ message: 'payload without reason', details: { max: 2 } })
		}
		expect(typeOnly)
			.toBeTypeOf('function')
	})

	it('types every callback context that collects diagnostics the same way', () => {
		type Input<Context> = Context extends { addDiagnostic: (diagnostic: infer Diagnostic) => void } ? Diagnostic : never
		type ReasonOf<Context> = Input<Context> extends infer Diagnostic ? Diagnostic extends { readonly reason?: infer Reason } ? Reason : never : never
		type Declared = 'too-large' | 'not-a-number' | 'too-many' | undefined

		expectTypeOf<ReasonOf<WidgetConfigValidateContext<CounterInterfaces>>>()
			.toEqualTypeOf<Declared>()
		expectTypeOf<ReasonOf<WidgetStateValidateContext<CounterInterfaces>>>()
			.toEqualTypeOf<Declared>()
		expectTypeOf<ReasonOf<WidgetMethodValidateArgsContext<CounterInterfaces>>>()
			.toEqualTypeOf<Declared>()
		expectTypeOf<ReasonOf<WidgetPropertyComputeContext<CounterInterfaces, Record<never, never>>>>()
			.toEqualTypeOf<Declared>()
		expectTypeOf<ReasonOf<WidgetMethodExecuteContext<CounterInterfaces, 'add', Record<never, never>>>>()
			.toEqualTypeOf<Declared>()
		expectTypeOf<ReasonOf<WidgetSlotValidateStructureContext<CounterInterfaces, 'items'>>>()
			.toEqualTypeOf<Declared>()
		expectTypeOf<ReasonOf<WidgetPluginValidateStructureContext<CounterInterfaces>>>()
			.toEqualTypeOf<Declared>()
	})

	it('keeps `reason: string` and a JSON `details` when `reasons` is not declared', () => {
		const typeOnly = (ctx: WidgetStateValidateContext<PlainInterfaces>, loose: WidgetConfigValidateContext) => {
			ctx.addDiagnostic({ message: 'free reason', reason: 'anything' })
			ctx.addDiagnostic({ message: 'free payload', reason: 'anything', details: { list: [1, 'two', null] } })
			ctx.addDiagnostic({ message: 'payload without reason', details: 1 })
			loose.addDiagnostic({ message: 'free payload', reason: 'anything', details: [true] })
			// @ts-expect-error a function is not a JSON value
			ctx.addDiagnostic({ message: 'not JSON', reason: 'anything', details: () => 1 })
			// @ts-expect-error `undefined` inside an array is not a JSON value
			ctx.addDiagnostic({ message: 'not JSON', details: [undefined] })
		}
		expect(typeOnly)
			.toBeTypeOf('function')
	})

	it('keeps the System-level validator on `reason: string` and a JSON `details`', () => {
		expectTypeOf<RelativeSystemStructureDiagnosticInput['reason']>()
			.toEqualTypeOf<string | undefined>()
		expectTypeOf<RelativeSystemStructureDiagnosticInput['details']>()
			.toEqualTypeOf<JsonValue | undefined>()
	})

	it('accepts an explicitly empty `reasons` declaration, which leaves no reason to report', () => {
		const typeOnly = (ctx: WidgetStateValidateContext<{ state: { count: number }, reasons: Record<never, never> }>) => {
			ctx.addDiagnostic({ message: 'no reason' })
			// @ts-expect-error no reason is declared
			ctx.addDiagnostic({ message: 'a reason', reason: 'anything' })
		}
		expect(typeOnly)
			.toBeTypeOf('function')
	})

	it('rejects a `reasons` declaration whose payload is not a JSON value, or whose keys are not finite', () => {
		expectTypeOf<WidgetInterfacesViolationOf<{ reasons: { late: Date } }>>()
			.toEqualTypeOf<'\'reasons\' payloads must be JSON values (or void for none)'>()
		expectTypeOf<WidgetInterfacesViolationOf<{ reasons: { late: () => void } }>>()
			.toEqualTypeOf<'\'reasons\' payloads must be JSON values (or void for none)'>()
		expectTypeOf<WidgetInterfacesViolationOf<{ reasons: Record<string, void> }>>()
			.toEqualTypeOf<'\'reasons\' must not be declared with a broad string index signature'>()
		expectTypeOf<WidgetInterfacesViolationOf<CounterInterfaces>>()
			.toEqualTypeOf<never>()
	})

	it('types `details` on the diagnostics that carry a plugin-authored reason', () => {
		expectTypeOf<BlueprintConfigDiagnostic['details']>()
			.toEqualTypeOf<JsonValue | undefined>()
		expectTypeOf<BlueprintStructureDiagnostic['details']>()
			.toEqualTypeOf<JsonValue | undefined>()
		expectTypeOf<RuntimeStateDiagnostic['details']>()
			.toEqualTypeOf<JsonValue | undefined>()
		expectTypeOf<RuntimePropertyResultDiagnostic['details']>()
			.toEqualTypeOf<JsonValue | undefined>()
		expectTypeOf<RuntimeMethodArgsDiagnostic['details']>()
			.toEqualTypeOf<JsonValue | undefined>()
		expectTypeOf<RuntimeMethodResultDiagnostic['details']>()
			.toEqualTypeOf<JsonValue | undefined>()
	})

	it('does not make `reasons` a capability', () => {
		const plugin = createWidgetPlugin('reasons-only')
			.interfaces<{ reasons: { late: void } }>()
			.done()

		expect(plugin.capabilities)
			.toEqual({ config: false, slots: false, state: false, properties: false, methods: false, events: false })
		expect(plugin.capabilities).not.toHaveProperty('reasons')
	})
})

// -------------------------------------------------------------------------------------------------
// Harness
// -------------------------------------------------------------------------------------------------

function createHarness() {
	const flags = { computeFails: false, executeFails: false }

	const item = createWidgetPlugin('item')
		.interfaces<Record<never, never>>()
		.done()

	const counter = createWidgetPlugin('counter')
		.interfaces<CounterInterfaces>()
		.config({
			validate: (input, ctx): input is { readonly limit: number } | null => {
				if (input === null)
					return true
				const limit = (input as { readonly limit?: unknown }).limit
				if (typeof limit !== 'number') {
					ctx.addDiagnostic({ message: 'limit must be a number', path: ['limit'], reason: 'not-a-number' })
					return false
				}
				if (limit > 100) {
					ctx.addDiagnostic({ message: 'limit is too large', path: ['limit'], reason: 'too-large', details: { limit: 100, received: limit } })
					return false
				}
				return true
			},
			resolve: raw => ({ limit: raw?.limit ?? 10 }),
		})
		.slots({
			items: {
				validateStructure: (ctx) => {
					if (ctx.children.length > 2)
						ctx.addDiagnostic({ message: 'too many items', index: 2, reason: 'too-many', details: { max: 2 } })
				},
			},
		})
		.structure((ctx) => {
			if (ctx.widget.slots.items.length > 2)
				ctx.addDiagnostic({ message: 'the counter holds too many items', slot: 'items', reason: 'too-many', details: { max: 2 } })
		})
		.state(state => state.count({
			validate: (input, ctx): input is number => {
				if (typeof input !== 'number') {
					ctx.addDiagnostic({ message: 'count must be a number', reason: 'not-a-number' })
					return false
				}
				if (input > ctx.config.limit) {
					ctx.addDiagnostic({ message: 'count is too large', reason: 'too-large', details: { limit: ctx.config.limit, received: input } })
					return false
				}
				return true
			},
			default: () => 0,
		}))
		.properties(properties => properties.doubled({
			compute: (ctx) => {
				if (flags.computeFails)
					ctx.addDiagnostic({ message: 'doubled is too large', reason: 'too-large', details: { limit: ctx.config.limit, received: 999 } })
				return 0
			},
		}))
		.methods(methods => methods.add({
			validateArgs: (args, ctx): args is [number] => {
				if (typeof args[0] !== 'number') {
					ctx.addDiagnostic({ message: 'amount must be a number', path: [0], reason: 'not-a-number' })
					return false
				}
				if (args[0] > ctx.config.limit) {
					ctx.addDiagnostic({ message: 'amount is too large', path: [0], reason: 'too-large', details: { limit: ctx.config.limit, received: args[0] } })
					return false
				}
				return true
			},
			execute: (ctx) => {
				if (flags.executeFails)
					ctx.addDiagnostic({ message: 'the sum is too large', reason: 'too-large', details: { limit: ctx.config.limit, received: ctx.args[0] } })
				return ctx.args[0]
			},
		}))
		.done()

	const system = createWidgetSystem({
		plugins: [counter, item],
		validateStructure: (ctx) => {
			const root = ctx.blueprint.root
			if (root.resolved && root.type === 'counter' && root.slots.items.length === 1)
				ctx.addDiagnostic({ message: 'a single item is suspicious', location: { type: 'widget', node: root }, reason: 'lonely', details: { count: 1, tags: ['system'] } })
		},
	})

	function createRuntime() {
		const blueprint = system.createBlueprint({ id: 'root', type: 'counter' })
		if (blueprint.status !== 'valid')
			throw new Error(`test fixture: expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics.map(diagnostic => diagnostic.code))}`)
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null || widget.type !== 'counter')
			throw new Error('test fixture: expected the counter widget')
		return { runtime, widget }
	}

	return { flags, system, createRuntime }
}

const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, type: 'item' }))

// -------------------------------------------------------------------------------------------------
// Blueprint
// -------------------------------------------------------------------------------------------------

describe('blueprint diagnostics carry `details`', () => {
	it('carries the details of a config diagnostic, and omits the field when none was reported', () => {
		const { system } = createHarness()

		const tooLarge = system.createBlueprint({ id: 'root', type: 'counter', config: { limit: 500 } })
		expect(tooLarge.diagnostics)
			.toHaveLength(1)
		expect(tooLarge.diagnostics[0])
			.toMatchObject({ code: 'invalid-widget-config', path: ['limit'], reason: 'too-large', details: { limit: 100, received: 500 } })

		const notANumber = system.createBlueprint({ id: 'root', type: 'counter', config: { limit: 'ten' } })
		expect(notANumber.diagnostics)
			.toHaveLength(1)
		expect(notANumber.diagnostics[0])
			.toMatchObject({ code: 'invalid-widget-config', reason: 'not-a-number' })
		expect(notANumber.diagnostics[0]).not.toHaveProperty('details')
	})

	it('carries the details of slot, plugin and System structure diagnostics', () => {
		const { system } = createHarness()

		const crowded = system.createBlueprint({ id: 'root', type: 'counter', slots: { items: items(3) } })
		const structure = crowded.diagnostics.filter(diagnostic => diagnostic.code === 'invalid-widget-structure')
		expect(structure)
			.toMatchObject([
				{ location: { type: 'slot-child', slot: 'items', index: 2 }, reason: 'too-many', details: { max: 2 } },
				{ location: { type: 'slot', slot: 'items' }, reason: 'too-many', details: { max: 2 } },
			])

		const lonely = system.createBlueprint({ id: 'root', type: 'counter', slots: { items: items(1) } })
		expect(lonely.diagnostics)
			.toHaveLength(1)
		expect(lonely.diagnostics[0])
			.toMatchObject({ code: 'invalid-widget-structure', reason: 'lonely', details: { count: 1, tags: ['system'] } })
	})

	it('exposes the same diagnostics, details included, through Blueprint inspection', () => {
		const { system } = createHarness()
		const blueprint = system.createBlueprint({ id: 'root', type: 'counter', config: { limit: 500 } })
		const inspection = inspectBlueprint(blueprint)
		const inspected = inspection.getNode(inspection.rootNodeId)
		if (inspected === null)
			throw new Error('expected the inspected root')

		expect(inspected.node)
			.toBe(blueprint.root)
		expect(inspected.node.diagnostics.find(diagnostic => diagnostic.code === 'invalid-widget-config'))
			.toMatchObject({ reason: 'too-large', details: { limit: 100, received: 500 } })
	})
})

// -------------------------------------------------------------------------------------------------
// Runtime
// -------------------------------------------------------------------------------------------------

describe('runtime diagnostics carry `details`', () => {
	it('carries the details of a State validation diagnostic in the result and in the snapshot', () => {
		const { createRuntime } = createHarness()
		const { runtime, widget } = createRuntime()

		const result = widget.state.count.set(11)
		if (result.ok)
			throw new Error('expected the write to be rejected')
		expect(result.failure.diagnostics)
			.toHaveLength(1)
		expect(result.failure.diagnostics[0])
			.toMatchObject({ code: 'invalid-state-value', candidate: 11, reason: 'too-large', details: { limit: 10, received: 11 } })
		expect(widget.state.count.getDiagnostics())
			.toEqual(result.failure.diagnostics)
		expect(runtime.getDiagnostics())
			.toEqual(result.failure.diagnostics)

		const untyped = widget.state.count.set('eleven' as never)
		if (untyped.ok)
			throw new Error('expected the write to be rejected')
		expect(untyped.failure.diagnostics[0])
			.toMatchObject({ code: 'invalid-state-value', reason: 'not-a-number' })
		expect(untyped.failure.diagnostics[0]).not.toHaveProperty('details')
	})

	it('carries the details of a Property result diagnostic', () => {
		const { flags, createRuntime } = createHarness()
		const { widget } = createRuntime()
		flags.computeFails = true

		const result = widget.properties.doubled.get()
		if (result.ok)
			throw new Error('expected the read to fail')
		expect(result.failure.diagnostics[0])
			.toMatchObject({ code: 'invalid-property-result', reason: 'too-large', details: { limit: 10, received: 999 } })
		expect(widget.getDiagnostics())
			.toEqual(result.failure.diagnostics)
	})

	it('carries the details of Method argument and result diagnostics', () => {
		const { flags, createRuntime } = createHarness()
		const { widget } = createRuntime()

		const rejected = widget.methods.add(50)
		if (rejected.ok)
			throw new Error('expected the arguments to be rejected')
		expect(rejected.failure.diagnostics[0])
			.toMatchObject({ code: 'invalid-method-arguments', path: [0], reason: 'too-large', details: { limit: 10, received: 50 } })

		flags.executeFails = true
		const failed = widget.methods.add(3)
		if (failed.ok)
			throw new Error('expected the invocation to fail')
		expect(failed.failure.diagnostics[0])
			.toMatchObject({ code: 'invalid-method-result', reason: 'too-large', details: { limit: 10, received: 3 } })
		expect(widget.methods.add.getDiagnostics())
			.toEqual(failed.failure.diagnostics)
	})
})

// -------------------------------------------------------------------------------------------------
// Contract violations
// -------------------------------------------------------------------------------------------------

describe('a non-JSON `details` is a contract violation', () => {
	const cyclic: Record<string, unknown> = {}
	cyclic.self = cyclic
	const notJson: readonly unknown[] = [() => 1, Number.NaN, 1n, Symbol('details'), new Date(0), { nested: undefined }, [undefined], cyclic]

	function createUntypedSystem(details: unknown, where: 'config' | 'slot' | 'plugin' | 'system' | 'state' | 'compute' | 'args' | 'execute') {
		const report = (ctx: { addDiagnostic: (diagnostic: never) => void }, extra: Record<string, unknown> = {}) => ctx.addDiagnostic({ message: 'reported', reason: 'any', details, ...extra } as never)
		const plugin = createWidgetPlugin('untyped')
			.interfaces<{
			config: { raw: null, resolved: Record<never, never> }
			slots: { items: WidgetChild }
			state: { count: number }
			properties: { total: number }
			methods: { run: () => void }
		}>()
			.config({
				validate: (input, ctx): input is null => {
					if (where === 'config')
						report(ctx)
					return input === null
				},
				resolve: () => ({}),
			})
			.slots({
				items: {
					validateStructure: (ctx) => {
						if (where === 'slot')
							report(ctx)
					},
				},
			})
			.structure((ctx) => {
				if (where === 'plugin')
					report(ctx)
			})
			.state(state => state.count({
				validate: (input, ctx): input is number => {
					// Only the write under test reports: the default (0) is validated when the Runtime is created.
					if (where === 'state' && input === 1)
						report(ctx)
					return typeof input === 'number'
				},
				default: () => 0,
			}))
			.properties(properties => properties.total({
				compute: (ctx) => {
					if (where === 'compute')
						report(ctx)
					return 0
				},
			}))
			.methods(methods => methods.run({
				validateArgs: (args, ctx): args is [] => {
					if (where === 'args')
						report(ctx)
					return args.length === 0
				},
				execute: (ctx) => {
					if (where === 'execute')
						report(ctx)
				},
			}))
			.done()

		return createWidgetSystem({
			plugins: [plugin],
			validateStructure: (ctx) => {
				if (where === 'system')
					report(ctx, { location: { type: 'widget', node: ctx.blueprint.root } })
			},
		})
	}

	const source = { id: 'root', type: 'untyped' }

	it('throws a TypeError from every compile-time callback', () => {
		for (const where of ['config', 'slot', 'plugin', 'system'] as const) {
			for (const details of notJson) {
				expect(() => createUntypedSystem(details, where)
					.createBlueprint(source))
					.toThrow(TypeError)
			}
		}
	})

	it('throws a TypeError from Runtime callbacks, and records nothing', () => {
		for (const details of notJson) {
			const stateBlueprint = createUntypedSystem(details, 'state')
				.createBlueprint(source)
			if (stateBlueprint.status !== 'valid')
				throw new Error('expected a valid Blueprint')
			const stateWidget = stateBlueprint.createRuntime()
				.getWidget('root')!
			expect(() => stateWidget.state.count.set(1))
				.toThrow(TypeError)

			const argsBlueprint = createUntypedSystem(details, 'args')
				.createBlueprint(source)
			if (argsBlueprint.status !== 'valid')
				throw new Error('expected a valid Blueprint')
			const argsWidget = argsBlueprint.createRuntime()
				.getWidget('root')!
			expect(() => argsWidget.methods.run())
				.toThrow(TypeError)
			expect(argsWidget.methods.run.getDiagnostics())
				.toEqual([])
		}
	})

	it('names the plugin, the member and the callback that called addDiagnostic', () => {
		const details = () => 1
		const compileTime = [
			['config', /plugin "untyped".*config\.validate/],
			['slot', /plugin "untyped".*Slot "items".*validateStructure/],
			['plugin', /plugin "untyped".*plugin-level validateStructure/],
			['system', /^System-level validateStructure/],
		] as const
		for (const [where, offender] of compileTime) {
			expect(() => createUntypedSystem(details, where)
				.createBlueprint(source))
				.toThrow(offender)
		}

		function createWidget(where: 'state' | 'compute' | 'args' | 'execute') {
			const blueprint = createUntypedSystem(details, where)
				.createBlueprint(source)
			if (blueprint.status !== 'valid')
				throw new Error('expected a valid Blueprint')
			return blueprint.createRuntime()
				.getWidget('root')!
		}
		expect(() => createWidget('state').state.count.set(1))
			.toThrow(/plugin "untyped".*State "count".*validate/)
		expect(() => createWidget('compute').properties.total.get())
			.toThrow(/plugin "untyped".*Property "total".*compute/)
		expect(() => createWidget('args').methods.run())
			.toThrow(/plugin "untyped".*Method "run".*validateArgs/)
		expect(() => createWidget('execute').methods.run())
			.toThrow(/plugin "untyped".*Method "run".*execute/)
	})

	it('accepts every JSON value, `null` included, and treats `undefined` as no details', () => {
		for (const details of [null, 0, '', false, [], {}, { deep: [{ value: 1 }] }]) {
			const blueprint = createUntypedSystem(details, 'config')
				.createBlueprint(source)
			expect(blueprint.diagnostics[0])
				.toMatchObject({ code: 'invalid-widget-config', reason: 'any', details })
		}

		const blueprint = createUntypedSystem(undefined, 'config')
			.createBlueprint(source)
		expect(blueprint.diagnostics[0])
			.toMatchObject({ code: 'invalid-widget-config', reason: 'any' })
		expect(blueprint.diagnostics[0]).not.toHaveProperty('details')
	})
})
