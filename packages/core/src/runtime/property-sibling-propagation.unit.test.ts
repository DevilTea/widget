/**
 * Conformance regressions: watching an Issue channel must never perturb value propagation.
 *
 * Issue #10 locks three properties these tests pin together:
 *
 * - every actual completed Property recompute notifies each value subscriber exactly once;
 * - `RuntimeProperty.get()` is authoritative — a fresh pull can never return a value that is no longer
 *   true, whether or not anything is subscribed;
 * - `getIssues()`/`subscribeIssues()` (on a Property, a Method, a State member, a `RuntimeWidget`
 *   aggregate or the Runtime aggregate) never activate evaluation *and* never change how values
 *   propagate.
 *
 * Regression source: issue #20. An Issue-snapshot commit performed from inside a Property evaluator
 * used to propagate immediately; with a watcher on that Issue channel, `signalOper`'s
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
	}
	properties: {
		/** Fails via `addIssue` while `answer` is `null`. */
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
		/** A write-free Method's own Issue channel, committed from inside a Property evaluator. */
		methodBacked: number
		methodLeafA: number
		methodLeafB: number
		/** Sibling dependents of the State member's value. */
		stateLeafA: number
		stateLeafB: number
	}
	methods: {
		probe: () => number
	}
}

function createHarness() {
	const plugin = createWidgetPlugin('host')
		.interfaces<HostInterfaces>()
		.state(state => state
			.answer({
				validate: (input): input is string | null => input === null || typeof input === 'string',
				default: () => null,
			})
			.evenOnly({
				validate: (input): input is number => typeof input === 'number' && input % 2 === 0,
				default: () => 0,
			}))
		.properties(properties => properties
			.upstream({
				registerDeps: ({ dep }) => ({ answer: dep.self.state.get('answer') }),
				compute: ({ deps, addIssue }) => {
					const answer = deps.answer()
					if (!answer.success || answer.value === null) {
						addIssue({ message: 'upstream: answer is missing' })
						return 0
					}
					return answer.value.length
				},
			})
			.dependentA({
				registerDeps: ({ dep }) => ({ upstream: dep.self.properties.get('upstream') }),
				compute: ({ deps }) => {
					const upstream = deps.upstream()
					return upstream.success ? (upstream.value ?? 0) * 2 : -1
				},
			})
			.dependentB({
				registerDeps: ({ dep }) => ({ upstream: dep.self.properties.get('upstream') }),
				compute: ({ deps }) => {
					const upstream = deps.upstream()
					return upstream.success ? (upstream.value ?? 0) * 3 : -1
				},
			})
			.dependentC({
				registerDeps: ({ dep }) => ({ upstream: dep.self.properties.get('upstream') }),
				compute: ({ deps }) => {
					const upstream = deps.upstream()
					return upstream.success ? (upstream.value ?? 0) * 5 : -1
				},
			})
			.midstream({
				registerDeps: ({ dep }) => ({ upstream: dep.self.properties.get('upstream') }),
				compute: ({ deps }) => {
					const upstream = deps.upstream()
					return upstream.success ? (upstream.value ?? 0) * 7 : -1
				},
			})
			.leafA({
				registerDeps: ({ dep }) => ({ midstream: dep.self.properties.get('midstream') }),
				compute: ({ deps }) => {
					const midstream = deps.midstream()
					return midstream.success ? (midstream.value ?? 0) + 1 : -1
				},
			})
			.leafB({
				registerDeps: ({ dep }) => ({ midstream: dep.self.properties.get('midstream') }),
				compute: ({ deps }) => {
					const midstream = deps.midstream()
					return midstream.success ? (midstream.value ?? 0) + 2 : -1
				},
			})
			.methodBacked({
				registerDeps: ({ dep }) => ({ probe: dep.self.methods.invoke('probe') }),
				compute: ({ deps }) => {
					const probe = deps.probe()
					return probe.success ? (probe.value ?? 0) * 11 : -1
				},
			})
			.methodLeafA({
				registerDeps: ({ dep }) => ({ methodBacked: dep.self.properties.get('methodBacked') }),
				compute: ({ deps }) => {
					const methodBacked = deps.methodBacked()
					return methodBacked.success ? (methodBacked.value ?? 0) + 1 : -1
				},
			})
			.methodLeafB({
				registerDeps: ({ dep }) => ({ methodBacked: dep.self.properties.get('methodBacked') }),
				compute: ({ deps }) => {
					const methodBacked = deps.methodBacked()
					return methodBacked.success ? (methodBacked.value ?? 0) + 2 : -1
				},
			})
			.stateLeafA({
				registerDeps: ({ dep }) => ({ answer: dep.self.state.get('answer') }),
				compute: ({ deps }) => {
					const answer = deps.answer()
					return answer.success && answer.value !== null ? answer.value.length : -1
				},
			})
			.stateLeafB({
				registerDeps: ({ dep }) => ({ answer: dep.self.state.get('answer') }),
				compute: ({ deps }) => {
					const answer = deps.answer()
					return answer.success && answer.value !== null ? answer.value.length * 2 : -2
				},
			}))
		.methods(methods => methods
			.probe({
				registerDeps: ({ dep }) => ({ answer: dep.self.state.get('answer') }),
				validateArgs: (args): args is [] => args.length === 0,
				// Write-free, so a Property is allowed to depend on it (a writeful Method would make the
				// Blueprint invalid). It still commits its own Issue snapshot on every invocation.
				execute: ({ deps, addIssue }) => {
					const answer = deps.answer()
					if (!answer.success || answer.value === null) {
						addIssue({ message: 'probe: answer is missing' })
						return 0
					}
					return answer.value.length
				},
			}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'host', type: 'host' })
	if (blueprint.status !== 'valid')
		throw new Error(`expected a valid Blueprint: ${JSON.stringify(blueprint.getCollectedIssues())}`)

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('host')
	if (widget === null)
		throw new Error('expected the host widget to exist')

	return { runtime, widget }
}

