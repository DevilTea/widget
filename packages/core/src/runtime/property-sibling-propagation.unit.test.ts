/**
 * Conformance regressions: watching an Diagnostic channel must never perturb value propagation.
 *
 * Diagnostic #10 locks three properties these tests pin together:
 *
 * - every actual completed Property recompute notifies each value subscriber exactly once;
 * - `RuntimeProperty.get()` is authoritative — a fresh pull can never return a value that is no longer
 *   true, whether or not anything is subscribed;
 * - `getDiagnostics()`/`subscribeDiagnostics()` (on a Property, a Method, a State member, a `RuntimeWidget`
 *   aggregate or the Runtime aggregate) never activate evaluation *and* never change how values
 *   propagate.
 *
 * Regression source: diagnostic #20. An Diagnostic-snapshot commit performed from inside a Property evaluator
 * used to propagate immediately; with a watcher on that Diagnostic channel, `signalOper`'s
 * `if (!batchDepth) flush()` then re-entered alien-signals' flush while the evaluating computed was
 * still mid-`updateComputed` (flags `Mutable | RecursedCheck`, previous value still cached). The
 * re-entered `checkDirty` walk read that computed as clean and cleared the `Pending` flag of every
 * dependent it had not visited yet, so each dependent after the first went permanently
 * clean-but-stale — no notification, and a stale fresh pull. Every test below therefore asserts *all*
 * dependents, never only the first one, and always re-pulls with `get()`.
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface HostInterfaces {
	state: {
		answer: string | null
		evenOnly: number
		/** Drives `poisoned`, whose recompute throws on one specific value. */
		poison: number
		/** Drives `healthy`, which is never involved in a throw. */
		other: number
	}
	properties: {
		/** Fails via `addDiagnostic` while `answer` is `null`. */
		upstream: number
		/** Sibling dependents of `upstream`, declared and subscribed independently. */
		dependentA: number
		dependentB: number
		/** A third dependent that is evaluated but never subscribed (fresh-pull authority). */
		dependentC: number
		/** `upstream -> midstream -> { leafA, leafB }`: the same hazard one dependency level deeper. */
		midstream: number
		leafA: number
		leafB: number
		/** A write-free Method's own Diagnostic channel, committed from inside a Property evaluator. */
		methodBacked: number
		methodLeafA: number
		methodLeafB: number
		/** Sibling dependents of the State member's value. */
		stateLeafA: number
		stateLeafB: number
		/** Its recompute throws when `poison` is `13`; used to throw *during* a deferred release. */
		poisoned: number
		/** Independent of everything above: proves later operations still flush after such a throw. */
		healthy: number
	}
	methods: {
		probe: () => number
		/** Writeful, so the state write lands inside the invocation's own batch. */
		setPoison: (next: number) => number
	}
}

