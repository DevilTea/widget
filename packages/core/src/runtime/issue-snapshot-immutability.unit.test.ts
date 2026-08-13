/**
 * Regression coverage for PR #12 round-2 review finding 3773696025 (`runtime/collector.ts` mutable
 * completed issue snapshot).
 *
 * `ExecutionResult.failure.issues` is an immutable final snapshot for that operation, and `getIssues()`
 * is the latest *completed* snapshot — the very same array/reference, per
 * `issue-snapshot.unit.test.ts`. Before this fix, `finalize()` returned a plain `entries.map(...)`
 * array, so `result.issues.push(fakeIssue)` (or any other external mutation, including through `as
 * any`) silently corrupted the primitive's own `getIssues()` state without any Runtime operation or
 * signal update ever running. `EMPTY_ISSUES` was already frozen; this closes the same gap for every
 * non-empty completed snapshot across State, Property and Method.
 *
 * Normative source: issue #10 issue-snapshot contract (consolidated handoff §16).
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface SnapshotInterfaces {
	state: {
		count: number
	}
	properties: {
		flaky: number
		viaFlaky: number
	}
	methods: {
		flakyMethod: () => number
	}
}

function createHarness() {
	let propertyShouldFail = false
	let methodShouldFail = false

	const plugin = createWidgetPlugin('counter')
		.interfaces<SnapshotInterfaces>()
		.state(state => state.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}))
		.properties(properties => properties
			.flaky({
				compute: ({ addIssue }) => {
					if (propertyShouldFail)
						addIssue({ message: 'property flaky failed' })
					return 0
				},
			})
			// Depends on `flaky`, so a wrapped target failure here carries a `property-dependency`
			// source with both `dependency` (a `BlueprintDependencyReference`) and `related` (a
			// `RuntimeIssueLocation` array) — the two structural fields round-3 finding 3773890357
			// covers beyond the plain shallow `Object.freeze(issue)`.
			.viaFlaky({
				registerDeps: ({ dep }) => ({ flaky: dep.self.properties.get('flaky') }),
				compute: ({ deps }) => {
					const result = deps.flaky()
					return result.success ? result.value ?? 0 : -1
				},
			}))
		.methods(methods => methods.flakyMethod({
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ addIssue }) => {
				if (methodShouldFail)
					addIssue({ message: 'method flaky failed' })
				return 0
			},
		}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'counter' })
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid blueprint, got issues: ${JSON.stringify(blueprint.getCollectedIssues())}`)

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')
	if (widget === null)
		throw new Error('Expected the "root" widget to exist.')

	return {
		runtime,
		widget,
		setPropertyShouldFail: (value: boolean) => {
			propertyShouldFail = value
		},
		setMethodShouldFail: (value: boolean) => {
			methodShouldFail = value
		},
	}
}

/** A stand-in issue shaped closely enough to pass structurally as a `RuntimeIssue` under `any`. */
const fakeIssue = { source: { type: 'forged' }, message: 'forged' }

describe('completed non-empty issue snapshots are frozen (round-2 finding 3773696025)', () => {
	it('state.set failure: `result.issues` is frozen, is the same reference as getIssues(), and a mutation attempt does not corrupt subsequent reads', () => {
		const { widget } = createHarness()

		const result = widget.state.count.set('nope' as unknown as number)

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(Object.isFrozen(result.issues))
			.toBe(true)
		expect(Object.isFrozen(result.issues[0]))
			.toBe(true)
		expect(widget.state.count.getIssues())
			.toBe(result.issues)

		expect(() => (result.issues as unknown as unknown[]).push(fakeIssue))
			.toThrow(TypeError)
		expect(widget.state.count.getIssues())
			.toHaveLength(1)
		expect(widget.state.count.getIssues())
			.toBe(result.issues)
	})

	it('property.get failure: `result.issues` is frozen and immune to external mutation attempts', () => {
		const { widget, setPropertyShouldFail } = createHarness()
		setPropertyShouldFail(true)

		const result = widget.properties.flaky.get()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(Object.isFrozen(result.issues))
			.toBe(true)
		expect(widget.properties.flaky.getIssues())
			.toBe(result.issues)

		expect(() => (result.issues as unknown as unknown[]).push(fakeIssue))
			.toThrow(TypeError)
		expect(widget.properties.flaky.getIssues())
			.toHaveLength(1)
	})

	it('method call failure: `result.issues` is frozen and immune to external mutation attempts', () => {
		const { widget, setMethodShouldFail } = createHarness()
		setMethodShouldFail(true)

		const result = widget.methods.flakyMethod()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(Object.isFrozen(result.issues))
			.toBe(true)
		expect(widget.methods.flakyMethod.getIssues())
			.toBe(result.issues)

		expect(() => (result.issues as unknown as unknown[]).push(fakeIssue))
			.toThrow(TypeError)
		expect(widget.methods.flakyMethod.getIssues())
			.toHaveLength(1)
	})

	it('the framework generic-fallback issue array (no addIssue call) is frozen too', () => {
		const { widget } = createHarness()

		const result = widget.state.count.set('nope' as unknown as number)

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(result.issues[0]!.source.type)
			.toBe('state-validation')
		expect(Object.isFrozen(result.issues))
			.toBe(true)
	})

	it('an attempted mutation of a failure snapshot does not leak a forged issue into the Runtime aggregate', () => {
		const { runtime, widget, setPropertyShouldFail } = createHarness()
		setPropertyShouldFail(true)

		const result = widget.properties.flaky.get()
		if (result.success)
			throw new Error('Expected a failure result.')

		try {
			(result.issues as unknown as unknown[]).push(fakeIssue)
		}
		catch {
			// Expected: frozen arrays throw on mutation in strict mode (ESM is always strict).
		}

		expect(widget.properties.flaky.getIssues())
			.toHaveLength(1)
		expect(runtime.getCollectedIssues())
			.toHaveLength(1)
		expect(runtime.getCollectedIssues())
			.not.toContain(fakeIssue)
	})
})

