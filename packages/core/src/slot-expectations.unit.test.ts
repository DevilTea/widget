/**
 * Conformance coverage for slot expectations (Discussion #12, "Interfaces are the single source of a
 * plugin's shape and documentation (0.3.0)", Core API items 4, 6 and 7 and the type-level checks): the
 * `slots` record and its type-only expectations, `slot(name)` of a `registerDeps` context, the catalog's slot
 * names, `createWidgetSystem`'s slot-union check and `WidgetSourceOf`.
 *
 * Only public entries are imported.
 */

import type {
	AnyWidgetPluginTuple,
	ContractDependencyTarget,
	MethodInvokeDepExpression,
	PropertyGetDepExpression,
	SlotChildDependencyTarget,
	StateGetDepExpression,
	StateSetDepExpression,
	UnknownTargetDependencyOperations,
	WidgetChild,
	WidgetContract,
	WidgetInterfacesViolationOf,
	WidgetRegisterDepsContext,
	WidgetSlotExpectedOf,
	WidgetSlotNameOf,
	WidgetSourceOf,
} from './index'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from './index'
import { inspectBlueprint } from './inspection/index'

// -------------------------------------------------------------------------------------------------
// Fixture: a wizard whose `steps` slot expects a structural contract, `extras` any widget, and `notes`
// one plugin type.
// -------------------------------------------------------------------------------------------------

type StepContract = WidgetContract<{
	state: { visited: boolean }
	properties: { title: string, complete: boolean }
	methods: { reset: () => void }
}>

interface StepInterfaces {
	config: {
		raw: { readonly title: string }
		resolved: { readonly title: string }
	}
	state: { visited: boolean }
	properties: { title: string, complete: boolean }
	methods: { visit: () => void, reset: () => void }
}

interface WizardInterfaces {
	slots: {
		/** The steps, in order. */
		steps: StepContract
		/** Anything shown beside the steps. */
		extras: WidgetChild
		/** Notes only. */
		notes: 'note'
	}
	properties: { titles: readonly string[], completeCount: number }
	methods: { resetAll: () => void }
}

const noArgs = (args: readonly unknown[]): args is [] => args.length === 0

function createFixture() {
	const seen = { steps: [] as number[], extras: [] as number[] }

	const step = createWidgetPlugin('step')
		.interfaces<StepInterfaces>()
		.config({
			validate: (input): input is { readonly title: string } => typeof input === 'object' && input !== null && typeof (input as { readonly title?: unknown }).title === 'string',
			resolve: raw => ({ title: raw?.title ?? '' }),
		})
		.state(state => state.visited({
			validate: (input): input is boolean => typeof input === 'boolean',
			default: () => false,
		}))
		.properties(properties => properties
			.title({ compute: ({ config }) => config.title })
			.complete({
				registerDeps: ({ dep }) => ({ visited: dep.self.state.get('visited') }),
				compute: ({ deps }) => {
					const visited = deps.visited()
					return visited.ok && visited.value === true
				},
			}))
		.methods(methods => methods
			.visit({
				registerDeps: ({ dep }) => ({ setVisited: dep.self.state.set('visited') }),
				validateArgs: noArgs,
				execute: ({ deps }) => {
					deps.setVisited(true)
				},
			})
			.reset({
				registerDeps: ({ dep }) => ({ setVisited: dep.self.state.set('visited') }),
				validateArgs: noArgs,
				execute: ({ deps }) => {
					deps.setVisited(false)
				},
			}))
		.done()

	const note = createWidgetPlugin('note')
		.interfaces<Record<never, never>>()
		.done()

	const wizard = createWidgetPlugin('wizard')
		.interfaces<WizardInterfaces>()
		.slots({ steps: {}, extras: {}, notes: {} })
		.properties(properties => properties
			.titles({
				registerDeps: ({ slot }) => {
					seen.steps.push(slot('steps').length)
					seen.extras.push(slot('extras').length)
					return slot('steps')
						.map(child => child.properties.get('title'))
				},
				compute: ({ deps }) => deps.map((read) => {
					const title = read()
					return title.ok ? title.value : '?'
				}),
			})
			.completeCount({
				registerDeps: ({ slot }) => slot('steps')
					.map(child => child.properties.get('complete')),
				compute: ({ deps }) => deps.filter((read) => {
					const complete = read()
					return complete.ok && complete.value
				}).length,
			}))
		.methods(methods => methods.resetAll({
			registerDeps: ({ slot }) => slot('steps')
				.map(child => child.methods.invoke('reset')),
			validateArgs: noArgs,
			execute: ({ deps }) => {
				for (const reset of deps)
					reset()
			},
		}))
		.done()

	const system = createWidgetSystem({ plugins: [wizard, step, note] })
	return { seen, step, note, wizard, system }
}

