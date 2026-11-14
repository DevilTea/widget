/**
 * Type-level conformance: a Method declares the Events it emits in `emits`, and the `emit` its `execute`
 * receives carries exactly those Events.
 *
 * `emits` is inferred next to `Deps` and `Result` (so `execute` stays contextually typed wherever the field
 * sits in the definition), the Event argument tuples stay typed, an Event that is not declared is a type
 * error, a name that is not an Event of the plugin is a type error, and a generic plugin factory keeps both
 * the declaration and its generic argument tuple.
 *
 * Negative assertions use `@ts-expect-error` with a one-line reason inside bodies that run only where the
 * test says so; a stray or missing error fails `pnpm typecheck`.
 */

import type { ExecutionResult, WidgetInterfaces, WidgetMethodDefinition, WidgetMethodEventEmitter, WidgetPluginConfigPhase } from './index'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from './index'

interface CounterInterfaces extends WidgetInterfaces {
	state: { count: number }
	methods: { increment: () => number, reset: () => void, peek: () => number }
	events: { changed: [count: number], cleared: [] }
}

interface NotifierInterfaces extends WidgetInterfaces {
	methods: { fire: (value: string) => void }
	events: { change: [value: string], __proto__: [value: number] }
}

interface NoEventsInterfaces extends WidgetInterfaces {
	methods: { run: () => void }
}

const PROTO_KEY = '__proto__' as const
const noArgs = (args: readonly unknown[]): args is [] => args.length === 0
const oneString = (args: readonly unknown[]): args is [string] => args.length === 1 && typeof args[0] === 'string'
const numberOf = (result: ExecutionResult<number | null, unknown>): number => result.ok ? result.value ?? 0 : 0
const isNumber = (input: unknown): input is number => typeof input === 'number'

