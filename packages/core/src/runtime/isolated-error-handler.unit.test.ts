/**
 * Conformance: `setIsolatedErrorHandler(handler)` hands the exceptions Core isolates to a host function
 * instead of rethrowing them in a queued microtask.
 *
 * - With no handler set, every report is a microtask rethrow, as before.
 * - Each kind of isolated exception reaches the handler exactly once, with its identity preserved, and no
 *   microtask is queued.
 * - An exception isolated while a Runtime operation is in progress is handed over once the outermost operation
 *   has finished its work, before the host's call returns (also when that operation throws), in the order Core
 *   isolated it among the Property inspection deliveries; one isolated with no operation in progress is handed
 *   over at once.
 * - A handler that reads and writes the Runtime leaves every Property and subscriber correct (issue #198).
 * - A throwing handler, a replaced or removed handler, the re-read de-duplication of a cached `compute`
 *   exception and the inspection delivery bound.
 *
 * `queueMicrotask` is stubbed in every test, so a report that still goes through it is counted and can be
 * replayed instead of reaching the test runner.
 */

import type { ExecutionResult, IsolatedErrorHandler } from '../index'
import { effect as alienEffect } from 'alien-signals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWidgetDocument, createWidgetPlugin, createWidgetSystem, setIsolatedErrorHandler } from '../index'
import { inspectRuntime } from '../inspection'
import { getWidgetEventEmitter } from '../integration'

interface LinkConfig { readonly me: string, readonly prev: string | null }

interface LinkInterfaces {
	config: { raw: LinkConfig, resolved: LinkConfig }
	state: { n: number }
	properties: {
		total: number
		/** Throws a fresh `Error` (recorded in `thrownByBoom`) whenever `n` is 13. */
		boom: number
	}
	methods: {
		bump: (by: number) => boolean
		/** Invokes `bump` (a nested Runtime operation), then records `relay done` in `trace`. */
		relay: (by: number) => boolean
		/** Writes `n`, then throws `methodError`. */
		writeThenThrow: (value: number) => void
	}
	events: { change: [value: number] }
}

const BOOM = 13
const trace: string[] = []
const thrownByBoom: Error[] = []
const methodError = new Error('execute failed')
const isNumber = (input: unknown): input is number => typeof input === 'number'
const numberOf = (result: ExecutionResult<unknown, unknown>): number => (result.ok && typeof result.value === 'number' ? result.value : 0)

const linkPlugin = createWidgetPlugin('link')
	.description('One link of a chain')
	.interfaces<LinkInterfaces>()
	.config({ description: 'The previous link', validate: (input): input is LinkConfig => typeof input === 'object' && input !== null, resolve: raw => raw! })
	.state(state => state.n({ validate: isNumber, default: () => 1 }))
	.properties(properties => properties
		.total({
			registerDeps: ({ dep, config }) => ({
				prev: dep.widget(config.prev ?? 'absent')
					.optional()
					.properties
					.get('total'),
				n: dep.self.state.get('n'),
			}),
			compute: ({ deps, addDiagnostic }) => {
				const n = numberOf(deps.n())
				if (n === 0)
					addDiagnostic({ message: 'n is zero' })
				return numberOf(deps.prev()) + n
			},
		})
		.boom({
			registerDeps: ({ dep }) => ({ n: dep.self.state.get('n') }),
			compute: ({ deps }) => {
				const n = numberOf(deps.n())
				if (n === BOOM) {
					const error = new Error(`boom at ${n}`)
					thrownByBoom.push(error)
					throw error
				}
				return n
			},
		}))
	.methods(methods => methods
		.bump({
			registerDeps: ({ dep }) => ({ n: dep.self.state.get('n'), set: dep.self.state.set('n') }),
			validateArgs: (args): args is [number] => args.length === 1 && isNumber(args[0]),
			execute: ({ deps, args }) => deps.set(numberOf(deps.n()) + args[0]).ok,
		})
		.relay({
			registerDeps: ({ dep }) => ({ bump: dep.self.methods.invoke('bump') }),
			validateArgs: (args): args is [number] => args.length === 1 && isNumber(args[0]),
			execute: ({ deps, args }) => {
				const result = deps.bump(args[0])
				trace.push('relay done')
				return result.ok && result.value
			},
		})
		.writeThenThrow({
			registerDeps: ({ dep }) => ({ set: dep.self.state.set('n') }),
			validateArgs: (args): args is [number] => args.length === 1 && isNumber(args[0]),
			execute: ({ deps, args }) => {
				deps.set(args[0])
				throw methodError
			},
		}))
	.events(events => events.change({ description: 'A change' }))
	.done()