const stepSource = (id: string, title: string) => ({ id, type: 'step', config: { title } })

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

describe('the slots record', () => {
	it('names the slots by its keys and exposes each slot\'s expectation', () => {
		expectTypeOf<WidgetSlotNameOf<WizardInterfaces>>()
			.toEqualTypeOf<'steps' | 'extras' | 'notes'>()
		expectTypeOf<WidgetSlotExpectedOf<WizardInterfaces, 'steps'>>()
			.toEqualTypeOf<StepContract>()
		expectTypeOf<WidgetSlotExpectedOf<WizardInterfaces, 'notes'>>()
			.toEqualTypeOf<'note'>()
		expectTypeOf<WidgetSlotNameOf<{ slots: never }>>()
			.toEqualTypeOf<never>()
		expectTypeOf<WidgetSlotNameOf<Record<never, never>>>()
			.toEqualTypeOf<never>()
		expectTypeOf<WidgetInterfacesViolationOf<WizardInterfaces>>()
			.toEqualTypeOf<never>()
	})

	it('rejects an expectation that is neither plugin types nor a contract', () => {
		const typeOnly = () => {
			const builder = createWidgetPlugin('bad-slot')
			// @ts-expect-error an ordinary object type is not a WidgetContract
			builder.interfaces<{ slots: { body: { properties: { title: string } } } }>()
			// @ts-expect-error a number is not an expectation
			builder.interfaces<{ slots: { body: 1 } }>()
		}
		expect(typeOnly)
			.toBeTypeOf('function')
		expectTypeOf<WidgetInterfacesViolationOf<{ slots: { body: string } }>>()
			.toEqualTypeOf<'\'slots\' values must be a finite union of plugin type literals, a WidgetContract or WidgetChild'>()
	})

	it('keeps `slots: never` as the explicit-empty declaration', () => {
		const plugin = createWidgetPlugin('empty-slots')
			.interfaces<{ slots: never }>()
			.slots({})
			.done()

		expect(plugin.capabilities.slots)
			.toBe(true)
		expect(createWidgetSystem({ plugins: [plugin] }).catalog.widgets[0]!.slots)
			.toEqual([])
	})

	it('adds no runtime check: a child that breaks the expectation compiles without a diagnostic', () => {
		const { system } = createFixture()
		// `notes` expects 'note' and `steps` a step-like widget; nothing enforces either.
		const blueprint = system.createBlueprint({
			id: 'w',
			type: 'wizard',
			slots: { notes: [stepSource('s', 'S')], extras: [{ id: 'n', type: 'note' }] },
		})

		expect(blueprint.diagnostics)
			.toEqual([])
		expect(blueprint.status)
			.toBe('valid')
	})
})