function createHarness() {
	const plugin = createWidgetPlugin('host')
		.description('Test widget')
		.interfaces<HostInterfaces>()
		.state(state => state
			.answer({
				validate: (input): input is string | null => input === null || typeof input === 'string',
				default: () => null,
			})
			.evenOnly({
				validate: (input): input is number => typeof input === 'number' && input % 2 === 0,
				default: () => 0,
			})
			.poison({
				validate: (input): input is number => typeof input === 'number',
				default: () => 1,
			})
			.other({
				validate: (input): input is number => typeof input === 'number',
				default: () => 1,
			}))
		.properties(properties => properties
			.upstream({
				registerDeps: ({ dep }) => ({ answer: dep.self.state.get('answer') }),
				compute: ({ deps, addDiagnostic }) => {
					const answer = deps.answer()
					if (!answer.ok || answer.value === null) {
						addDiagnostic({ message: 'upstream: answer is missing' })
						return 0
					}
					return answer.value.length
				},
			})
			.dependentA({
				registerDeps: ({ dep }) => ({ upstream: dep.self.properties.get('upstream') }),
				compute: ({ deps }) => {
					const upstream = deps.upstream()
					return upstream.ok ? (upstream.value ?? 0) * 2 : -1
				},
			})
			.dependentB({
				registerDeps: ({ dep }) => ({ upstream: dep.self.properties.get('upstream') }),
				compute: ({ deps }) => {
					const upstream = deps.upstream()
					return upstream.ok ? (upstream.value ?? 0) * 3 : -1
				},
			})
			.dependentC({
				registerDeps: ({ dep }) => ({ upstream: dep.self.properties.get('upstream') }),
				compute: ({ deps }) => {
					const upstream = deps.upstream()
					return upstream.ok ? (upstream.value ?? 0) * 5 : -1
				},
			})
			.midstream({
				registerDeps: ({ dep }) => ({ upstream: dep.self.properties.get('upstream') }),
				compute: ({ deps }) => {
					const upstream = deps.upstream()
					return upstream.ok ? (upstream.value ?? 0) * 7 : -1
				},
			})
			.leafA({
				registerDeps: ({ dep }) => ({ midstream: dep.self.properties.get('midstream') }),
				compute: ({ deps }) => {
					const midstream = deps.midstream()
					return midstream.ok ? (midstream.value ?? 0) + 1 : -1
				},
			})
			.leafB({
				registerDeps: ({ dep }) => ({ midstream: dep.self.properties.get('midstream') }),
				compute: ({ deps }) => {
					const midstream = deps.midstream()
					return midstream.ok ? (midstream.value ?? 0) + 2 : -1
				},
			})
			.methodBacked({
				registerDeps: ({ dep }) => ({ probe: dep.self.methods.invoke('probe') }),
				compute: ({ deps }) => {
					const probe = deps.probe()
					return probe.ok ? (probe.value ?? 0) * 11 : -1
				},
			})
			.methodLeafA({
				registerDeps: ({ dep }) => ({ methodBacked: dep.self.properties.get('methodBacked') }),
				compute: ({ deps }) => {
					const methodBacked = deps.methodBacked()
					return methodBacked.ok ? (methodBacked.value ?? 0) + 1 : -1
				},
			})
			.methodLeafB({
				registerDeps: ({ dep }) => ({ methodBacked: dep.self.properties.get('methodBacked') }),
				compute: ({ deps }) => {
					const methodBacked = deps.methodBacked()
					return methodBacked.ok ? (methodBacked.value ?? 0) + 2 : -1
				},
			})
			.stateLeafA({
				registerDeps: ({ dep }) => ({ answer: dep.self.state.get('answer') }),
				compute: ({ deps }) => {
					const answer = deps.answer()
					return answer.ok && answer.value !== null ? answer.value.length : -1
				},
			})
			.stateLeafB({
				registerDeps: ({ dep }) => ({ answer: dep.self.state.get('answer') }),
				compute: ({ deps }) => {
					const answer = deps.answer()
					return answer.ok && answer.value !== null ? answer.value.length * 2 : -2
				},
			})
			.poisoned({
				registerDeps: ({ dep }) => ({ poison: dep.self.state.get('poison') }),
				compute: ({ deps }) => {
					// Reads the dependency *before* throwing, so the throw happens with the dependency edge
					// already recorded — an implementation-contract violation raised mid-recompute, not a
					// dependency-registration accident.
					const poison = deps.poison()
					const value = poison.ok ? poison.value ?? 0 : 0
					if (value === 13)
						throw new Error('poisoned: compute boom')
					return value * 2
				},
			})
			.healthy({
				registerDeps: ({ dep }) => ({ other: dep.self.state.get('other') }),
				compute: ({ deps, addDiagnostic }) => {
					const other = deps.other()
					const value = other.ok ? other.value ?? 0 : 0
					if (value < 0) {
						addDiagnostic({ message: 'healthy: other is negative' })
						return 0
					}
					return value
				},
			}))
		.methods(methods => methods
			.probe({
				registerDeps: ({ dep }) => ({ answer: dep.self.state.get('answer') }),
				validateArgs: (args): args is [] => args.length === 0,
				// Write-free, so a Property is allowed to depend on it (a writeful Method would make the
				// Blueprint invalid). It still commits its own Diagnostic snapshot on every invocation.
				execute: ({ deps, addDiagnostic }) => {
					const answer = deps.answer()
					if (!answer.ok || answer.value === null) {
						addDiagnostic({ message: 'probe: answer is missing' })
						return 0
					}
					return answer.value.length
				},
			})
			.setPoison({
				registerDeps: ({ dep }) => ({ setPoison: dep.self.state.set('poison') }),
				validateArgs: (args): args is [number] => typeof args[0] === 'number',
				// The whole invocation is one alien batch, so this write's propagation is still queued when
				// the invocation ends: the queued Property subscription is run by the deferred release.
				execute: ({ args, deps }) => {
					deps.setPoison(args[0])
					return args[0]
				},
			}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'host', type: 'host' })
	if (blueprint.status !== 'valid')
		throw new Error(`expected a valid Blueprint: ${JSON.stringify(blueprint.diagnostics)}`)

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('host')
	if (widget === null)
		throw new Error('expected the host widget to exist')

	return { runtime, widget }
}

