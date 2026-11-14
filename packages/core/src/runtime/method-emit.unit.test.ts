/**
 * The `emit` of a Method: it carries only the Events the Method declares in `emits`, it works only while
 * its own Method's callback is the innermost running callback, and an Event the Method did not declare
 * throws a `TypeError` before anything is delivered. A Method that declares nothing receives an `emit`
 * without members. An invalid `emits` throws when the plugin is built.
 */

import type { ExecutionResult, WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'
import { inspectRuntime } from '../inspection'

const noArgs = (args: readonly unknown[]): args is [] => args.length === 0

/** Asserts a `TypeError` whose message quotes each of `names` (plugin, Method, widget or Event); not the sentence around them. */
function expectTypeErrorNaming(call: () => unknown, ...names: readonly string[]): void {
	let thrown: unknown
	try {
		call()
	}
	catch (error) {
		thrown = error
	}
	expect(thrown)
		.toBeInstanceOf(TypeError)
	for (const name of names) {
		expect((thrown as TypeError).message)
			.toContain(`"${name}"`)
	}
}

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
			.toThrow(TypeError)
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

		expectTypeErrorNaming(() => widget.methods.declared(), 'js', 'declared', 'j', 'b')
		expectTypeErrorNaming(() => widget.methods.none(), 'js', 'none', 'j', 'a')
		expectTypeErrorNaming(() => widget.methods.empty(), 'js', 'empty', 'j', 'a')
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
		expectTypeErrorNaming(() => buildUntyped({ validateArgs: noArgs, emits: ['fierd'], execute }), 'js', 'fire', 'fierd')
	})

	it('rejects an Event when the plugin declares no events section at all', () => {
		expectTypeErrorNaming(() => buildUntyped({ validateArgs: noArgs, emits: ['fired'], execute }, false), 'js', 'fire', 'fired')
	})

	it('rejects a duplicate', () => {
		expectTypeErrorNaming(() => buildUntyped({ validateArgs: noArgs, emits: ['fired', 'fired'], execute }), 'js', 'fire', 'fired')
	})

	it('rejects a value that is not an array of names', () => {
		// The malformed value names no Event, so the error names the plugin and the Method only.
		for (const emits of ['fired', { 0: 'fired', length: 1 }, null, [1]]) {
			expectTypeErrorNaming(() => buildUntyped({ validateArgs: noArgs, emits, execute }), 'js', 'fire')
		}
		// eslint-disable-next-line no-sparse-arrays
		expectTypeErrorNaming(() => buildUntyped({ validateArgs: noArgs, emits: ['fired', , 'other'], execute }), 'js', 'fire')
	})

	it('throws a malformed value from the member call inside `.methods()`, and an unknown or repeated name only from `done()`', () => {
		const phase = () => createWidgetPlugin('js')
			.description('Untyped')
			.interfaces<FireInterfaces>()
		let reachedEvents = false
		expectTypeErrorNaming(() => phase()
			.methods(methods => methods
				.fire({ validateArgs: noArgs, emits: 'fired', execute } as never)
				.other({ validateArgs: noArgs, execute: () => {} }))
			.events((events) => {
				reachedEvents = true
				return events.fired({ description: 'Fired' })
					.other({ description: 'Other' })
			}), 'js', 'fire')
		expect(reachedEvents)
			.toBe(false)

		for (const emits of [['fierd'], ['fired', 'fired']]) {
			const events = phase()
				.methods(methods => methods
					.fire({ validateArgs: noArgs, emits, execute } as never)
					.other({ validateArgs: noArgs, execute: () => {} }))
				.events(section => section.fired({ description: 'Fired' })
					.other({ description: 'Other' }))
			expectTypeErrorNaming(() => events.done(), 'js', 'fire')
		}
	})

	it('accepts `emits: []` on a plugin that declares no Events, and rejects a name there', () => {
		expect(() => buildUntyped({ validateArgs: noArgs, emits: [], execute }, false))
			.not.toThrow()
		expectTypeErrorNaming(() => buildUntyped({ validateArgs: noArgs, emits: ['fired'], execute }, false), 'js', 'fire', 'fired')
	})

	it('checks only the Methods that declare `emits`, and names the first invalid one in declaration order', () => {
		const events = (section: { fired: (definition: { description: string }) => { other: (definition: { description: string }) => unknown } }) => section.fired({ description: 'Fired' })
			.other({ description: 'Other' })
		const build = (first: Record<string, unknown>, second: Record<string, unknown>) => createWidgetPlugin('js')
			.description('Untyped')
			.interfaces<FireInterfaces>()
			.methods(methods => methods
				.fire(first as never)
				.other(second as never))
			.events(events as never)
			.done()
		// Methods without `emits` are never an error, wherever they sit.
		expect(() => build({ validateArgs: noArgs, execute }, { validateArgs: noArgs, execute }))
			.not.toThrow()
		expectTypeErrorNaming(() => build({ validateArgs: noArgs, execute }, { validateArgs: noArgs, emits: ['nope'], execute }), 'js', 'other', 'nope')
		expectTypeErrorNaming(() => build({ validateArgs: noArgs, emits: ['nope'], execute }, { validateArgs: noArgs, emits: ['nada'], execute }), 'js', 'fire', 'nope')
		// A name declared again without `emits` (untyped code) leaves nothing to check.
		const redeclared = createWidgetPlugin('js')
			.description('Untyped')
			.interfaces<FireInterfaces>()
			.methods((methods) => {
				const section = methods as unknown as Record<string, (definition: unknown) => unknown>
				section.fire!({ validateArgs: noArgs, emits: ['nope'], execute })
				section.fire!({ validateArgs: noArgs, execute })
				section.other!({ validateArgs: noArgs, execute })
				return methods as never
			})
			.events(events as never)
		expect(() => redeclared.done())
			.not.toThrow()
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

interface RetainInterfaces extends WidgetInterfaces {
	methods: { keep: () => void, keepQuiet: () => void, useQuiet: () => void, useKept: () => void, pass: () => void, receive: () => void, callUndeclared: () => void }
	events: { x: [], y: [] }
}

const kept: { declared: { x: () => void } | null, undeclaredY: (() => void) | null, quiet: Record<string, () => void> | null } = { declared: null, undeclaredY: null, quiet: null }

/** Methods that retain their `emit`, and Methods that try to use it. `quiet` declares nothing; `user` declares `x`. */
function createRetainer() {
	const plugin = createWidgetPlugin('retain')
		.description('Retain')
		.interfaces<RetainInterfaces>()
		.methods(methods => methods
			.keep({
				validateArgs: noArgs,
				emits: ['x'],
				execute: ({ emit }) => {
					kept.declared = emit
					// A JavaScript author reaches an Event the Method did not declare.
					kept.undeclaredY = (emit as unknown as Record<string, () => void>).y!
				},
			})
			.keepQuiet({
				validateArgs: noArgs,
				execute: ({ emit }) => {
					kept.quiet = emit as unknown as Record<string, () => void>
				},
			})
			// Declares `x`, then uses the `x` of the `emit` of a Method that declared nothing.
			.useQuiet({
				validateArgs: noArgs,
				emits: ['x'],
				execute: () => {
					kept.quiet!.x!()
				},
			})
			.useKept({
				validateArgs: noArgs,
				emits: ['x'],
				execute: () => {
					kept.declared!.x()
				},
			})
			.pass({
				validateArgs: noArgs,
				emits: ['x'],
				registerDeps: ({ dep }) => ({ receive: dep.self.methods.invoke('receive') }),
				execute: ({ emit, deps }) => {
					(deps.receive as (...args: unknown[]) => unknown)(emit)
				},
			})
			.receive({
				validateArgs: (args): args is [] => args.length <= 1,
				emits: ['x'],
				execute: ({ args }) => {
					;(args as unknown as [{ x: () => void }])[0].x()
				},
			})
			.callUndeclared({
				validateArgs: noArgs,
				emits: ['x'],
				execute: () => {
					kept.undeclaredY!()
				},
			}))
		.events(events => events
			.x({ description: 'X' })
			.y({ description: 'Y' }))
		.done()
	const blueprint = createWidgetSystem({ plugins: [plugin] })
		.createBlueprint({ id: 'r', type: 'retain' })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('r')!
	const delivered: string[] = []
	widget.events.x.subscribe(() => delivered.push('x'))
	widget.events.y.subscribe(() => delivered.push('y'))
	return { runtime, widget, delivered }
}

describe('a retained `emit` callable', () => {
	it('throws a TypeError for an Event the Method did not declare, delivers nothing, and behaves the same after disposal', () => {
		const { runtime, widget, delivered } = createRetainer()
		widget.methods.keep()
		// Outside any callback, before disposal.
		expect(() => kept.undeclaredY!())
			.toThrow(TypeError)
		runtime.dispose()
		// After disposal the declared callable keeps the Runtime's own post-disposal error; the undeclared one is still a TypeError.
		expect(() => kept.declared!.x())
			.toThrow(WidgetSystemRuntimeDisposedError)
		expect(() => kept.undeclaredY!())
			.toThrow(TypeError)
		expect(delivered)
			.toEqual([])
	})

	it('does not blame the running Method when it declared the Event itself: the callable is another Method\'s', () => {
		const { widget, delivered } = createRetainer()
		widget.methods.keepQuiet()
		expect(() => widget.methods.useQuiet())
			.toThrow(TypeError)
		let thrown: unknown
		try {
			widget.methods.useQuiet()
		}
		catch (error) {
			thrown = error
		}
		// A Method that really did not declare the Event is named; here the Method `useQuiet` did declare it, so it is not.
		expect((thrown as TypeError).message)
			.not.toContain('"useQuiet"')
		expect(delivered)
			.toEqual([])
	})

	it('names the running Method when it really did not declare the Event', () => {
		const { widget, delivered } = createRetainer()
		widget.methods.keep()
		expectTypeErrorNaming(() => widget.methods.callUndeclared(), 'retain', 'callUndeclared', 'y')
		expect(delivered)
			.toEqual([])
	})

	it('refuses an `emit` handed to another Method, even when that Method declares the same Event', () => {
		const { widget, delivered } = createRetainer()
		expect(() => widget.methods.pass())
			.toThrow(TypeError)
		expect(delivered)
			.toEqual([])
	})

	it('can be used by a plain function the Method calls synchronously from inside its own `execute`', () => {
		interface HelperInterfaces extends WidgetInterfaces {
			methods: { run: () => void }
			events: { x: [] }
		}
		const announce = (emit: { x: () => void }): void => emit.x()
		const plugin = createWidgetPlugin('helper')
			.description('Helper')
			.interfaces<HelperInterfaces>()
			.methods(methods => methods.run({ validateArgs: noArgs, emits: ['x'], execute: ({ emit }) => announce(emit) }))
			.events(events => events.x({ description: 'X' }))
			.done()
		const blueprint = createWidgetSystem({ plugins: [plugin] })
			.createBlueprint({ id: 'h', type: 'helper' })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const widget = blueprint.createRuntime()
			.getWidget('h')!
		let delivered = 0
		widget.events.x.subscribe(() => delivered++)
		expect(widget.methods.run().ok)
			.toBe(true)
		expect(delivered)
			.toBe(1)
	})

	it('cannot be replaced through the prototype the undeclared stand-ins share: it is frozen, and the stand-ins are fixed', () => {
		const { widget, delivered } = createRetainer()
		widget.methods.keepQuiet()
		const emit = kept.quiet!
		const prototype = Object.getPrototypeOf(emit) as Record<string, unknown>
		expect(Object.isFrozen(prototype))
			.toBe(true)
		expect(Object.getOwnPropertyDescriptor(prototype, 'x'))
			.toMatchObject({ writable: false, configurable: false, enumerable: false })
		expect(() => {
			prototype.x = () => 'replaced'
		})
			.toThrow(TypeError)
		expect(() => Object.defineProperty(prototype, 'x', { value: () => 'replaced' }))
			.toThrow(TypeError)
		expect(() => {
			delete prototype.x
		})
			.toThrow(TypeError)
		expect(() => emit.x!())
			.toThrow(TypeError)
		expect(delivered)
			.toEqual([])
	})
})

describe('the `emit` of a Method that declares nothing', () => {
	it('has no own members, but `in` is true and a call throws: do not write `emit.x?.()`', () => {
		const { widget } = createRetainer()
		widget.methods.keepQuiet()
		const emit = kept.quiet!
		expect(Reflect.ownKeys(emit))
			.toEqual([])
		expect('x' in emit)
			.toBe(true)
		expect(typeof emit.x)
			.toBe('function')
		expect(() => emit.x!())
			.toThrow(TypeError)
	})
})