describe('property value propagation under an upstream Property issues-subscription', () => {
	it('notifies every sibling dependent exactly once and keeps every fresh pull authoritative', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.dependentA.subscribe(result => eventsA.push(result))
		widget.properties.dependentB.subscribe(result => eventsB.push(result))
		widget.properties.upstream.subscribeIssues(() => {})

		expect(widget.properties.dependentA.get())
			.toEqual({ success: true, value: 10 })
		expect(widget.properties.dependentB.get())
			.toEqual({ success: true, value: 15 })
		// Evaluated, never subscribed: its cached result must still be invalidated by the flip below.
		expect(widget.properties.dependentC.get())
			.toEqual({ success: true, value: 25 })

		eventsA.length = 0
		eventsB.length = 0

		widget.state.answer.set(null)

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(eventsA[0])
			.toMatchObject({ success: false })
		expect(eventsB[0])
			.toMatchObject({ success: false })

		expect(widget.properties.dependentA.get().success)
			.toBe(false)
		expect(widget.properties.dependentB.get().success)
			.toBe(false)
		expect(widget.properties.dependentC.get().success)
			.toBe(false)
	})

	it('behaves identically without the issues-subscription (control)', () => {
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
		expect(widget.properties.dependentA.get().success)
			.toBe(false)
		expect(widget.properties.dependentB.get().success)
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
		widget.properties.upstream.subscribeIssues(() => {})

		expect(widget.properties.dependentA.get().success)
			.toBe(true)
		expect(widget.properties.dependentB.get().success)
			.toBe(true)

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set(null)

		expect(eventsB)
			.toHaveLength(1)
		expect(eventsA)
			.toHaveLength(1)
		expect(widget.properties.dependentB.get().success)
			.toBe(false)
		expect(widget.properties.dependentA.get().success)
			.toBe(false)
	})

	it('keeps sibling dependents live one dependency level below the issues-subscription', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.leafA.subscribe(result => eventsA.push(result))
		widget.properties.leafB.subscribe(result => eventsB.push(result))
		widget.properties.upstream.subscribeIssues(() => {})

		expect(widget.properties.leafA.get())
			.toEqual({ success: true, value: 36 })
		expect(widget.properties.leafB.get())
			.toEqual({ success: true, value: 37 })

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set(null)

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(widget.properties.leafA.get().success)
			.toBe(false)
		expect(widget.properties.leafB.get().success)
			.toBe(false)
	})

	it('still commits the upstream issue snapshot by the time the flip is observable', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const issueEventLengths: number[] = []
		const seenDuringValueNotification: number[] = []
		widget.properties.upstream.subscribeIssues(issues => issueEventLengths.push(issues.length))
		widget.properties.dependentA.subscribe(() => {
			// A value listener must already see the Issue snapshot the very same operation committed.
			seenDuringValueNotification.push(widget.properties.upstream.getIssues().length)
		})
		widget.properties.dependentB.subscribe(() => {})

		expect(widget.properties.dependentA.get().success)
			.toBe(true)
		expect(widget.properties.upstream.getIssues())
			.toEqual([])

		widget.state.answer.set(null)

		expect(widget.properties.upstream.getIssues())
			.toHaveLength(1)
		expect(seenDuringValueNotification)
			.toEqual([1])
		expect(issueEventLengths)
			.toEqual([1])
	})

	it('emits no issue notification for a success -> success recompute', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		let issueNotifications = 0
		widget.properties.upstream.subscribeIssues(() => issueNotifications++)
		const valueEvents: unknown[] = []
		widget.properties.dependentA.subscribe(result => valueEvents.push(result))
		widget.properties.dependentB.subscribe(result => valueEvents.push(result))

		expect(widget.properties.dependentA.get().success)
			.toBe(true)
		expect(widget.properties.dependentB.get().success)
			.toBe(true)
		valueEvents.length = 0

		widget.state.answer.set('world')

		expect(valueEvents)
			.toHaveLength(2)
		expect(issueNotifications)
			.toBe(0)
		expect(widget.properties.upstream.getIssues())
			.toEqual([])
	})
})

