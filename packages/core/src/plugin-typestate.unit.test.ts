/**
 * Conformance tests — COMMENT 26 §1 type-level contract, plugin builder half.
 *
 * Covers: builder capability-phase ordering (skipped phases for absent capabilities), the section
 * keyed-chain typestate (`state` / `properties` / `methods`), `.done()` gating, and the PromiseLike /
 * MaybePromise rejection rules on `WidgetInterfacesViolationOf`, `compute` and `execute`.
 *
 * Normative source: diagnostic #10 COMMENT 26 §1, COMMENT 0 (checkpoint A), COMMENT 16 (synchronous
 * boundary), COMMENT 22 (`WidgetMemberKey` domain), COMMENT 23 (builder completion typestate).
 *
 * Positive assertions use `expectTypeOf`; negative assertions use `@ts-expect-error` with a one-line
 * reason, each placed so the erroring construct is a real, already-existing runtime value (never a
 * `declare const` that would be read at runtime without a binding).
 */

import type {
	EmptyRegisteredDeps,
	WidgetConfigDefinition,
	WidgetInterfaces,
	WidgetInterfacesViolation,
	WidgetInterfacesViolationOf,
	WidgetMethodDefinition,
	WidgetPluginDonePhase,
	WidgetPropertyDefinition,
	WidgetStateSection,
} from './index'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createWidgetPlugin } from './index'

// -------------------------------------------------------------------------------------------------
// Fixture interfaces
// -------------------------------------------------------------------------------------------------

type EmptyInterfaces = WidgetInterfaces

interface FullInterfaces extends WidgetInterfaces {
	config: {
		raw: { label?: string }
		resolved: { label: string }
	}
	slots: 'header' | 'body'
	state: {
		count: number
		enabled: boolean
	}
	properties: {
		doubled: number
		label: string
	}
	methods: {
		increment: (amount: number) => number
		reset: () => void
	}
}

interface ConfigAndMethodsInterfaces extends WidgetInterfaces {
	config: {
		raw: { x?: number }
		resolved: { x: number }
	}
	methods: {
		run: () => void
	}
}

interface NonJsonConfigInterfaces extends WidgetInterfaces {
	config: {
		raw: { readonly callback: () => void }
		resolved: { readonly label: string }
	}
}

interface KeyedChainInterfaces extends WidgetInterfaces {
	state: {
		'a': number
		'b': string
		'c': boolean
		'display-name': string
	}
}

interface EmptyStateCapabilityInterfaces extends WidgetInterfaces {
	state: Record<never, never>
}

interface EmptyPropertiesCapabilityInterfaces extends WidgetInterfaces {
	properties: Record<never, never>
}

interface EmptyMethodsCapabilityInterfaces extends WidgetInterfaces {
	methods: Record<never, never>
}

/**
 * The canonical explicit-empty slots spelling (diagnostic #10 amendment "declaration-presence semantics and
 * public `WidgetPlugin.capabilities`"). Unlike `state`/`properties`/`methods` (whose empty spelling is
 * the object type `Record<never, never>`), `slots`' own payload domain is a plain string/string-literal
 * union, so its only possible "declared with zero names" spelling is the payload `never` itself — which
 * is exactly why `HasWidgetCapability` must be a declaration-presence predicate and must not merely ask
 * whether the extracted payload is `never`.
 */
interface EmptySlotsCapabilityInterfaces extends WidgetInterfaces {
	slots: never
}

interface AllCapabilitiesInterfaces extends WidgetInterfaces {
	config: {
		raw: Record<string, never>
		resolved: Record<string, never>
	}
	slots: 'a'
	state: {
		s: number
	}
	properties: {
		p: number
	}
	methods: {
		m: () => number
	}
}

declare const symbolStateKey: unique symbol

interface BroadStateIndexInterfaces extends WidgetInterfaces {
	state: Record<string, number>
}

interface NumericStateKeyInterfaces extends WidgetInterfaces {
	state: { 42: number }
}

interface SymbolStateKeyInterfaces extends WidgetInterfaces {
	state: { [symbolStateKey]: number }
}