describe('the `emit` of a Method carries exactly the declared Events', () => {
	it('narrows `emit` to the declared keys and keeps each argument tuple typed', () => {
		const plugin = createWidgetPlugin('counter')
			.description('Counter')
			.interfaces<CounterInterfaces>()
			.state(state => state.count({ validate: isNumber, default: () => 0 }))
			.methods(methods => methods
				.increment({
					validateArgs: noArgs,
					registerDeps: ({ dep }) => ({ count: dep.self.state.get('count'), setCount: dep.self.state.set('count') }),
					emits: ['changed'],
					execute: ({ deps, emit }) => {
						expectTypeOf(emit)
							.toEqualTypeOf<{ readonly changed: (count: number) => void }>()
						expectTypeOf(emit.changed).parameters.toEqualTypeOf<[count: number]>()
						const value = numberOf(deps.count()) + 1
						deps.setCount(value)
						emit.changed(value)
						// @ts-expect-error the argument tuple stays typed: `changed` takes a number
						emit.changed('two')
						// @ts-expect-error the argument tuple stays typed: `changed` takes exactly one argument
						emit.changed()
						// @ts-expect-error `cleared` is an Event of the plugin that this Method did not declare
						emit.cleared()
						return value
					},
				})
				.reset({
					validateArgs: noArgs,
					registerDeps: ({ dep }) => ({ setCount: dep.self.state.set('count') }),
					emits: ['changed', 'cleared'],
					execute: ({ deps, emit }) => {
						expectTypeOf<keyof typeof emit>()
							.toEqualTypeOf<'changed' | 'cleared'>()
						deps.setCount(0)
						emit.cleared()
						emit.changed(0)
					},
				})
				.peek({
					validateArgs: noArgs,
					registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
					// No `emits`: `emit` has no member.
					execute: ({ deps, emit }) => {
						expectTypeOf<keyof typeof emit>()
							.toEqualTypeOf<never>()
						// @ts-expect-error a Method without `emits` cannot emit
						emit.changed(1)
						return numberOf(deps.count())
					},
				}))
			.events(events => events
				.changed({ description: 'The count changed' })
				.cleared({ description: 'Cleared' }))
			.done()
		expectTypeOf(plugin)
			.not.toBeAny()
		expect(plugin.type)
			.toBe('counter')
	})

	it('treats an empty declaration like none', () => {
		const plugin = createWidgetPlugin('counter')
			.description('Counter')
			.interfaces<CounterInterfaces>()
			.state(state => state.count({ validate: isNumber, default: () => 0 }))
			.methods(methods => methods
				.increment({ validateArgs: noArgs, emits: [], execute: () => 1 })
				.reset({ validateArgs: noArgs, execute: () => {} })
				.peek({
					validateArgs: noArgs,
					emits: [],
					execute: (_context) => {
						expectTypeOf<keyof typeof _context.emit>()
							.toEqualTypeOf<never>()
						return 1
					},
				}))
			.events(events => events
				.changed({ description: 'The count changed' })
				.cleared({ description: 'Cleared' }))
			.done()
		expect(plugin.type)
			.toBe('counter')
	})

	it('infers the declaration wherever `emits` sits in the definition object', () => {
		const plugin = createWidgetPlugin('counter')
			.description('Counter')
			.interfaces<CounterInterfaces>()
			.state(state => state.count({ validate: isNumber, default: () => 0 }))
			.methods(methods => methods
				.increment({
					validateArgs: noArgs,
					execute: (_context) => {
						expectTypeOf<keyof typeof _context.emit>()
							.toEqualTypeOf<'changed'>()
						return 1
					},
					emits: ['changed'],
				})
				.reset({ validateArgs: noArgs, execute: () => {} })
				.peek({ validateArgs: noArgs, execute: () => 1 }))
			.events(events => events
				.changed({ description: 'The count changed' })
				.cleared({ description: 'Cleared' }))
			.done()
		expect(plugin.type)
			.toBe('counter')
	})

	it('rejects an entry that is not an Event of the plugin, and a broad string array', () => {
		function declare(names: string[]) {
			return createWidgetPlugin('counter')
				.description('Counter')
				.interfaces<CounterInterfaces>()
				.state(state => state.count({ validate: isNumber, default: () => 0 }))
				.methods(methods => methods
					.increment({
						validateArgs: noArgs,
						// @ts-expect-error 'chnaged' is not an Event of the plugin
						emits: ['chnaged'],
						execute: () => 1,
					})
					.reset({
						validateArgs: noArgs,
						// @ts-expect-error a `string[]` cannot prove that its entries are Events of the plugin
						emits: names,
						execute: () => {},
					})
					.peek({ validateArgs: noArgs, execute: () => 1 }))
		}
		expectTypeOf(declare)
			.toBeFunction()
	})

	it('has no `emit` and no declarable Event in a plugin without an events capability', () => {
		function declare() {
			return createWidgetPlugin('quiet')
				.description('Quiet')
				.interfaces<NoEventsInterfaces>()
				.methods(methods => methods
					.run({
						validateArgs: noArgs,
						// @ts-expect-error a plugin without Events has nothing to declare
						emits: ['changed'],
						execute: () => {},
					}))
		}
		function without() {
			return createWidgetPlugin('quiet')
				.description('Quiet')
				.interfaces<NoEventsInterfaces>()
				.methods(methods => methods
					.run({
						validateArgs: noArgs,
						execute: (context) => {
							expectTypeOf(context)
								.not.toHaveProperty('emit')
						},
					}))
				.done()
		}
		expectTypeOf(declare)
			.toBeFunction()
		expect(without().type)
			.toBe('quiet')
	})

	it('accepts a declaration held in a typed constant, and special member names', () => {
		const emits = ['change', PROTO_KEY] as const
		const plugin = createWidgetPlugin('notifier')
			.description('Notifier')
			.interfaces<NotifierInterfaces>()
			.methods(methods => methods.fire({
				validateArgs: oneString,
				emits,
				execute: ({ args, emit }) => {
					emit.change(args[0])
					emit[PROTO_KEY](args[0].length)
					// @ts-expect-error `__proto__` takes a number
					emit[PROTO_KEY](args[0])
				},
			}))
			.events((events) => {
				const beforeProto = events.change({ description: 'Changed' })
				return beforeProto[PROTO_KEY]({ description: 'Special' })
			})
			.done()
		expect(plugin.type)
			.toBe('notifier')
	})

	it('keeps the thenable gate on `execute`', () => {
		function declare() {
			return createWidgetPlugin('notifier')
				.description('Notifier')
				.interfaces<NotifierInterfaces>()
				.methods(methods => methods.fire({
					validateArgs: oneString,
					emits: ['change'],
					// @ts-expect-error an async execute is still rejected for a void Method
					execute: async ({ args, emit }) => emit.change(args[0]),
				}))
		}
		expectTypeOf(declare)
			.toBeFunction()
	})

	it('exports the emitter type and the standalone definition type takes the declaration as its fifth argument', () => {
		type FireEmitter = WidgetMethodEventEmitter<NotifierInterfaces, 'change'>
		expectTypeOf<FireEmitter>()
			.toEqualTypeOf<{ readonly change: (value: string) => void }>()
		expectTypeOf<keyof WidgetMethodEventEmitter<NotifierInterfaces, never>>()
			.toEqualTypeOf<never>()

		const definition: WidgetMethodDefinition<NotifierInterfaces, 'fire', Record<never, never>, unknown, 'change'> = {
			validateArgs: oneString,
			emits: ['change'],
			execute: ({ args, emit }) => emit.change(args[0]),
		}
		const withoutFifth: WidgetMethodDefinition<NotifierInterfaces, 'fire', Record<never, never>> = {
			validateArgs: oneString,
			// @ts-expect-error without the fifth argument no Event can be declared
			emits: ['change'],
			execute: () => {},
		}
		expect([definition, withoutFifth])
			.toHaveLength(2)
	})
})