const listPlugin = createWidgetPlugin('list')
	.description('A list')
	.interfaces<{ slots: 'items' }>()
	.slots({ items: { description: 'Links' } })
	.done()
const system = createWidgetSystem({ plugins: [linkPlugin, listPlugin] })

function createChain(length = 10) {
	const items = Array.from({ length }, (_, i) => ({ id: `l${i}`, type: 'link' as const, config: { me: `l${i}`, prev: i > 0 ? `l${i - 1}` : null } }))
	const blueprint = system.createBlueprint({ id: 'root', type: 'list', slots: { items } })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const runtime = blueprint.createRuntime()
	const link = (i: number) => {
		const widget = runtime.getWidget(`l${i}`)
		if (widget?.type !== 'link')
			throw new Error('expected a link')
		return widget
	}
	const inspection = inspectRuntime(runtime)
	const widgetInspection = (i: number) => {
		const entry = inspection.blueprint.nodes.find(node => node.resolved && node.node.id === `l${i}`)!
		return inspection.getWidget(entry.nodeId)!
	}
	const emitter = (i: number) => getWidgetEventEmitter(runtime, link(i))!
	const fresh = () => {
		const reference = blueprint.createRuntime({ overrideStateDefaults: runtime.snapshotState() })
		return (i: number) => {
			const widget = reference.getWidget(`l${i}`)
			if (widget?.type !== 'link')
				throw new Error('expected a link')
			return widget
		}
	}
	return {
		runtime,
		link,
		emit: (i: number, value: number) => emitter(i).change!(value),
		inspectProperty: (i: number) => widgetInspection(i)
			.getProperty('total')!,
		inspectState: (i: number) => widgetInspection(i)
			.getState('n')!,
		inspectEvent: (i: number) => widgetInspection(i)
			.getEvent('change')!,
		fresh,
		length,
	}
}

type Chain = ReturnType<typeof createChain>

function staleLinks(chain: Chain): string[] {
	const reference = chain.fresh()
	const stale: string[] = []
	for (let i = 0; i < chain.length; i++) {
		if (JSON.stringify(chain.link(i).properties.total.get()) !== JSON.stringify(reference(i).properties.total.get()))
			stale.push(`l${i}`)
	}
	return stale
}

const microtasks: (() => void)[] = []
const NOTHING_THROWN = Symbol('nothing thrown')

/** Runs and clears the stubbed microtasks; returns what each one threw. */
function replayMicrotasks(): unknown[] {
	return microtasks.splice(0)
		.map((callback) => {
			try {
				callback()
				return NOTHING_THROWN
			}
			catch (error) {
				return error
			}
		})
}

/** Sets a handler that records every exception it receives. */
function recordReports(log?: string[]): unknown[] {
	const received: unknown[] = []
	setIsolatedErrorHandler((error) => {
		received.push(error)
		log?.push(`handler: ${error instanceof Error ? error.message : String(error)}`)
	})
	return received
}

function thrower(error: unknown, log?: string[], label?: string) {
	return (): void => {
		if (log !== undefined)
			log.push(label ?? 'throw')
		throw error
	}
}

beforeEach(() => {
	microtasks.length = 0
	trace.length = 0
	thrownByBoom.length = 0
	vi.stubGlobal('queueMicrotask', (callback: () => void) => {
		microtasks.push(callback)
	})
})

afterEach(() => {
	setIsolatedErrorHandler(null)
	vi.unstubAllGlobals()
})

