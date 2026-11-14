/**
 * The `emit` of a Method: it carries only the Events the Method declares in `emits`, it works only while
 * its own Method's callback is the innermost running callback, and an Event the Method did not declare
 * throws a `TypeError` before anything is delivered. A Method that declares nothing receives an `emit`
 * without members. An invalid `emits` throws when the plugin is built.
 */

import type { ExecutionResult, WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectRuntime } from '../inspection'

const noArgs = (args: readonly unknown[]): args is [] => args.length === 0

interface PairInterfaces extends WidgetInterfaces {
	methods: {
		captureA: () => void
		captureB: () => void
		useRetained: () => void
		useA: () => void
		nested: () => void
		plain: () => void
	}
	events: { a: [value: number], b: [], c: [] }
}

interface Retained { a?: (value: number) => void, b?: () => void }

/** Two Methods of one widget that each retain their `emit`, and Methods that try to use what was retained. */
function createPair() {
	const retained: { fromA: Retained | null, fromB: Retained | null, plain: Readonly<Record<string, unknown>> | null } = { fromA: null, fromB: null, plain: null }
	const plugin = createWidgetPlugin('pair')
		.description('Pair')
		.interfaces<PairInterfaces>()
		.methods(methods => methods
			.captureA({
				validateArgs: noArgs,
				emits: ['a', 'b'],
				execute: ({ emit }) => {
					retained.fromA = emit
				},
			})
			.captureB({
				validateArgs: noArgs,
				emits: ['a'],
				execute: ({ emit }) => {
					retained.fromB = emit
				},
			})
			// Declares `a` itself, and still may not use the emitter that `captureA` retained.
			.useRetained({
				validateArgs: noArgs,
				emits: ['a'],
				execute: () => {
					retained.fromA!.a!(1)
				},
			})
			.useA({
				validateArgs: noArgs,
				emits: ['a'],
				execute: ({ emit }) => {
					emit.a(7)
				},
			})
			.nested({
				validateArgs: noArgs,
				registerDeps: ({ dep }) => ({ useA: dep.self.methods.invoke('useA') }),
				emits: ['b'],
				execute: ({ deps, emit }) => {
					emit.b()
					deps.useA()
					// This Method's own `emit` works again once the Method it invoked has returned.
					emit.b()
				},
			})
			.plain({
				validateArgs: noArgs,
				execute: ({ emit }) => {
					retained.plain = emit
				},
			}))
		.events(events => events
			.a({ description: 'A' })
			.b({ description: 'B' })
			.c({ description: 'C' }))
		.done()
	const blueprint = createWidgetSystem({ plugins: [plugin] })
		.createBlueprint({ id: 'p', type: 'pair' })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const widget = blueprint.createRuntime()
		.getWidget('p')!
	const seen: string[] = []
	widget.events.a.subscribe(value => seen.push(`a:${value}`))
	widget.events.b.subscribe(() => seen.push('b'))
	widget.events.c.subscribe(() => seen.push('c'))
	return { widget, retained, seen }
}