describe('property value propagation under aggregate issue subscriptions', () => {
	it('keeps every sibling dependent live under a RuntimeWidget aggregate issues-subscription', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.dependentA.subscribe(result => eventsA.push(result))
		widget.properties.dependentB.subscribe(result => eventsB.push(result))
		widget.subscribeIssues(() => {})

		expect(widget.properties.dependentA.get().success)
			.toBe(true)
		expect(widget.properties.dependentB.get().success)
			.toBe(true)

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set(null)

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(widget.properties.dependentA.get().success)
			.toBe(false)
		expect(widget.properties.dependentB.get().success)
			.toBe(false)
	})

	it('keeps every sibling dependent live under runtime.subscribeCollectedIssues()', () => {
		const { runtime, widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.dependentA.subscribe(result => eventsA.push(result))
		widget.properties.dependentB.subscribe(result => eventsB.push(result))
		runtime.subscribeCollectedIssues(() => {})

		expect(widget.properties.dependentA.get().success)
			.toBe(true)
		expect(widget.properties.dependentB.get().success)
			.toBe(true)

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set(null)

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(widget.properties.dependentA.get().success)
			.toBe(false)
		expect(widget.properties.dependentB.get().success)
			.toBe(false)
	})
})

describe('property value propagation under a Method issues-subscription', () => {
	it('keeps every sibling dependent live when the Issue snapshot committed mid-evaluation is a Method\'s', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.methodLeafA.subscribe(result => eventsA.push(result))
		widget.properties.methodLeafB.subscribe(result => eventsB.push(result))
		// The Method is invoked from inside `methodBacked`'s evaluator, so this is the Method-side twin of
		// the Property case above: its own issue-snapshot commit happens mid-evaluation.
		widget.methods.probe.subscribeIssues(() => {})

		expect(widget.properties.methodLeafA.get())
			.toEqual({ success: true, value: 56 })
		expect(widget.properties.methodLeafB.get())
			.toEqual({ success: true, value: 57 })

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set(null)

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(widget.properties.methodLeafA.get().success)
			.toBe(false)
		expect(widget.properties.methodLeafB.get().success)
			.toBe(false)
	})
})

describe('property value propagation under a State issues-subscription', () => {
	it('keeps every dependent of the State member live and commits the state Issue snapshot in the same set()', () => {
		const { widget } = createHarness()
		widget.state.answer.set('hello')

		const eventsA: unknown[] = []
		const eventsB: unknown[] = []
		widget.properties.stateLeafA.subscribe(result => eventsA.push(result))
		widget.properties.stateLeafB.subscribe(result => eventsB.push(result))
		widget.state.answer.subscribeIssues(() => {})

		expect(widget.properties.stateLeafA.get())
			.toEqual({ success: true, value: 5 })
		expect(widget.properties.stateLeafB.get())
			.toEqual({ success: true, value: 10 })

		eventsA.length = 0
		eventsB.length = 0
		widget.state.answer.set('worlds')

		expect(eventsA)
			.toHaveLength(1)
		expect(eventsB)
			.toHaveLength(1)
		expect(widget.properties.stateLeafA.get())
			.toEqual({ success: true, value: 6 })
		expect(widget.properties.stateLeafB.get())
			.toEqual({ success: true, value: 12 })
	})

	it('publishes a rejected set()\'s state Issue snapshot before the caller resumes', () => {
		const { widget } = createHarness()

		const issueEventLengths: number[] = []
		widget.state.evenOnly.subscribeIssues(issues => issueEventLengths.push(issues.length))

		const rejected = widget.state.evenOnly.set(3)

		expect(rejected.success)
			.toBe(false)
		expect(widget.state.evenOnly.getIssues())
			.toHaveLength(1)
		expect(issueEventLengths)
			.toEqual([1])

		const accepted = widget.state.evenOnly.set(4)

		expect(accepted)
			.toEqual({ success: true, value: 4 })
		expect(widget.state.evenOnly.getIssues())
			.toEqual([])
		expect(issueEventLengths)
			.toEqual([1, 0])
	})
})