describe('with no handler set', () => {
	it('rethrows an isolated exception in a queued microtask, as before', () => {
		const chain = createChain(1)
		const error = new Error('listener')
		chain.link(0).state.n.subscribe(thrower(error))

		expect(chain.link(0).state.n.set(2))
			.toEqual({ ok: true, value: 2 })
		const rethrown = replayMicrotasks()
		expect(rethrown)
			.toHaveLength(1)
		expect(rethrown[0])
			.toBe(error)
	})

	for (const cleared of [null, undefined]) {
		it(`is restored by setIsolatedErrorHandler(${String(cleared)})`, () => {
			const chain = createChain(1)
			const error = new Error('listener')
			chain.link(0).state.n.subscribe(thrower(error))
			const received = recordReports()
			setIsolatedErrorHandler(cleared)
			chain.link(0).state.n.set(2)

			expect(received)
				.toEqual([])
			expect(replayMicrotasks())
				.toEqual([error])
		})
	}

	it('rejects a value that is neither a function, null nor undefined, and keeps the handler that was set', () => {
		const chain = createChain(1)
		const error = new Error('listener')
		chain.link(0).state.n.subscribe(thrower(error))
		const received = recordReports()

		expect(() => setIsolatedErrorHandler(42 as unknown as IsolatedErrorHandler))
			.toThrow(TypeError)
		chain.link(0).state.n.set(2)
		expect(received)
			.toEqual([error])
	})
})

describe('each kind of isolated exception reaches the handler exactly once, with no microtask', () => {
	interface Case {
		readonly name: string
		/** Registers the failing observer; returns the call that triggers it and the exception expected. */
		readonly arrange: (chain: Chain) => { readonly trigger: () => void, readonly expected: () => unknown }
	}
	const cases: readonly Case[] = [
		{ name: 'a State subscriber', arrange: (chain) => {
			const error = new Error('State subscriber')
			chain.link(0).state.n.subscribe(thrower(error))
			return { trigger: () => chain.link(0).state.n.set(2), expected: () => error }
		} },
		{ name: 'a State diagnostics listener', arrange: (chain) => {
			const error = new Error('State diagnostics listener')
			chain.link(0).state.n.subscribeDiagnostics(thrower(error))
			return { trigger: () => chain.link(0).state.n.set('x' as unknown as number), expected: () => error }
		} },
		{ name: 'a Property subscriber', arrange: (chain) => {
			const error = new Error('Property subscriber')
			chain.link(1).properties.total.subscribe(thrower(error))
			return { trigger: () => chain.link(0).state.n.set(2), expected: () => error }
		} },
		{ name: 'a Property diagnostics listener', arrange: (chain) => {
			const error = new Error('Property diagnostics listener')
			chain.link(0).properties.total.subscribe(() => {})
			chain.link(0).properties.total.subscribeDiagnostics(thrower(error))
			return { trigger: () => chain.link(0).state.n.set(0), expected: () => error }
		} },
		{ name: 'a Method diagnostics listener', arrange: (chain) => {
			const error = new Error('Method diagnostics listener')
			chain.link(0).methods.bump.subscribeDiagnostics(thrower(error))
			const bump = chain.link(0).methods.bump as unknown as (...args: unknown[]) => unknown
			return { trigger: () => bump('x'), expected: () => error }
		} },
		{ name: 'a widget diagnostics listener', arrange: (chain) => {
			const error = new Error('widget diagnostics listener')
			chain.link(0)
				.subscribeDiagnostics(thrower(error))
			return { trigger: () => chain.link(0).state.n.set('x' as unknown as number), expected: () => error }
		} },
		{ name: 'a Runtime diagnostics listener', arrange: (chain) => {
			const error = new Error('Runtime diagnostics listener')
			chain.runtime.subscribeDiagnostics(thrower(error))
			return { trigger: () => chain.link(0).state.n.set('x' as unknown as number), expected: () => error }
		} },
		{ name: 'an Event listener (emit inside a Runtime operation)', arrange: (chain) => {
			const error = new Error('Event listener')
			chain.link(0).events.change.subscribe(thrower(error))
			chain.link(0).state.n.subscribe(value => chain.emit(0, value ?? 0))
			return { trigger: () => chain.link(0).state.n.set(2), expected: () => error }
		} },
		{ name: 'an Event listener (emit with no operation in progress)', arrange: (chain) => {
			const error = new Error('Event listener')
			chain.link(0).events.change.subscribe(thrower(error))
			return { trigger: () => chain.emit(0, 1), expected: () => error }
		} },
		{ name: 'an Event inspection listener', arrange: (chain) => {
			const error = new Error('Event inspection listener')
			chain.inspectEvent(0)
				.subscribe(thrower(error))
			chain.link(0).state.n.subscribe(value => chain.emit(0, value ?? 0))
			return { trigger: () => chain.link(0).state.n.set(2), expected: () => error }
		} },
		{ name: 'a State inspection listener', arrange: (chain) => {
			const error = new Error('State inspection listener')
			chain.inspectState(0)
				.subscribe(thrower(error))
			return { trigger: () => chain.link(0).state.n.set(2), expected: () => error }
		} },
		{ name: 'a Property inspection listener', arrange: (chain) => {
			const error = new Error('Property inspection listener')
			chain.inspectProperty(1)
				.subscribe(thrower(error))
			return { trigger: () => chain.link(1).properties.total.get(), expected: () => error }
		} },
		{ name: 'a disposal listener', arrange: (chain) => {
			const error = new Error('disposal listener')
			chain.runtime.subscribeDisposal(thrower(error))
			return { trigger: () => chain.runtime.dispose(), expected: () => error }
		} },
		{ name: 'a WidgetDocument subscriber', arrange: () => {
			const error = new Error('WidgetDocument subscriber')
			const document = createWidgetDocument({ system, source: { id: 'root', type: 'list' } })
			document.subscribe(thrower(error))
			return { trigger: () => document.applyPatch([{ op: 'add', path: '/meta', value: { note: 1 } }]), expected: () => error }
		} },
		{ name: 'a compute that throws while its subscription re-evaluates it', arrange: (chain) => {
			chain.link(0).properties.boom.subscribe(() => {})
			return { trigger: () => chain.link(0).state.n.set(BOOM), expected: () => thrownByBoom.at(-1) }
		} },
		{ name: 'a compute that throws in the first read of subscribe()', arrange: (chain) => {
			chain.link(0).state.n.set(BOOM)
			return { trigger: () => chain.link(0).properties.boom.subscribe(() => {}), expected: () => thrownByBoom.at(-1) }
		} },
	]

	for (const { name, arrange } of cases) {
		it(name, () => {
			const chain = createChain(2)
			const { trigger, expected } = arrange(chain)
			const received = recordReports()

			expect(trigger)
				.not
				.toThrow()
			expect(received)
				.toHaveLength(1)
			expect(received[0])
				.toBe(expected())
			expect(received[0])
				.toBeInstanceOf(Error)
			expect(microtasks)
				.toHaveLength(0)
		})
	}

	it('the RangeError of the inspection delivery bound', () => {
		const chain = createChain(3)
		chain.link(2).properties.total.subscribe(() => {})
		let calls = 0
		chain.inspectProperty(1)
			.subscribe(() => {
				calls++
				chain.link(0).state.n.set(calls + 1)
			})
		const received = recordReports()
		chain.link(0).state.n.set(100)

		expect(calls)
			.toBeGreaterThan(1)
		expect(calls)
			.toBeLessThan(500)
		expect(received)
			.toHaveLength(1)
		expect(received[0])
			.toBeInstanceOf(RangeError)
		expect(microtasks)
			.toHaveLength(0)
	})
})