describe('property value propagation under an upstream Property diagnostics-subscription', () => {
	it('notifies every sibling dependent exactly once and keeps every fresh pull authoritative', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.dependentA.subscribe(result => eventsA.push(result))
		widget.properties.dependentB.subscribe(result => eventsB.push(result))
		widget.properties.upstream.subscribeDiagnostics(() => {})

		expect(widget.properties.dependentA.get())
			.toEqual({ ok: true, value: 10 })
		expect(widget.properties.dependentB.get())
			.toEqual({ ok: true, value: 15 })
		// Evaluated, never subscribed: its cached result must still be invalidated by the flip below.
		expect(widget.properties.dependentC.get())
			.toEqual({ ok: true, value: 25 })

		eventsA.length = 0
		eventsB.length = 0

		widget.state.answer.set(null)

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(eventsA[0])
			.toMatchObject({ ok: false })
		expect(eventsB[0])
			.toMatchObject({ ok: false })

		expect(widget.properties.dependentA.get().ok)
			.toBe(false)
		expect(widget.properties.dependentB.get().ok)
			.toBe(false)
		expect(widget.properties.dependentC.get().ok)
			.toBe(false)
	})

	it('behaves identically without the diagnostics-subscription (control)', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.dependentA.subscribe(result => eventsA.push(result))
		widget.properties.dependentB.subscribe(result => eventsB.push(result))

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set(null)

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(widget.properties.dependentA.get().ok)
			.toBe(false)
		expect(widget.properties.dependentB.get().ok)
			.toBe(false)
	})

	it('is independent of the order in which the dependents subscribed (positional)', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		// Reverse of the first case: whichever dependent subscribed first must not be privileged.
		widget.properties.dependentB.subscribe(result => eventsB.push(result))
		widget.properties.dependentA.subscribe(result => eventsA.push(result))
		widget.properties.upstream.subscribeDiagnostics(() => {})

		expect(widget.properties.dependentA.get().ok)
			.toBe(true)
		expect(widget.properties.dependentB.get().ok)
			.toBe(true)

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set(null)

		expect(eventsB)
			.toHaveLength(1)
		expect(eventsA)
			.toHaveLength(1)
		expect(widget.properties.dependentB.get().ok)
			.toBe(false)
		expect(widget.properties.dependentA.get().ok)
			.toBe(false)
	})

	it('keeps sibling dependents live one dependency level below the diagnostics-subscription', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.leafA.subscribe(result => eventsA.push(result))
		widget.properties.leafB.subscribe(result => eventsB.push(result))
		widget.properties.upstream.subscribeDiagnostics(() => {})

		expect(widget.properties.leafA.get())
			.toEqual({ ok: true, value: 36 })
		expect(widget.properties.leafB.get())
			.toEqual({ ok: true, value: 37 })

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set(null)

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(widget.properties.leafA.get().ok)
			.toBe(false)
		expect(widget.properties.leafB.get().ok)
			.toBe(false)
	})

	it('still commits the upstream diagnostic snapshot by the time the flip is observable', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const diagnosticEventLengths: number[] = []
		const seenDuringValueNotification: number[] = []
		widget.properties.upstream.subscribeDiagnostics(diagnostics => diagnosticEventLengths.push(diagnostics.length))
		widget.properties.dependentA.subscribe(() => {
			// A value listener must already see the Diagnostic snapshot the very same operation committed.
			seenDuringValueNotification.push(widget.properties.upstream.getDiagnostics().length)
		})
		widget.properties.dependentB.subscribe(() => {})

		expect(widget.properties.dependentA.get().ok)
			.toBe(true)
		expect(widget.properties.upstream.getDiagnostics())
			.toEqual([])

		widget.state.answer.set(null)

		expect(widget.properties.upstream.getDiagnostics())
			.toHaveLength(1)
		expect(seenDuringValueNotification)
			.toEqual([1])
		expect(diagnosticEventLengths)
			.toEqual([1])
	})

	it('emits no diagnostic notification for a ok -> ok recompute', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		let diagnosticNotifications = 0
		widget.properties.upstream.subscribeDiagnostics(() => diagnosticNotifications++)
		const valueEvents: unknown[] = []
		widget.properties.dependentA.subscribe(result => valueEvents.push(result))
		widget.properties.dependentB.subscribe(result => valueEvents.push(result))

		expect(widget.properties.dependentA.get().ok)
			.toBe(true)
		expect(widget.properties.dependentB.get().ok)
			.toBe(true)
		valueEvents.length = 0

		widget.state.answer.set('world')

		expect(valueEvents)
			.toHaveLength(2)
		expect(diagnosticNotifications)
			.toBe(0)
		expect(widget.properties.upstream.getDiagnostics())
			.toEqual([])
	})
})