interface BroadSlotsInterfaces extends WidgetInterfaces {
	slots: string
}

interface PromiseStateInterfaces extends WidgetInterfaces {
	state: {
		value: Promise<number>
	}
}

interface PromisePropertyInterfaces extends WidgetInterfaces {
	properties: {
		value: Promise<number>
	}
}

interface UnionPromisePropertyInterfaces extends WidgetInterfaces {
	properties: {
		value: number | Promise<number>
	}
}

interface NestedPromisePropertyInterfaces extends WidgetInterfaces {
	properties: {
		value: { p: Promise<number> }
	}
}

interface AnyPropertyInterfaces extends WidgetInterfaces {
	properties: {
		value: any
	}
}

interface PromiseMethodReturnInterfaces extends WidgetInterfaces {
	methods: {
		run: () => Promise<string>
	}
}

interface UnionPromiseMethodReturnInterfaces extends WidgetInterfaces {
	methods: {
		run: () => string | Promise<string>
	}
}

interface PromiseMethodArgInterfaces extends WidgetInterfaces {
	methods: {
		run: (value: Promise<number>) => void
	}
}

interface SimplePropertyInterfaces extends WidgetInterfaces {
	properties: {
		total: number
	}
}

interface SimpleMethodInterfaces extends WidgetInterfaces {
	methods: {
		run: () => string
	}
}

// -------------------------------------------------------------------------------------------------
// Shared fixture definitions
// -------------------------------------------------------------------------------------------------

const fullConfigDef: WidgetConfigDefinition<FullInterfaces> = {
	description: 'Test config',
	validate: (input): input is { label?: string } => typeof input === 'object' && input !== null,
	resolve: raw => ({ label: raw?.label ?? 'default' }),
}

const aDef = { validate: (input: unknown): input is number => typeof input === 'number' }
const bDef = { validate: (input: unknown): input is string => typeof input === 'string' }
const cDef = { validate: (input: unknown): input is boolean => typeof input === 'boolean' }
const nameDef = { validate: (input: unknown): input is string => typeof input === 'string' }