describe('completed issue snapshots are deep-frozen — source and its structural fields, not just the top-level issue (round-3 finding 3773890357)', () => {
	it('the `source` object itself rejects field mutation and stays canonical afterward', () => {
		const { widget } = createHarness()

		const result = widget.state.count.set('nope' as unknown as number)
		if (result.success)
			throw new Error('Expected a failure result.')

		const source = result.issues[0]!.source as unknown as Record<string, unknown>
		expect(Object.isFrozen(source))
			.toBe(true)
		expect(() => {
			source.widgetId = 'forged'
		})
			.toThrow(TypeError)

		expect(result.issues[0]!.source.widgetId)
			.toBe('root')
		expect(widget.state.count.getIssues()[0]!.source.widgetId)
			.toBe('root')
	})

	it('a property-dependency issue\'s `related` array, its location wrapper, and `dependency` reference all reject mutation', () => {
		const { widget, setPropertyShouldFail } = createHarness()
		setPropertyShouldFail(true)

		const result = widget.properties.viaFlaky.get()
		if (result.success)
			throw new Error('Expected a failure result.')

		const source = result.issues[0]!.source
		if (source.type !== 'property-dependency')
			throw new Error('Expected a property-dependency issue.')

		expect(Object.isFrozen(source.related))
			.toBe(true)
		expect(Object.isFrozen(source.related![0]))
			.toBe(true)
		expect(Object.isFrozen(source.dependency))
			.toBe(true)
		expect(Object.isFrozen(source.dependency.target))
			.toBe(true)
		expect(Object.isFrozen(source.dependency.operation))
			.toBe(true)

		const relatedArray = source.related as unknown as unknown[]
		const relatedLocation = source.related![0] as unknown as Record<string, unknown>
		const dependencyRecord = source.dependency as unknown as Record<string, unknown>

		expect(() => relatedArray.push({ type: 'forged' }))
			.toThrow(TypeError)
		expect(() => {
			relatedLocation.name = 'forged'
		})
			.toThrow(TypeError)
		expect(() => {
			dependencyRecord.target = { type: 'forged' }
		})
			.toThrow(TypeError)

		// Canonical afterward: none of the attempted mutations above landed.
		expect(source.related)
			.toEqual([{ type: 'property', widgetId: 'root', name: 'flaky' }])
		expect(source.dependency)
			.toEqual({ target: { type: 'self' }, operation: { type: 'property-get', name: 'flaky' } })
		expect(widget.properties.viaFlaky.getIssues())
			.toEqual(result.issues)
	})

	it('does not freeze arbitrary payload values carried for diagnostic display (`candidate`/`result`)', () => {
		const { widget } = createHarness()

		// A mutable plain object used as the rejected candidate: only the diagnostic *structure* around
		// it is frozen, never the payload value itself.
		const mutableCandidate: Record<string, unknown> = { tag: 'original' }
		const result = widget.state.count.set(mutableCandidate as unknown as number)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(Object.isFrozen(result.issues[0]!.source.candidate))
			.toBe(false)
		expect(() => {
			mutableCandidate.tag = 'mutated'
		}).not.toThrow()
	})
})