describe('property value propagation under aggregate diagnostic subscriptions', () => {
	it('keeps every sibling dependent live under a RuntimeWidget aggregate diagnostics-subscription', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.dependentA.subscribe(result => eventsA.push(result))
		widget.properties.dependentB.subscribe(result => eventsB.push(result))
		widget.subscribeDiagnostics(() => {})

		expect(widget.properties.dependentA.get().ok)
			.toBe(true)
		expect(widget.properties.dependentB.get().ok)
			.toBe(true)

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set(null)

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(widget.properties.dependentA.get().ok)
			.toBe(false)
		expect(widget.properties.dependentB.get().ok)
			.toBe(false)
	})

	it('keeps every sibling dependent live under runtime.subscribeDiagnostics()', () => {
		const { runtime, widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.dependentA.subscribe(result => eventsA.push(result))
		widget.properties.dependentB.subscribe(result => eventsB.push(result))
		runtime.subscribeDiagnostics(() => {})

		expect(widget.properties.dependentA.get().ok)
			.toBe(true)
		expect(widget.properties.dependentB.get().ok)
			.toBe(true)

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set(null)

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(widget.properties.dependentA.get().ok)
			.toBe(false)
		expect(widget.properties.dependentB.get().ok)
			.toBe(false)
	})
})

describe('property value propagation under a Method diagnostics-subscription', () => {
	it('keeps every sibling dependent live when the Diagnostic snapshot committed mid-evaluation is a Method\'s', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.methodLeafA.subscribe(result => eventsA.push(result))
		widget.properties.methodLeafB.subscribe(result => eventsB.push(result))
		// The Method is invoked from inside `methodBacked`'s evaluator, so this is the Method-side twin of
		// the Property case above: its own diagnostic-snapshot commit happens mid-evaluation.
		widget.methods.probe.subscribeDiagnostics(() => {})

		expect(widget.properties.methodLeafA.get())
			.toEqual({ ok: true, value: 56 })
		expect(widget.properties.methodLeafB.get())
			.toEqual({ ok: true, value: 57 })

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set(null)

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(widget.properties.methodLeafA.get().ok)
			.toBe(false)
		expect(widget.properties.methodLeafB.get().ok)
			.toBe(false)
	})
})