describe('`slot(name)` typing', () => {
	it('types the reads of a contract slot by the contract', () => {
		const typeOnly = (property: WidgetRegisterDepsContext<WizardInterfaces, 'property'>, method: WidgetRegisterDepsContext<WizardInterfaces, 'method'>) => {
			const child = property.slot('steps')[0]!
			expectTypeOf(child.properties.get('title'))
				.toEqualTypeOf<PropertyGetDepExpression<string, false>>()
			expectTypeOf(child.properties.get('complete'))
				.toEqualTypeOf<PropertyGetDepExpression<boolean, false>>()
			expectTypeOf(child.state.get('visited'))
				.toEqualTypeOf<StateGetDepExpression<boolean | null, false>>()
			expectTypeOf(child.methods.invoke('reset'))
				.toEqualTypeOf<MethodInvokeDepExpression<[], void, false>>()
			// `.validate()` stays available: the types are the declaration's word only.
			expectTypeOf(child.properties.get('title').validate)
				.toBeFunction()
			// @ts-expect-error the contract declares no such Property
			child.properties.get('subtitle')
			// @ts-expect-error a Property never writes State
			child.state.set('visited')
			// @ts-expect-error a slot child always exists, so there is no `optional()`
			child.optional()
			// @ts-expect-error 'footer' is not a declared slot
			property.slot('footer')

			expectTypeOf(method.slot('steps')[0]!.state.set('visited'))
				.toEqualTypeOf<StateSetDepExpression<boolean, false>>()
		}
		expect(typeOnly)
			.toBeTypeOf('function')
	})

	it('keeps the unknown-target grammar for `WidgetChild` and for a union of plugin types', () => {
		expectTypeOf<SlotChildDependencyTarget<WidgetChild, 'property'>['properties']>()
			.toEqualTypeOf<UnknownTargetDependencyOperations<'property', false>['properties']>()
		expectTypeOf<SlotChildDependencyTarget<WidgetChild, 'method'>['state']>()
			.toEqualTypeOf<UnknownTargetDependencyOperations<'method', false>['state']>()
		expectTypeOf<SlotChildDependencyTarget<'note' | 'step', 'property'>>()
			.toEqualTypeOf<UnknownTargetDependencyOperations<'property', false>>()

		const typeOnly = (ctx: WidgetRegisterDepsContext<WizardInterfaces, 'property'>) => {
			expectTypeOf(ctx.slot('extras')[0]!.properties.get('anything'))
				.toEqualTypeOf<PropertyGetDepExpression<unknown, false>>()
			expectTypeOf(ctx.slot('notes')[0]!.properties.get('anything'))
				.toEqualTypeOf<PropertyGetDepExpression<unknown, false>>()
		}
		expect(typeOnly)
			.toBeTypeOf('function')
	})

	it('does not take an ordinary object type for a contract', () => {
		// Only a `WidgetContract` types the reads; a look-alike object type stays unknown-typed.
		expectTypeOf<SlotChildDependencyTarget<{ properties: { title: string } }, 'property'>>()
			.toEqualTypeOf<UnknownTargetDependencyOperations<'property', false>>()
		expectTypeOf<SlotChildDependencyTarget<StepContract, 'property'>>()
			.toEqualTypeOf<ContractDependencyTarget<{
			state: { visited: boolean }
			properties: { title: string, complete: boolean }
			methods: { reset: () => void }
		}, 'property'>>()
		expectTypeOf<{ properties: { title: string } }>().not.toMatchTypeOf<WidgetContract>()
	})

	it('is absent from the context of a plugin without the slots capability', () => {
		const typeOnly = (ctx: WidgetRegisterDepsContext<{ properties: { total: number } }, 'property'>) => {
			// @ts-expect-error no slots capability, no `slot`
			ctx.slot('steps')
		}
		expect(typeOnly)
			.toBeTypeOf('function')
	})
})

// -------------------------------------------------------------------------------------------------
// Runtime
// -------------------------------------------------------------------------------------------------