describe('the `emit` of a Method', () => {
	it('carries exactly the declared Events and delivers their arguments', () => {
		const { widget, retained, seen } = createPair()
		widget.methods.captureA()
		expect(Object.keys(retained.fromA!))
			.toEqual(['a', 'b'])
		expect(Object.isFrozen(retained.fromA))
			.toBe(true)
		expect(widget.methods.useA().ok)
			.toBe(true)
		expect(seen)
			.toEqual(['a:7'])
	})

	it('has no members for a Method that declares nothing', () => {
		const { widget, retained } = createPair()
		expect(widget.methods.plain().ok)
			.toBe(true)
		expect(Object.keys(retained.plain!))
			.toEqual([])
		expect(Object.isFrozen(retained.plain))
			.toBe(true)
	})

	it('works for a Method that invokes another emitting Method, before and after the call', () => {
		const { widget, seen } = createPair()
		expect(widget.methods.nested().ok)
			.toBe(true)
		expect(seen)
			.toEqual(['b', 'a:7', 'b'])
	})

	it('cannot be used while a different Method of the same widget runs, even one that declares the same Event', () => {
		const { widget, retained, seen } = createPair()
		widget.methods.captureA()
		expect(() => widget.methods.useRetained())
			.toThrow(TypeError)
		expect(() => widget.methods.useRetained())
			.toThrow('An emit callable was called outside the callback that received it.')
		expect(seen)
			.toEqual([])
		// The retained callable is closed from the outside as well.
		expect(() => retained.fromA!.a!(1))
			.toThrow(TypeError)
		expect(seen)
			.toEqual([])
	})

	it('cannot be used while a Method it invoked runs', () => {
		const retained: { outer: Retained | null } = { outer: null }
		interface NestedInterfaces extends WidgetInterfaces {
			methods: { outer: () => void, inner: () => void }
			events: { a: [value: number], b: [] }
		}
		const plugin = createWidgetPlugin('nested')
			.description('Nested')
			.interfaces<NestedInterfaces>()
			.methods(methods => methods
				.outer({
					validateArgs: noArgs,
					registerDeps: ({ dep }) => ({ inner: dep.self.methods.invoke('inner') }),
					emits: ['a'],
					execute: ({ deps, emit }) => {
						retained.outer = emit
						deps.inner()
					},
				})
				.inner({
					validateArgs: noArgs,
					emits: ['a'],
					execute: () => {
						retained.outer!.a!(1)
					},
				}))
			.events(events => events
				.a({ description: 'A' })
				.b({ description: 'B' }))
			.done()
		const blueprint = createWidgetSystem({ plugins: [plugin] })
			.createBlueprint({ id: 'n', type: 'nested' })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const widget = blueprint.createRuntime()
			.getWidget('n')!
		let delivered = 0
		widget.events.a.subscribe(() => delivered++)
		expect(() => widget.methods.outer())
			.toThrow('An emit callable was called outside the callback that received it.')
		expect(delivered)
			.toBe(0)
	})

	it('throws a TypeError naming the Method and delivers nothing for an Event the Method did not declare', () => {
		const emitted: string[] = []
		interface OtherInterfaces extends WidgetInterfaces {
			methods: { declared: () => void, none: () => void, empty: () => void }
			events: { a: [], b: [] }
		}
		const plugin = createWidgetPlugin('js')
			.description('Untyped')
			.interfaces<OtherInterfaces>()
			.methods(methods => methods
				.declared({
					validateArgs: noArgs,
					emits: ['a'],
					// A JavaScript author, or a cast, reaches an Event the types would refuse.
					execute: ({ emit }) => {
						emitted.push('before')
						;(emit as unknown as Record<string, () => void>).b!()
						emitted.push('after')
					},
				})
				.none({
					validateArgs: noArgs,
					execute: ({ emit }) => {
						;(emit as unknown as Record<string, () => void>).a!()
					},
				})
				.empty({
					validateArgs: noArgs,
					emits: [],
					execute: ({ emit }) => {
						;(emit as unknown as Record<string, () => void>).a!()
					},
				}))
			.events(events => events
				.a({ description: 'A' })
				.b({ description: 'B' }))
			.done()
		const blueprint = createWidgetSystem({ plugins: [plugin] })
			.createBlueprint({ id: 'j', type: 'js' })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('j')!
		let delivered = 0
		widget.events.a.subscribe(() => delivered++)
		widget.events.b.subscribe(() => delivered++)
		const occurrences: unknown[] = []
		const inspection = inspectRuntime(runtime)
		const widgetInspection = inspection.getWidget(inspection.blueprint.rootNodeId)!
		widgetInspection.getEvent('a')!.subscribe(occurrence => occurrences.push(occurrence))
		widgetInspection.getEvent('b')!.subscribe(occurrence => occurrences.push(occurrence))

		expect(() => widget.methods.declared())
			.toThrow(new TypeError('Widget plugin "js": Method "declared" (widget "j") emitted Event "b" without declaring it. Add "b" to the Method\'s "emits". This is a plugin implementation bug.'))
		expect(() => widget.methods.none())
			.toThrow(new TypeError('Widget plugin "js": Method "none" (widget "j") emitted Event "a" without declaring it. Add "a" to the Method\'s "emits". This is a plugin implementation bug.'))
		expect(() => widget.methods.empty())
			.toThrow(new TypeError('Widget plugin "js": Method "empty" (widget "j") emitted Event "a" without declaring it. Add "a" to the Method\'s "emits". This is a plugin implementation bug.'))
		expect(emitted)
			.toEqual(['before'])
		expect(delivered)
			.toBe(0)
		expect(occurrences)
			.toEqual([])
	})

	it('is absent from a Method of a plugin without Events', () => {
		const seen: unknown[] = []
		const plugin = createWidgetPlugin('quiet')
			.description('Quiet')
			.interfaces<{ methods: { run: () => void } }>()
			.methods(methods => methods.run({
				validateArgs: noArgs,
				execute: (context) => {
					seen.push('emit' in context)
				},
			}))
			.done()
		const blueprint = createWidgetSystem({ plugins: [plugin] })
			.createBlueprint({ id: 'q', type: 'quiet' })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		blueprint.createRuntime()
			.getWidget('q')!
			.methods
			.run()
		expect(seen)
			.toEqual([false])
	})
})