describe('dependency-call issue snapshots are frozen before both collector insertion and return to plugin code (round-3 finding 3773890368)', () => {
	it('a plugin attempting to mutate depResult.issues[0] inside the callback cannot corrupt the outer consumer snapshot', () => {
		let mutationThrew = false

		interface MutateProbeInterfaces {
			properties: {
				flaky: number
				viaFlakyMutating: number
			}
		}

		const plugin = createWidgetPlugin('mutate-probe')
			.interfaces<MutateProbeInterfaces>()
			.properties(properties => properties
				.flaky({
					compute: ({ addIssue }) => {
						addIssue({ message: 'flaky failed' })
						return 0
					},
				})
				.viaFlakyMutating({
					registerDeps: ({ dep }) => ({ flaky: dep.self.properties.get('flaky') }),
					compute: ({ deps }) => {
						const depResult = deps.flaky()
						if (!depResult.success) {
							try {
								(depResult.issues[0] as unknown as Record<string, unknown>).message = 'mutated by plugin code'
							}
							catch {
								mutationThrew = true
							}
						}
						return 0
					},
				}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'mutate-probe' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')

		const result = widget.properties.viaFlakyMutating.get()

		// The dependency issue was already frozen (both before insertion into the active collector and
		// before being handed back to plugin code as `depResult.issues[0]`), so the plugin's own
		// mutation attempt threw and never landed.
		expect(mutationThrew)
			.toBe(true)

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(result.issues[0]!.message)
			.toBe('flaky failed')
		expect(widget.properties.viaFlakyMutating.getIssues()[0]!.message)
			.toBe('flaky failed')
	})
})

describe('runtime.getIssues() exposes an immutable runtime-level snapshot (round-3 finding 3773890376)', () => {
	interface OverrideProbeInterfaces {
		state: {
			count: number
		}
	}

	it('a malformed overrideStateDefaults produces non-empty runtime-level issues that reject mutation and stay canonical', () => {
		const plugin = createWidgetPlugin('override-probe')
			.interfaces<OverrideProbeInterfaces>()
			.state(state => state.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => 0,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'override-probe' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		// A malformed (non-record) `overrideStateDefaults` is best-effort-recovered into exactly one
		// runtime-level `state-override` issue, never blocking Runtime creation.
		const runtime = blueprint.createRuntime({ overrideStateDefaults: 'not-a-record' as unknown as Record<string, Record<string, unknown>> })

		const issues = runtime.getIssues()
		expect(issues.length)
			.toBeGreaterThan(0)
		expect(Object.isFrozen(issues))
			.toBe(true)
		expect(Object.isFrozen(issues[0]))
			.toBe(true)

		const fake = { source: { type: 'forged' }, message: 'forged' }
		expect(() => (issues as unknown as unknown[]).push(fake))
			.toThrow(TypeError)

		expect(runtime.getIssues())
			.toBe(issues)
		expect(runtime.getIssues())
			.not.toContain(fake)
		expect(runtime.getCollectedIssues())
			.not.toContain(fake)
	})

	it('a normal best-effort path (unknown widget id, valid top-level record) also produces a frozen runtime-level snapshot (round-4 finding 3774140630)', () => {
		const plugin = createWidgetPlugin('override-probe-normal')
			.interfaces<OverrideProbeInterfaces>()
			.state(state => state.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => 0,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'override-probe-normal' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		// A *valid top-level record* whose only problem is an unknown widget id: this reaches the
		// function's final return, not either early-return branch (`undefined` / malformed top-level).
		const runtime = blueprint.createRuntime({ overrideStateDefaults: { 'does-not-exist': { count: 1 } } })

		const issues = runtime.getIssues()
		expect(issues.length)
			.toBeGreaterThan(0)
		expect(Object.isFrozen(issues))
			.toBe(true)

		const fake = { source: { type: 'forged' }, message: 'forged' }
		expect(() => (issues as unknown as unknown[]).push(fake))
			.toThrow(TypeError)
		expect(runtime.getIssues())
			.toBe(issues)
		expect(runtime.getCollectedIssues())
			.not.toContain(fake)
	})

	it('an unknown state key on a known widget (also the final-return path) produces a frozen runtime-level snapshot too', () => {
		const plugin = createWidgetPlugin('override-probe-unknown-key')
			.interfaces<OverrideProbeInterfaces>()
			.state(state => state.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => 0,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'override-probe-unknown-key' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: { doesNotExist: 1 } } })

		const issues = runtime.getIssues()
		expect(issues.length)
			.toBeGreaterThan(0)
		expect(Object.isFrozen(issues))
			.toBe(true)

		const fake = { source: { type: 'forged' }, message: 'forged' }
		expect(() => (issues as unknown as unknown[]).push(fake))
			.toThrow(TypeError)
		expect(runtime.getIssues())
			.toBe(issues)
	})
})

describe('deepFreezeIssue freezes the Blueprint dependency-issue `member` wrapper too (round-4 finding 3774140636)', () => {
	interface MemberProbeInterfaces {
		properties: {
			probe: unknown
		}
	}

	it('(issue.source.member as any).name = "forged" throws, and `member` stays canonical', () => {
		const plugin = createWidgetPlugin('member-freeze-prober')
			.interfaces<MemberProbeInterfaces>()
			.properties(properties => properties.probe({
				// `dep.parent` with no parent on the root widget: a required dependency with target
				// cardinality 0, producing a Blueprint `dependency` issue owned by this Property member.
				registerDeps: ({ dep }) => ({ probe: dep.parent.properties.get('anything') }),
				compute: () => null,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'member-freeze-prober' })

		expect(blueprint.status)
			.toBe('invalid')
		if (blueprint.status !== 'invalid')
			throw new Error('test fixture: expected an invalid blueprint')

		const dependencyIssue = blueprint.getCollectedIssues()
			.find(issue => issue.source.type === 'dependency')
		if (dependencyIssue === undefined || dependencyIssue.source.type !== 'dependency')
			throw new Error('test fixture: expected a dependency issue.')

		const { member } = dependencyIssue.source
		expect(member)
			.toEqual({ type: 'property', name: 'probe' })
		expect(Object.isFrozen(member))
			.toBe(true)

		expect(() => {
			(member as unknown as Record<string, unknown>).name = 'forged'
		})
			.toThrow(TypeError)

		expect(dependencyIssue.source.member)
			.toEqual({ type: 'property', name: 'probe' })
		// Re-read through a fresh `getCollectedIssues()` call to confirm the mutation attempt didn't
		// leave any lasting trace, in case `member` is shared across issues.
		const dependencyIssueAgain = blueprint.getCollectedIssues()
			.find(issue => issue.source.type === 'dependency')
		if (dependencyIssueAgain === undefined || dependencyIssueAgain.source.type !== 'dependency')
			throw new Error('test fixture: expected a dependency issue on re-read.')
		expect(dependencyIssueAgain.source.member)
			.toEqual({ type: 'property', name: 'probe' })
	})
})

describe('a Property\'s cached ExecutionResult wrapper is frozen (round-4 finding 3774140642)', () => {
	interface CachedResultInterfaces {
		state: {
			count: number
		}
		properties: {
			doubled: number
			viaDoubled: number
		}
	}

	function createHarness() {
		const plugin = createWidgetPlugin('cached-result-probe')
			.interfaces<CachedResultInterfaces>()
			.state(state => state.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => 5,
			}))
			.properties(properties => properties
				.doubled({
					registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
					compute: ({ deps }) => {
						const result = deps.count()
						return result.success ? (result.value ?? 0) * 2 : -1
					},
				})
				.viaDoubled({
					registerDeps: ({ dep }) => ({ doubled: dep.self.properties.get('doubled') }),
					compute: ({ deps }) => {
						const result = deps.doubled()
						return result.success ? result.value ?? -1 : -1
					},
				}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'cached-result-probe' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')
		return { widget }
	}

	it('mutating a cached success result throws, and a later get() / dependency read still observes the canonical value (no recompute)', () => {
		const { widget } = createHarness()

		const first = widget.properties.doubled.get()
		expect(first)
			.toEqual({ success: true, value: 10 })
		expect(Object.isFrozen(first))
			.toBe(true)

		expect(() => {
			(first as unknown as Record<string, unknown>).value = 999
		})
			.toThrow(TypeError)

		// Same cached object (no recompute triggered by the failed mutation attempt): still canonical.
		const second = widget.properties.doubled.get()
		expect(second)
			.toBe(first)
		expect(second)
			.toEqual({ success: true, value: 10 })

		// A dependent Property reading through the dependency graph also observes the canonical value,
		// not a forged one.
		expect(widget.properties.viaDoubled.get())
			.toEqual({ success: true, value: 10 })
	})

	it('mutating a cached failure result throws and getIssues()/get() stay canonical', () => {
		interface FlakyInterfaces {
			properties: {
				flaky: number
			}
		}

		const plugin = createWidgetPlugin('cached-failure-probe')
			.interfaces<FlakyInterfaces>()
			.properties(properties => properties.flaky({
				compute: ({ addIssue }) => {
					addIssue({ message: 'flaky failed' })
					return 0
				},
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'cached-failure-probe' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')

		const result = widget.properties.flaky.get()
		expect(result.success)
			.toBe(false)
		expect(Object.isFrozen(result))
			.toBe(true)

		expect(() => {
			(result as unknown as Record<string, unknown>).success = true
		})
			.toThrow(TypeError)

		expect(widget.properties.flaky.get())
			.toBe(result)
		expect(widget.properties.flaky.get().success)
			.toBe(false)
	})
})