describe('builder capability-phase ordering', () => {
	it('orders phases as interfaces -> config -> slots -> state -> properties -> methods -> done, and `.done` only appears once every phase has completed', () => {
		const afterInterfaces = createWidgetPlugin('full')
			.description('Test widget')
			.interfaces<FullInterfaces>()
		expectTypeOf(afterInterfaces)
			.toHaveProperty('config')
		expectTypeOf(afterInterfaces).not.toHaveProperty('done')

		const afterConfig = afterInterfaces.config(fullConfigDef)
		expectTypeOf(afterConfig)
			.toHaveProperty('slots')
		expectTypeOf(afterConfig).not.toHaveProperty('done')

		const afterSlots = afterConfig.slots({ header: { description: 'Test slot' }, body: { description: 'Test slot' } })
		expectTypeOf(afterSlots)
			.toHaveProperty('state')
		expectTypeOf(afterSlots).not.toHaveProperty('done')

		const afterState = afterSlots.state(state =>
			state
				.count({
					validate: (input): input is number => typeof input === 'number',
					default: () => 0,
				})
				.enabled({
					validate: (input): input is boolean => typeof input === 'boolean',
					default: () => false,
				}))
		expectTypeOf(afterState)
			.toHaveProperty('properties')
		expectTypeOf(afterState).not.toHaveProperty('done')

		const afterProperties = afterState.properties(properties =>
			properties
				.doubled({
					registerDeps: ({ dep }) => dep.self.state.get('count'),
					compute: ({ deps }) => {
						const result = deps()
						const current = result.ok ? result.value ?? 0 : 0
						return current * 2
					},
				})
				.label({
					compute: () => 'label',
				}))
		expectTypeOf(afterProperties)
			.toHaveProperty('methods')
		expectTypeOf(afterProperties).not.toHaveProperty('done')

		const afterMethods = afterProperties.methods(methods =>
			methods
				.increment({
					registerDeps: ({ dep }) => dep.self.state.set('count'),
					validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
					execute: ({ args, deps }) => {
						const result = deps(args[0])
						return result.ok ? result.value : 0
					},
				})
				.reset({
					validateArgs: (args): args is [] => args.length === 0,
					execute: () => {},
				}))
		expectTypeOf(afterMethods)
			.toHaveProperty('done')

		const plugin = afterMethods.done()
		expect(plugin.type)
			.toBe('full')
		expect(Object.isFrozen(plugin))
			.toBe(true)
	})

	it('skips every absent capability phase at once and jumps straight to the next declared one', () => {
		const afterInterfaces = createWidgetPlugin('config-methods')
			.description('Test widget')
			.interfaces<ConfigAndMethodsInterfaces>()
		expectTypeOf(afterInterfaces)
			.toHaveProperty('config')
		expectTypeOf(afterInterfaces).not.toHaveProperty('slots')
		expectTypeOf(afterInterfaces).not.toHaveProperty('state')
		expectTypeOf(afterInterfaces).not.toHaveProperty('properties')
		expectTypeOf(afterInterfaces).not.toHaveProperty('methods')

		const afterConfig = afterInterfaces.config({
			description: 'Test config',
			validate: (input): input is { x?: number } => typeof input === 'object' && input !== null,
			resolve: raw => ({ x: raw?.x ?? 0 }),
		})
		expectTypeOf(afterConfig)
			.toHaveProperty('methods')
		expectTypeOf(afterConfig).not.toHaveProperty('slots')
		expectTypeOf(afterConfig).not.toHaveProperty('state')
		expectTypeOf(afterConfig).not.toHaveProperty('properties')

		const plugin = afterConfig
			.methods(methods =>
				methods.run({
					validateArgs: (args): args is [] => args.length === 0,
					execute: () => {},
				}))
			.done()

		expect(plugin.type)
			.toBe('config-methods')
		expect(Object.isFrozen(plugin))
			.toBe(true)
	})

	it('reaches `done` immediately after `.interfaces()` when no capability is declared', () => {
		const afterInterfaces = createWidgetPlugin('empty')
			.description('Test widget')
			.interfaces<EmptyInterfaces>()
		expectTypeOf(afterInterfaces)
			.toEqualTypeOf<WidgetPluginDonePhase<'empty', EmptyInterfaces>>()

		const plugin = afterInterfaces.done()
		expect(plugin.type)
			.toBe('empty')
		expect(Object.isFrozen(plugin))
			.toBe(true)
	})

	it('rejects a slots object literal (even via a variable) that declares an extra, undeclared slot', () => {
		const slotsWithExtra = { header: {}, body: {}, extra: {} }
		const beforeSlots = createWidgetPlugin('extra-slot')
			.description('Test widget')
			.interfaces<FullInterfaces>()
			.config(fullConfigDef)
		// @ts-expect-error 'extra' is not declared by FullInterfaces; the exact-slots constraint rejects it even though it arrives through a variable, not an object literal
		beforeSlots.slots(slotsWithExtra)
	})
})