describe('`slot(name)` of a registerDeps context', () => {
	it('returns the children of the widget\'s own slot in Blueprint order', () => {
		const { system, seen } = createFixture()
		// Ids chosen so that neither sorted order nor integer-key order is the Blueprint's.
		const blueprint = system.createBlueprint({
			id: 'w',
			type: 'wizard',
			slots: { steps: [stepSource('b', 'Second letter'), stepSource('10', 'Ten'), stepSource('a', 'First letter'), stepSource('2', 'Two')] },
		})
		if (blueprint.status !== 'valid')
			throw new Error(`expected a valid Blueprint, got ${JSON.stringify(blueprint.diagnostics.map(diagnostic => diagnostic.code))}`)
		const runtime = blueprint.createRuntime()
		const wizard = runtime.getWidget('w')
		if (wizard === null || wizard.type !== 'wizard')
			throw new Error('expected the wizard')

		expect(seen)
			.toEqual({ steps: [4], extras: [0] })
		expect(wizard.properties.titles.get())
			.toEqual({ ok: true, value: ['Second letter', 'Ten', 'First letter', 'Two'] })
	})

	it('is sugar over `dep.widget(child.id)`: the same dependency reference, no new target kind', () => {
		const { system } = createFixture()
		const blueprint = system.createBlueprint({
			id: 'w',
			type: 'wizard',
			slots: { steps: [stepSource('b', 'B'), stepSource('a', 'A')] },
		})
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)
		if (root === null || !root.resolved)
			throw new Error('expected the resolved root')
		const titles = root.properties.find(property => property.name === 'titles')!

		expect(titles.dependencies.map(dependency => [dependency.path, dependency.status, dependency.reference]))
			.toEqual([
				[[0], 'resolved', { target: { type: 'widget', widgetId: 'b', optional: false }, operation: { type: 'property-get', name: 'title' } }],
				[[1], 'resolved', { target: { type: 'widget', widgetId: 'a', optional: false }, operation: { type: 'property-get', name: 'title' } }],
			])
	})

	it('reads and invokes through the targets like any declared dependency', () => {
		const { system } = createFixture()
		const blueprint = system.createBlueprint({
			id: 'w',
			type: 'wizard',
			slots: { steps: [stepSource('b', 'B'), stepSource('a', 'A')] },
		})
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const runtime = blueprint.createRuntime()
		const wizard = runtime.getWidget('w')
		const first = runtime.getWidget('b')
		if (wizard === null || wizard.type !== 'wizard' || first === null || first.type !== 'step')
			throw new Error('expected the wizard and its first step')

		expect(wizard.properties.completeCount.get())
			.toEqual({ ok: true, value: 0 })
		first.methods.visit()
		expect(wizard.properties.completeCount.get())
			.toEqual({ ok: true, value: 1 })
		expect(wizard.methods.resetAll().ok)
			.toBe(true)
		expect(first.state.visited.get())
			.toBe(false)
		expect(wizard.properties.completeCount.get())
			.toEqual({ ok: true, value: 0 })
	})

	it('leaves out a child that did not resolve', () => {
		const { system, seen } = createFixture()
		const blueprint = system.createBlueprint({
			id: 'w',
			type: 'wizard',
			slots: { steps: [stepSource('b', 'B'), { id: 'ghost', type: 'not-registered' }, stepSource('a', 'A')] },
		})

		expect(blueprint.diagnostics.map(diagnostic => diagnostic.code))
			.toEqual(['unknown-widget-type'])
		expect(seen.steps)
			.toEqual([2])
	})

	it('does not check the expectation: a child without the expected member is an ordinary dependency diagnostic', () => {
		const { system } = createFixture()
		const blueprint = system.createBlueprint({
			id: 'w',
			type: 'wizard',
			slots: { steps: [{ id: 'n', type: 'note' }] },
		})

		expect(blueprint.status)
			.toBe('invalid')
		expect(new Set(blueprint.diagnostics.map(diagnostic => diagnostic.code)))
			.toEqual(new Set(['missing-dependency-capability']))
	})

	it('throws a TypeError for a slot name the plugin does not declare', () => {
		const untypedSlot = (name: unknown) => createWidgetPlugin('asks')
			.interfaces<{ slots: { body: WidgetChild }, properties: { total: number } }>()
			.slots({ body: {} })
			.properties(properties => properties.total({
				registerDeps: (ctx) => {
					(ctx.slot as (name: unknown) => unknown)(name)
					return {}
				},
				compute: () => 0,
			}))
			.done()

		for (const name of ['footer', '', 1, undefined, null]) {
			expect(() => createWidgetSystem({ plugins: [untypedSlot(name)] })
				.createBlueprint({ id: 'root', type: 'asks' }))
				.toThrow(TypeError)
		}

		const withoutSlots = createWidgetPlugin('no-slots')
			.interfaces<{ methods: { run: () => void } }>()
			.methods(methods => methods.run({
				registerDeps: (ctx) => {
					(ctx as unknown as { slot: (name: string) => unknown }).slot('body')
					return {}
				},
				validateArgs: noArgs,
				execute: () => {},
			}))
			.done()
		expect(() => createWidgetSystem({ plugins: [withoutSlots] })
			.createBlueprint({ id: 'root', type: 'no-slots' }))
			.toThrow(TypeError)
	})
})