describe('when the handler runs', () => {
	it('after the outermost operation has finished its work (every subscriber notified), before the call returns', () => {
		const chain = createChain(2)
		const log: string[] = []
		chain.link(0).state.n.subscribe(thrower(new Error('first'), log, 'first throws'))
		chain.link(0).state.n.subscribe(() => log.push('second notified'))
		chain.link(1).properties.total.subscribe(result => log.push(`total ${numberOf(result)}`))
		recordReports(log)
		chain.link(0).state.n.set(2)
		log.push('set returned')

		expect(log.slice(-2))
			.toEqual(['handler: first', 'set returned'])
		expect(log.slice(0, -2)
			.sort())
			.toEqual(['first throws', 'second notified', 'total 3'])
	})

	it('after the outermost operation when the exception was isolated inside a nested one', () => {
		const chain = createChain(2)
		const log = trace
		// The State inspection listener runs at the write, inside `bump`, which runs inside `relay`.
		chain.inspectState(0)
			.subscribe(thrower(new Error('inspection'), log, 'inspection throws'))
		chain.link(0).state.n.subscribe(value => log.push(`subscriber ${value}`))
		recordReports(log)
		chain.link(0).methods.relay(1)
		log.push('relay returned')

		expect(log)
			.toEqual(['inspection throws', 'relay done', 'subscriber 2', 'handler: inspection', 'relay returned'])
	})

	it('also when the outermost operation throws, before its exception reaches the caller', () => {
		const chain = createChain(1)
		const log: string[] = []
		chain.link(0).state.n.subscribe(thrower(new Error('subscriber'), log, 'subscriber throws'))
		const received = recordReports(log)
		let caught: unknown
		try {
			chain.link(0).methods.writeThenThrow(5)
		}
		catch (error) {
			caught = error
			log.push('caught')
		}

		expect(caught)
			.toBe(methodError)
		expect(log)
			.toEqual(['subscriber throws', 'handler: subscriber', 'caught'])
		// Nothing was left queued for a later call.
		chain.link(0).state.n.subscribe(() => {})
		chain.link(1 - 1).properties.total.get()
		expect(received)
			.toHaveLength(1)
	})

	it('also when the release of the outermost operation throws (an effect that does not belong to a Runtime)', () => {
		const chain = createChain(1)
		const log: string[] = []
		chain.link(0).properties.total.subscribe(thrower(new Error('subscriber'), log, 'subscriber throws'))
		recordReports(log)
		const stop = alienEffect(() => {
			if (chain.link(0).properties.total.getDiagnostics().length > 0)
				throw new Error('foreign effect')
		})
		try {
			expect(() => chain.link(0).state.n.set(0))
				.toThrow('foreign effect')
			expect(log)
				.toEqual(['subscriber throws', 'handler: subscriber'])
		}
		finally {
			stop()
		}
	})

	for (const [label, subscribePropertyFirst, expected] of [
		['the inspection delivery queued first', true, ['subscriber of total', 'subscriber of n throws', 'inspection 2', 'handler: subscriber of n']],
		['the report queued first', false, ['subscriber of n throws', 'subscriber of total', 'handler: subscriber of n', 'inspection 2']],
	] as const) {
		it(`in the order Core isolated it among the Property inspection deliveries of the call (${label})`, () => {
			const chain = createChain(1)
			const log: string[] = []
			const subscribeProperty = () => chain.link(0).properties.total.subscribe(() => log.push('subscriber of total'))
			const subscribeState = () => chain.link(0).state.n.subscribe(thrower(new Error('subscriber of n'), log, 'subscriber of n throws'))
			if (subscribePropertyFirst) {
				subscribeProperty()
				subscribeState()
			}
			else {
				subscribeState()
				subscribeProperty()
			}
			chain.inspectProperty(0)
				.subscribe(snapshot => log.push(`inspection ${snapshot.status === 'completed' ? numberOf(snapshot.result) : '-'}`))
			recordReports(log)
			chain.link(0).state.n.set(2)

			expect(log)
				.toEqual(expected)
		})
	}

	it('for an exception isolated during a queued inspection delivery, before the call returns', () => {
		const chain = createChain(1)
		const log: string[] = []
		chain.link(0).state.n.subscribe(thrower(new Error('subscriber'), log, 'subscriber throws'))
		let fired = false
		chain.inspectProperty(0)
			.subscribe(() => {
				log.push('inspection')
				if (fired)
					return
				fired = true
				chain.link(0).state.n.set(7)
				throw new Error('inspection')
			})
		recordReports(log)
		chain.link(0).properties.total.get()
		log.push('get returned')

		// The listener's write is an outermost operation of its own: its subscriber throws before the listener does.
		expect(log)
			.toEqual(['inspection', 'subscriber throws', 'handler: subscriber', 'handler: inspection', 'get returned'])
	})

	it('for exceptions isolated in two Runtimes during one call, after that call\'s work, before it returns', () => {
		const a = createChain(1)
		const b = createChain(1)
		const errorA = new Error('A')
		const errorB = new Error('B')
		const log: string[] = []
		b.link(0).state.n.subscribe(thrower(errorB, log, 'B subscriber throws'))
		a.link(0).state.n.subscribe((value) => {
			b.link(0).state.n.set((value ?? 0) * 10)
			log.push('A subscriber throws')
			throw errorA
		})
		a.link(0).state.n.subscribe(() => log.push('A second subscriber notified'))
		const received = recordReports(log)
		a.link(0).state.n.set(2)
		log.push('set returned')

		// Which of the two is isolated first depends on when the nested write flushes, which is not part of
		// this contract; each is handed over once, after every listener of the call, before it returns.
		expect(received)
			.toHaveLength(2)
		expect(new Set(received))
			.toEqual(new Set([errorA, errorB]))
		expect(log.slice(0, 3)
			.sort())
			.toEqual(['A second subscriber notified', 'A subscriber throws', 'B subscriber throws'])
		expect(log.slice(3))
			.toEqual([...received.map(error => `handler: ${(error as Error).message}`), 'set returned'])
		expect(b.link(0).state.n.get())
			.toBe(20)
	})

	it('at once when no Runtime operation is in progress: between two WidgetDocument subscribers', () => {
		const document = createWidgetDocument({ system, source: { id: 'root', type: 'list' } })
		const log: string[] = []
		document.subscribe(thrower(new Error('first'), log, 'first throws'))
		document.subscribe(() => log.push('second notified'))
		recordReports(log)
		document.applyPatch([{ op: 'add', path: '/meta', value: { note: 1 } }])
		log.push('applyPatch returned')

		expect(log)
			.toEqual(['first throws', 'handler: first', 'second notified', 'applyPatch returned'])
	})

	it('at once when no Runtime operation is in progress: between two disposal listeners', () => {
		const chain = createChain(1)
		const log: string[] = []
		chain.runtime.subscribeDisposal(thrower(new Error('first'), log, 'first throws'))
		chain.runtime.subscribeDisposal(() => log.push('second notified'))
		recordReports(log)
		chain.runtime.dispose()
		log.push('dispose returned')

		expect(log)
			.toEqual(['first throws', 'handler: first', 'second notified', 'dispose returned'])
	})

	it('at once when no Runtime operation is in progress: between two Event listeners of an emit made outside any operation', () => {
		const chain = createChain(1)
		const log: string[] = []
		chain.link(0).events.change.subscribe(thrower(new Error('first'), log, 'first throws'))
		chain.link(0).events.change.subscribe(() => log.push('second notified'))
		recordReports(log)
		chain.emit(0, 1)
		log.push('emit returned')

		expect(log)
			.toEqual(['first throws', 'handler: first', 'second notified', 'emit returned'])
	})
})