describe('section keyed-chain typestate (state section, representative of properties/methods)', () => {
	it('returns the same underlying chain object across member calls, in any order, including a bracket-accessed non-identifier key', () => {
		let capturedInitial: unknown
		let capturedAfterC: unknown

		const plugin = createWidgetPlugin('keyed-chain-order')
			.description('Test widget')
			.interfaces<KeyedChainInterfaces>()
			.state((state) => {
				capturedInitial = state
				const afterDisplayName = state['display-name'](nameDef)
				expectTypeOf(afterDisplayName)
					.toEqualTypeOf<WidgetStateSection<KeyedChainInterfaces, 'a' | 'b' | 'c'>>()

				const afterC = afterDisplayName.c(cDef)
				capturedAfterC = afterC

				const completed = afterC.a(aDef)
					.b(bDef)
				expectTypeOf(completed)
					.toEqualTypeOf<WidgetStateSection<KeyedChainInterfaces, never>>()
				return completed
			})
			.done()

		expect(capturedAfterC)
			.toBe(capturedInitial)
		expect(plugin.type)
			.toBe('keyed-chain-order')
		expect(Object.isFrozen(plugin))
			.toBe(true)
	})

	it('makes a consumed member disappear from the type surface so it cannot be repeated', () => {
		createWidgetPlugin('keyed-chain-repeat')
			.description('Test widget')
			.interfaces<KeyedChainInterfaces>()
			.state((state) => {
				const afterA = state.a(aDef)
				expectTypeOf(afterA)
					.toEqualTypeOf<WidgetStateSection<KeyedChainInterfaces, 'b' | 'c' | 'display-name'>>()

				// @ts-expect-error 'a' was already consumed; the keyed-chain proxy type no longer exposes it
				afterA.a(aDef)

				const afterC = afterA.b(bDef)
					.c(cDef)
				return afterC['display-name'](nameDef)
			})
	})

	it('rejects a state builder callback that leaves a declared member unconsumed', () => {
		const plugin = createWidgetPlugin('incomplete-state')
			.description('Test widget')
			.interfaces<KeyedChainInterfaces>()
		// @ts-expect-error the callback omits 'display-name', so `Remaining` never reaches `never` and the state phase cannot complete
		plugin.state(state => state.a(aDef)
			.b(bDef)
			.c(cDef))
	})

	it('rejects an empty object literal masquerading as a completed section', () => {
		const plugin = createWidgetPlugin('fake-empty-section')
			.description('Test widget')
			.interfaces<KeyedChainInterfaces>()
		// @ts-expect-error `{}` has neither the private completion marker nor the section methods; it cannot satisfy a completed section
		plugin.state(() => ({}))
	})

	it('lets an explicitly empty declared capability complete immediately, distinct from an absent capability', () => {
		const plugin = createWidgetPlugin('empty-state-capability')
			.description('Test widget')
			.interfaces<EmptyStateCapabilityInterfaces>()
			.state(state => state)
			.done()

		expect(plugin.type)
			.toBe('empty-state-capability')
		expect(Object.isFrozen(plugin))
			.toBe(true)
	})
})

describe('explicit-empty slots capability (`slots: never`), distinct from an absent slots capability (review round 2, diagnostic #10 amendment "declaration-presence semantics")', () => {
	it('exposes the .slots phase for `slots: never`, which completes via .slots({})', () => {
		const afterInterfaces = createWidgetPlugin('empty-slots-capability')
			.description('Test widget')
			.interfaces<EmptySlotsCapabilityInterfaces>()
		expectTypeOf(afterInterfaces)
			.toHaveProperty('slots')

		const plugin = afterInterfaces.slots({})
			.done()

		expect(plugin.type)
			.toBe('empty-slots-capability')
		expect(plugin.capabilities.slots)
			.toBe(true)
		expect(Object.isFrozen(plugin))
			.toBe(true)
	})

	it('skips the .slots phase entirely for a plugin that never declares slots', () => {
		const afterInterfaces = createWidgetPlugin('no-slots-capability')
			.description('Test widget')
			.interfaces<EmptyInterfaces>()
		expectTypeOf(afterInterfaces).not.toHaveProperty('slots')

		const plugin = afterInterfaces.done()
		expect(plugin.capabilities.slots)
			.toBe(false)
	})
})