describe('property value propagation under a State diagnostics-subscription', () => {
	it('keeps every dependent of the State member live and commits the state Diagnostic snapshot in the same set()', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.stateLeafA.subscribe(result => eventsA.push(result))
		widget.properties.stateLeafB.subscribe(result => eventsB.push(result))
		widget.state.answer.subscribeDiagnostics(() => {})

		expect(widget.properties.stateLeafA.get())
			.toEqual({ ok: true, value: 5 })
		expect(widget.properties.stateLeafB.get())
			.toEqual({ ok: true, value: 10 })

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set('worlds')

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(widget.properties.stateLeafA.get())
			.toEqual({ ok: true, value: 6 })
		expect(widget.properties.stateLeafB.get())
			.toEqual({ ok: true, value: 12 })
	})

	it('publishes a rejected set()\'s state Diagnostic snapshot before the caller resumes', () => {
		const { widget } = createHarness()

		const diagnosticEventLengths: number[] = []
		widget.state.evenOnly.subscribeDiagnostics(diagnostics => diagnosticEventLengths.push(diagnostics.length))

		const rejected = widget.state.evenOnly.set(3)

		expect(rejected.ok)
			.toBe(false)
		expect(widget.state.evenOnly.getDiagnostics())
			.toHaveLength(1)
		expect(diagnosticEventLengths)
			.toEqual([1])

		const accepted = widget.state.evenOnly.set(4)

		expect(accepted)
			.toEqual({ ok: true, value: 4 })
		expect(widget.state.evenOnly.getDiagnostics())
			.toEqual([])
		expect(diagnosticEventLengths)
			.toEqual([1, 0])
	})
})

describe('deferred diagnostic propagation released after a throw', () => {
	it('leaves later independent operations flushing normally', () => {
		const { widget } = createHarness()

		// `healthy` shares nothing with the throwing Property: it is the independent witness that the
		// Runtime is still able to propagate and notify afterwards.
		const healthyValues: unknown[] = []
		const healthyDiagnosticLengths: number[] = []
		widget.properties.healthy.subscribe(result => healthyValues.push(result))
		widget.properties.healthy.subscribeDiagnostics(diagnostics => healthyDiagnosticLengths.push(diagnostics.length))
		// Subscribed so its recompute is a *queued* effect run by the deferred release, not by the write.
		widget.properties.poisoned.subscribe(() => {})

		expect(widget.properties.healthy.get())
			.toEqual({ ok: true, value: 1 })
		expect(widget.properties.poisoned.get())
			.toEqual({ ok: true, value: 2 })

		// A Method invocation batches its state write, so the queued `poisoned` recompute only runs when
		// the deferred diagnostic propagation is released — and that recompute throws (an implementation
		// contract violation, isolated for external listeners but never for a tracked read).
		let caught: unknown
		try {
			widget.methods.setPoison(13)
		}
		catch (error) {
			caught = error
		}

		expect(caught)
			.toBeInstanceOf(Error)
		expect((caught as Error).message)
			.toBe('poisoned: compute boom')

		healthyValues.length = 0
		healthyDiagnosticLengths.length = 0

		// Both channels of a completely unrelated Property must still fire, twice in a row: if the throw
		// had left the release bookkeeping pinned, later operations would look nested, nothing would ever
		// be released again, and alien-signals would stay batched with these notifications suspended.
		widget.state.other.set(-1)

		expect(healthyValues)
			.toHaveLength(1)
		expect(healthyDiagnosticLengths)
			.toEqual([1])

		widget.state.other.set(2)

		expect(healthyValues)
			.toHaveLength(2)
		expect(healthyDiagnosticLengths)
			.toEqual([1, 0])
		expect(widget.properties.healthy.get())
			.toEqual({ ok: true, value: 2 })
	})
})