// -------------------------------------------------------------------------------------------------
// Catalog and System
// -------------------------------------------------------------------------------------------------

describe('the catalog lists slot names', () => {
	it('lists each plugin\'s slot names in declaration order, `null` without the capability', () => {
		const { system } = createFixture()

		expect(system.catalog.widgets.map(widget => [widget.type, widget.slots]))
			.toEqual([
				['wizard', ['steps', 'extras', 'notes']],
				['step', null],
				['note', null],
			])
		for (const widget of system.catalog.widgets) {
			expect(widget).not.toHaveProperty('description')
			expect(widget).not.toHaveProperty('descriptions')
			expect(widget).not.toHaveProperty('config')
		}
	})
})

describe('createWidgetSystem checks slot unions against the registered plugin types', () => {
	it('rejects, at the type level only, a slot that expects an unregistered plugin type', () => {
		const { wizard, step } = createFixture()

		// @ts-expect-error the wizard's `notes` slot expects 'note', which is not registered
		const system = createWidgetSystem({ plugins: [wizard, step] })

		// Nothing is checked at run time.
		expect(system.catalog.widgets.map(widget => widget.type))
			.toEqual(['wizard', 'step'])
	})

	it('accepts a System that registers every expected type, in any order, and a loosely typed one', () => {
		const { wizard, step, note } = createFixture()
		const loose: AnyWidgetPluginTuple = [wizard, step]

		expect(createWidgetSystem({ plugins: [note, wizard] }).plugins)
			.toHaveLength(2)
		expect(createWidgetSystem({ plugins: loose }).plugins)
			.toHaveLength(2)
	})
})

describe('widgetSourceOf types TypeScript-authored sources', () => {
	it('types config per plugin type and the children of each slot by its expectation', () => {
		const { system } = createFixture()
		type Source = WidgetSourceOf<typeof system>

		const source: Source = {
			id: 'w',
			type: 'wizard',
			meta: { note: 'kept' },
			slots: {
				steps: [{ id: 'a', type: 'step', config: { title: 'A' } }, { id: 'n', type: 'note' }],
				extras: [{ id: 'x', type: 'wizard' }],
				notes: [{ id: 'm', type: 'note' }],
			},
		}
		// @ts-expect-error `notes` takes only 'note' sources
		const wrongChild: Source = { id: 'w', type: 'wizard', slots: { notes: [{ id: 'a', type: 'step', config: { title: 'A' } }] } }
		// @ts-expect-error a step's config requires `title`
		const wrongConfig: Source = { id: 'a', type: 'step', config: {} }
		// @ts-expect-error a step's config cannot be omitted (its raw type does not admit `null`)
		const missingConfig: Source = { id: 'a', type: 'step' }
		// @ts-expect-error 'footer' is not a slot of the wizard
		const wrongSlot: Source = { id: 'w', type: 'wizard', slots: { footer: [] } }
		// @ts-expect-error 'banner' is not a registered type
		const wrongType: Source = { id: 'b', type: 'banner' }

		expect([wrongChild, wrongConfig, missingConfig, wrongSlot, wrongType])
			.toHaveLength(5)
		expect(system.createBlueprint(source).status)
			.toBe('valid')
	})

	it('is the source type of the System\'s plugin tuple', () => {
		const { system } = createFixture()
		expectTypeOf<WidgetSourceOf<typeof system>['type']>()
			.toEqualTypeOf<'wizard' | 'step' | 'note'>()
		expect(system.plugins.map(plugin => plugin.type))
			.toEqual(['wizard', 'step', 'note'])
	})
})