describe('plugin.capabilities (review round 2, diagnostic #10 amendment "declaration-presence semantics and public WidgetPlugin.capabilities")', () => {
	it('is all-false, frozen, for a plugin declaring no capabilities', () => {
		const plugin = createWidgetPlugin('caps-none')
			.description('Test widget')
			.interfaces<EmptyInterfaces>()
			.done()

		expect(plugin.capabilities)
			.toEqual({ config: false, slots: false, state: false, properties: false, methods: false })
		expect(Object.isFrozen(plugin.capabilities))
			.toBe(true)
	})

	it('is all-true for a plugin declaring every capability', () => {
		const plugin = createWidgetPlugin('caps-all')
			.description('Test widget')
			.interfaces<AllCapabilitiesInterfaces>()
			.config({
				description: 'Test config',
				validate: (input): input is Record<string, never> => typeof input === 'object' && input !== null,
				resolve: () => ({}),
			})
			.slots({ a: { description: 'Test slot' } })
			.state(state => state.s({ validate: (input): input is number => typeof input === 'number' }))
			.properties(properties => properties.p({ compute: () => 0 }))
			.methods(methods => methods.m({
				validateArgs: (args): args is [] => args.length === 0,
				execute: () => 0,
			}))
			.done()

		expect(plugin.capabilities)
			.toEqual({ config: true, slots: true, state: true, properties: true, methods: true })
	})

	it('is true, with an empty inventory, for each explicitly-declared-empty capability', () => {
		const statePlugin = createWidgetPlugin('caps-empty-state')
			.description('Test widget')
			.interfaces<EmptyStateCapabilityInterfaces>()
			.state(state => state)
			.done()
		expect(statePlugin.capabilities.state)
			.toBe(true)

		const propertiesPlugin = createWidgetPlugin('caps-empty-properties')
			.description('Test widget')
			.interfaces<EmptyPropertiesCapabilityInterfaces>()
			.properties(properties => properties)
			.done()
		expect(propertiesPlugin.capabilities.properties)
			.toBe(true)

		const methodsPlugin = createWidgetPlugin('caps-empty-methods')
			.description('Test widget')
			.interfaces<EmptyMethodsCapabilityInterfaces>()
			.methods(methods => methods)
			.done()
		expect(methodsPlugin.capabilities.methods)
			.toBe(true)

		const slotsPlugin = createWidgetPlugin('caps-empty-slots')
			.description('Test widget')
			.interfaces<EmptySlotsCapabilityInterfaces>()
			.slots({})
			.done()
		expect(slotsPlugin.capabilities.slots)
			.toBe(true)
	})
})

describe('widgetInterfaces domain rejection (types.ts type layer)', () => {
	it('rejects a function inside authored RawConfig', () => {
		expectTypeOf<WidgetInterfacesViolationOf<NonJsonConfigInterfaces>>()
			.toEqualTypeOf<'authored values must be JSON-compatible'>()
	})

	it('leaves the interfaces phase unusable for a non-JSON RawConfig', () => {
		const violation = createWidgetPlugin('non-json-config')
			.description('Test widget')
			.interfaces<NonJsonConfigInterfaces>()
		expectTypeOf(violation)
			.toEqualTypeOf<WidgetInterfacesViolation<'authored values must be JSON-compatible'>>()
		expectTypeOf(violation).not.toHaveProperty('done')
	})

	it('rejects a broad string index signature on state', () => {
		expectTypeOf<WidgetInterfacesViolationOf<BroadStateIndexInterfaces>>()
			.toEqualTypeOf<'\'state\' must not be declared with a broad string index signature'>()
	})

	it('rejects a numeric member key on state', () => {
		expectTypeOf<WidgetInterfacesViolationOf<NumericStateKeyInterfaces>>()
			.toEqualTypeOf<'\'state\' member keys must be finite string literals'>()
	})

	it('rejects a symbol member key on state', () => {
		expectTypeOf<WidgetInterfacesViolationOf<SymbolStateKeyInterfaces>>()
			.toEqualTypeOf<'\'state\' member keys must be finite string literals'>()
	})

	it('rejects a broad slots capability that is not a finite string literal union', () => {
		expectTypeOf<WidgetInterfacesViolationOf<BroadSlotsInterfaces>>()
			.toEqualTypeOf<'\'slots\' must be a finite union of string literals'>()
	})

	it('leaves the interfaces phase unusable once a domain violation is present', () => {
		const violation = createWidgetPlugin('broad-state')
			.description('Test widget')
			.interfaces<BroadStateIndexInterfaces>()
		expectTypeOf(violation)
			.toEqualTypeOf<WidgetInterfacesViolation<'\'state\' must not be declared with a broad string index signature'>>()
		expectTypeOf(violation).not.toHaveProperty('config')
		expectTypeOf(violation).not.toHaveProperty('state')
		expectTypeOf(violation).not.toHaveProperty('done')
	})
})