describe('a handler that reads and writes the Runtime', () => {
	for (const how of ['set', 'method'] as const) {
		for (const [label, arrangeFailure] of [
			['a State subscriber', (chain: Chain) => chain.link(0).state.n.subscribe(thrower(new Error('subscriber')))],
			['a Property subscriber in the middle of the chain', (chain: Chain) => chain.link(5).properties.total.subscribe(thrower(new Error('subscriber')))],
		] as const) {
			it(`reads current values and leaves no Property or subscriber stale (${label}, writes with ${how})`, () => {
				const chain = createChain()
				for (let i = 0; i < 10; i++) chain.link(i).properties.total.get()
				const last: Record<number, number> = {}
				for (const i of [8, 9]) {
					chain.link(i).properties.total.subscribe((result) => {
						last[i] = numberOf(result)
					})
				}
				arrangeFailure(chain)
				const seen: number[] = []
				let fired = false
				setIsolatedErrorHandler(() => {
					seen.push(numberOf(chain.link(9).properties.total.get()))
					if (fired)
						return
					fired = true
					if (how === 'set')
						chain.link(0).state.n.set(6)
					else
						chain.link(0).methods.bump(1)
				})
				chain.link(0).state.n.set(5)

				expect(seen[0])
					.toBe(14)
				expect(last)
					.toEqual({ 8: 14, 9: 15 })
				expect(chain.link(9).properties.total.get())
					.toEqual({ ok: true, value: 15 })
				expect(staleLinks(chain))
					.toEqual([])
			})
		}
	}

	it('that answers a compute exception under subscription by writing makes that subscription receive the value written', () => {
		const chain = createChain(1)
		const received: number[] = []
		chain.link(0).properties.boom.subscribe(result => received.push(numberOf(result)))
		setIsolatedErrorHandler(() => {
			chain.link(0).state.n.set(BOOM + 1)
		})
		chain.link(0).state.n.set(BOOM)

		expect(thrownByBoom)
			.toHaveLength(1)
		expect(received)
			.toEqual([BOOM + 1])
	})

	it('that answers an exception thrown by the first read of subscribe() by writing makes the new subscription receive the value written', () => {
		const chain = createChain(1)
		chain.link(0).state.n.set(BOOM)
		const received: number[] = []
		setIsolatedErrorHandler(() => {
			chain.link(0).state.n.set(BOOM + 1)
		})
		chain.link(0).properties.boom.subscribe(result => received.push(numberOf(result)))

		expect(thrownByBoom)
			.toHaveLength(1)
		expect(received)
			.toEqual([BOOM + 1])
	})

	/** Every exception in `thrown` was handed to the handler or rethrown in a microtask, exactly once. */
	function expectNothingLost(received: readonly unknown[], rethrown: readonly unknown[], thrown: readonly unknown[]): void {
		const isolated = [...received.filter(error => !(error instanceof RangeError)), ...rethrown]
		expect(new Set(isolated).size)
			.toBe(isolated.length)
		expect(new Set(isolated))
			.toEqual(new Set(thrown))
	}

	for (const [label, subscribers] of [['one exception per write', 1], ['two exceptions per write', 2]] as const) {
		it(`whose calls keep causing new isolated exceptions is stopped after a bounded number of them; nothing is lost (${label})`, () => {
			const chain = createChain(1)
			const thrown: Error[] = []
			for (let i = 0; i < subscribers; i++) {
				chain.link(0).state.n.subscribe((value) => {
					const error = new Error(`subscriber ${i} saw ${value}`)
					thrown.push(error)
					throw error
				})
			}
			const received: unknown[] = []
			setIsolatedErrorHandler((error) => {
				received.push(error)
				chain.link(0).state.n.set((chain.link(0).state.n.get() ?? 0) + 1)
			})

			expect(() => chain.link(0).state.n.set(2))
				.not
				.toThrow()
			const rangeErrors = received.filter(error => error instanceof RangeError)
			expect(rangeErrors)
				.toHaveLength(1)
			// Bounded well below what an exponential feedback (two exceptions per write) would reach.
			expect(received.length)
				.toBeLessThan(500)
			const rethrown = replayMicrotasks()
			expect(rethrown.length)
				.toBeGreaterThan(0)
			expectNothingLost(received, rethrown, thrown)
		})
	}
})