interface ListInterfaces<Item> extends WidgetInterfaces {
	state: { items: Item[] }
	methods: { add: (item: Item) => void }
	events: { added: [item: Item], cleared: [] }
}

/** The guide's generic-factory pattern (a cast of `.interfaces()`). */
function createListPlugin<const Type extends string, Item>(type: Type, isItem: (input: unknown) => input is Item) {
	return (createWidgetPlugin(type)
		.description('A list')
		.interfaces<ListInterfaces<Item>>() as WidgetPluginConfigPhase<Type, ListInterfaces<Item>>)
		.state(state => state.items({ validate: (input): input is Item[] => Array.isArray(input) && input.every(isItem), default: () => [] }))
		.methods(methods => methods.add({
			validateArgs: (args): args is [Item] => args.length === 1 && isItem(args[0]),
			registerDeps: ({ dep }) => ({ items: dep.self.state.get('items'), set: dep.self.state.set('items') }),
			emits: ['added'],
			execute: ({ args: [item], deps, emit }) => {
				expectTypeOf(emit.added).parameters.toEqualTypeOf<[item: Item]>()
				const current = deps.items()
				deps.set([...(current.ok ? current.value ?? [] : []), item])
				emit.added(item)
				// @ts-expect-error `cleared` is not declared by `add`
				expect(() => emit.cleared())
					.toThrow('emitted Event "cleared" without declaring it')
			},
		}))
		.events(events => events
			.added({ description: 'Added' })
			.cleared({ description: 'Cleared' }))
		.done()
}

describe('a generic plugin factory', () => {
	it('keeps the declaration and the generic Event argument tuple typed', () => {
		const list = createListPlugin('list', (input): input is string => typeof input === 'string')
		const blueprint = createWidgetSystem({ plugins: [list] })
			.createBlueprint({ id: 'l', type: 'list' })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const widget = blueprint.createRuntime()
			.getWidget('l')!
		const added: string[] = []
		widget.events.added.subscribe(item => added.push(item))
		expect(widget.methods.add('a').ok)
			.toBe(true)
		expect(added)
			.toEqual(['a'])
	})
})