describe('promiseLike-containing value/return domain rejection (union-member level)', () => {
	it('rejects a state value typed as a bare PromiseLike', () => {
		expectTypeOf<WidgetInterfacesViolationOf<PromiseStateInterfaces>>()
			.toEqualTypeOf<'\'state\' values must not be PromiseLike; the core semantic boundary is synchronous'>()
	})

	it('rejects a property value typed as a bare PromiseLike', () => {
		expectTypeOf<WidgetInterfacesViolationOf<PromisePropertyInterfaces>>()
			.toEqualTypeOf<'\'properties\' values must not be PromiseLike; the core semantic boundary is synchronous'>()
	})

	it('rejects a property value union that includes PromiseLike as one member', () => {
		expectTypeOf<WidgetInterfacesViolationOf<UnionPromisePropertyInterfaces>>()
			.toEqualTypeOf<'\'properties\' values must not be PromiseLike; the core semantic boundary is synchronous'>()
	})

	it('does not detect a PromiseLike nested inside a property value (union-member level, not a deep structural scan)', () => {
		expectTypeOf<WidgetInterfacesViolationOf<NestedPromisePropertyInterfaces>>()
			.toBeNever()
	})

	it('skips `any` property values entirely', () => {
		expectTypeOf<WidgetInterfacesViolationOf<AnyPropertyInterfaces>>()
			.toBeNever()
	})

	it('rejects a method return type typed as a bare PromiseLike', () => {
		expectTypeOf<WidgetInterfacesViolationOf<PromiseMethodReturnInterfaces>>()
			.toEqualTypeOf<'\'methods\' return types must not be PromiseLike; the core semantic boundary is synchronous'>()
	})

	it('rejects a method return type union that includes PromiseLike as one member', () => {
		expectTypeOf<WidgetInterfacesViolationOf<UnionPromiseMethodReturnInterfaces>>()
			.toEqualTypeOf<'\'methods\' return types must not be PromiseLike; the core semantic boundary is synchronous'>()
	})

	it('does not restrict method argument types, even when they contain PromiseLike', () => {
		expectTypeOf<WidgetInterfacesViolationOf<PromiseMethodArgInterfaces>>()
			.toBeNever()
	})
})

describe('semantic callbacks stay synchronous and are not widened to MaybePromise', () => {
	it('rejects a `compute` implementation that returns a Promise instead of the declared synchronous value', () => {
		const definition: WidgetPropertyDefinition<SimplePropertyInterfaces, 'total', EmptyRegisteredDeps> = {
			// @ts-expect-error `compute` must resolve synchronously to `number`; returning a Promise would silently widen the semantic boundary to MaybePromise<number>
			compute: () => {
				return Promise.resolve(1)
			},
		}
		expect(typeof definition.compute)
			.toBe('function')
	})

	it('rejects an `execute` implementation that returns a Promise instead of the declared synchronous value', () => {
		const definition: WidgetMethodDefinition<SimpleMethodInterfaces, 'run', EmptyRegisteredDeps> = {
			validateArgs: (args): args is [] => args.length === 0,
			// @ts-expect-error `execute` must resolve synchronously to `string`; returning a Promise would silently widen the semantic boundary to MaybePromise<string>
			execute: () => {
				return Promise.resolve('x')
			},
		}
		expect(typeof definition.execute)
			.toBe('function')
	})

	it('allows a method argument to carry a PromiseLike value while `execute` still resolves synchronously', () => {
		expectTypeOf<WidgetInterfacesViolationOf<PromiseMethodArgInterfaces>>()
			.toBeNever()

		const definition: WidgetMethodDefinition<PromiseMethodArgInterfaces, 'run', EmptyRegisteredDeps> = {
			validateArgs: (args): args is [Promise<number>] => args.length === 1,
			execute: (ctx) => {
				expectTypeOf(ctx.args)
					.toEqualTypeOf<[Promise<number>]>()
			},
		}
		expect(typeof definition.execute)
			.toBe('function')
	})
})