describe('the inspection delivery bound with a handler set', () => {
	it('hands over the reports still queued instead of dropping them; what the handler then causes is rethrown in a microtask', () => {
		const chain = createChain(3)
		chain.link(2).properties.total.subscribe(() => {})
		chain.link(0).properties.boom.subscribe(() => {})
		const thrownBySubscriber: Error[] = []
		chain.link(0).state.n.subscribe((value) => {
			const error = new Error(`subscriber saw ${value}`)
			thrownBySubscriber.push(error)
			throw error
		})
		let calls = 0
		chain.inspectProperty(1)
			.subscribe(() => {
				calls++
				chain.link(0).state.n.set(calls + 100)
			})
		const received: unknown[] = []
		let boundReached = false
		setIsolatedErrorHandler((error) => {
			received.push(error)
			if (error instanceof RangeError && !boundReached) {
				boundReached = true
				// Changes `n` once more: its subscriber and `boom` throw, and l1 completes again.
				chain.link(0).state.n.set(BOOM)
			}
		})

		expect(() => chain.link(0).state.n.set(100))
			.not
			.toThrow()
		expect(boundReached)
			.toBe(true)
		expect(received.filter(error => error instanceof RangeError))
			.toHaveLength(1)
		// Every exception the subscriber threw while the listener looped reached the handler.
		const handed = received.filter(error => !(error instanceof RangeError))
		expect(handed)
			.toEqual(thrownBySubscriber.slice(0, -1))
		// What the handler's own write caused after the bound was rethrown, not handed back to it.
		expect(replayMicrotasks())
			.toEqual(expect.arrayContaining([thrownBySubscriber.at(-1), thrownByBoom.at(-1)]))
		expect(thrownByBoom)
			.toHaveLength(1)
		expect(calls)
			.toBeLessThan(500)
	})
})