describe('plugin build with `emits`', () => {
	interface FireInterfaces extends WidgetInterfaces {
		methods: { fire: () => void, other: () => void }
		events: { fired: [], other: [] }
	}

	/** Builds a plugin from an untyped Method definition, as a JavaScript author would. */
	function buildUntyped(fire: Record<string, unknown>, withEvents = true) {
		const methodsPhase = createWidgetPlugin('js')
			.description('Untyped')
			.interfaces<FireInterfaces>()
			.methods(methods => methods
				.fire(fire as never)
				.other({ validateArgs: noArgs, execute: () => {} }))
		return withEvents
			? methodsPhase.events(events => events.fired({ description: 'Fired' })
					.other({ description: 'Other' }))
					.done()
			: (methodsPhase as unknown as { done: () => unknown }).done()
	}

	const execute = () => {}

	it('rejects an Event that is not declared in the events section', () => {
		expect(() => buildUntyped({ validateArgs: noArgs, emits: ['fierd'], execute }))
			.toThrow(new TypeError('Widget plugin "js": member "fire" of section "methods" has an invalid "emits" field (Event "fierd" is not declared in section "events"). This is a plugin implementation bug.'))
	})

	it('rejects an Event when the plugin declares no events section at all', () => {
		expect(() => buildUntyped({ validateArgs: noArgs, emits: ['fired'], execute }, false))
			.toThrow(new TypeError('Widget plugin "js": member "fire" of section "methods" has an invalid "emits" field (Event "fired" is not declared in section "events"). This is a plugin implementation bug.'))
	})

	it('rejects a duplicate', () => {
		expect(() => buildUntyped({ validateArgs: noArgs, emits: ['fired', 'fired'], execute }))
			.toThrow(new TypeError('Widget plugin "js": member "fire" of section "methods" has an invalid "emits" field (Event "fired" is listed more than once). This is a plugin implementation bug.'))
	})

	it('rejects a value that is not an array of names', () => {
		for (const [emits, got] of [['fired', 'string'], [{ 0: 'fired', length: 1 }, 'object'], [null, 'null'], [[1], 'array']] as const) {
			expect(() => buildUntyped({ validateArgs: noArgs, emits, execute }))
				.toThrow(new TypeError(`Widget plugin "js": member "fire" of section "methods" has an invalid "emits" field (expected an array of Event names, got ${got}). This is a plugin implementation bug.`))
		}
		// eslint-disable-next-line no-sparse-arrays
		expect(() => buildUntyped({ validateArgs: noArgs, emits: ['fired', , 'other'], execute }))
			.toThrow('has an invalid "emits" field (expected an array of Event names')
	})

	it('accepts an empty array, which means the Method emits nothing', () => {
		const plugin = buildUntyped({ validateArgs: noArgs, emits: [], execute })
		const blueprint = createWidgetSystem({ plugins: [plugin as never] })
			.createBlueprint({ id: 'j', type: 'js' })
		expect(blueprint.status)
			.toBe('valid')
	})

	it('captures `emits` by value', () => {
		const emits = ['fired']
		const plugin = buildUntyped({ validateArgs: noArgs, emits, execute: ({ emit }: { emit: Record<string, () => void> }) => emit.fired!() })
		emits.push('other', 'unknown')
		const blueprint = createWidgetSystem({ plugins: [plugin as never] })
			.createBlueprint({ id: 'j', type: 'js' })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const widget = blueprint.createRuntime()
			.getWidget('j') as unknown as { methods: { fire: () => ExecutionResult<unknown, unknown> } }
		expect(widget.methods.fire().ok)
			.toBe(true)
	})
})