describe('a handler that throws', () => {
	it('breaks nothing: its exception is rethrown in a microtask and the remaining reports are still handed over', () => {
		const chain = createChain(1)
		const first = new Error('first')
		const second = new Error('second')
		const handlerError = new Error('handler failed')
		chain.link(0).state.n.subscribe(thrower(first))
		chain.link(0).state.n.subscribe(thrower(second))
		const received: unknown[] = []
		setIsolatedErrorHandler((error) => {
			received.push(error)
			if (error === first)
				throw handlerError
		})

		expect(chain.link(0).state.n.set(2))
			.toEqual({ ok: true, value: 2 })
		expect(received)
			.toEqual([first, second])
		const rethrown = replayMicrotasks()
		expect(rethrown)
			.toHaveLength(1)
		expect(rethrown[0])
			.toBe(handlerError)
	})

	it('when it runs at once, still lets the remaining listeners run', () => {
		const chain = createChain(1)
		const handlerError = new Error('handler failed')
		const log: string[] = []
		chain.runtime.subscribeDisposal(thrower(new Error('first')))
		chain.runtime.subscribeDisposal(() => log.push('second notified'))
		setIsolatedErrorHandler(() => {
			throw handlerError
		})
		chain.runtime.dispose()

		expect(log)
			.toEqual(['second notified'])
		expect(replayMicrotasks())
			.toEqual([handlerError])
	})
})

describe('replacing or removing the handler while reports are queued', () => {
	it('a report still queued when the handler is replaced goes to the new handler', () => {
		const chain = createChain(1)
		const error = new Error('first')
		const first: unknown[] = []
		const second: unknown[] = []
		setIsolatedErrorHandler(error => first.push(error))
		chain.link(0).state.n.subscribe(thrower(error))
		chain.link(0).state.n.subscribe(() => setIsolatedErrorHandler(error => second.push(error)))
		chain.link(0).state.n.set(2)

		expect(first)
			.toEqual([])
		expect(second)
			.toEqual([error])
	})

	it('a report still queued when the handler is removed is rethrown in a microtask', () => {
		const chain = createChain(1)
		const error = new Error('first')
		const received = recordReports()
		chain.link(0).state.n.subscribe(thrower(error))
		chain.link(0).state.n.subscribe(() => setIsolatedErrorHandler(null))
		chain.link(0).state.n.set(2)

		expect(received)
			.toEqual([])
		expect(replayMicrotasks())
			.toEqual([error])
	})

	it('a handler that replaces itself while reports are handed over passes the rest to its replacement', () => {
		const chain = createChain(1)
		const first = new Error('first')
		const second = new Error('second')
		const before: unknown[] = []
		const after: unknown[] = []
		chain.link(0).state.n.subscribe(thrower(first))
		chain.link(0).state.n.subscribe(thrower(second))
		setIsolatedErrorHandler((error) => {
			before.push(error)
			setIsolatedErrorHandler(error => after.push(error))
		})
		chain.link(0).state.n.set(2)

		expect(before)
			.toEqual([first])
		expect(after)
			.toEqual([second])
	})
})

describe('a compute exception that several subscriptions re-read', () => {
	it('is handed over once per call, however many subscriptions re-read it; a later call that re-reads it hands it over again', () => {
		const chain = createChain(1)
		chain.link(0).properties.boom.subscribe(() => {})
		chain.link(0).properties.boom.subscribe(() => {})
		const received = recordReports()
		chain.link(0).state.n.set(BOOM)

		expect(received)
			.toHaveLength(1)
		expect(received[0])
			.toBe(thrownByBoom.at(-1))

		chain.link(0).properties.boom.subscribe(() => {})
		expect(received)
			.toHaveLength(2)
		expect(received[1])
			.toBe(received[0])
	})

	it('folds the re-reads the handler\'s own calls make into the report it is handling', () => {
		const chain = createChain(1)
		chain.link(0).properties.boom.subscribe(() => {})
		const received: unknown[] = []
		setIsolatedErrorHandler((error) => {
			received.push(error)
			chain.link(0).properties.boom.subscribe(() => {})
		})
		chain.link(0).state.n.set(BOOM)

		expect(received)
			.toHaveLength(1)
		expect(microtasks)
			.toHaveLength(0)
	})
})
