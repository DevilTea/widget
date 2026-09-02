/**
 * Regression coverage for PR #12 round-2 review finding 3773696025 (`runtime/collector.ts` mutable
 * completed diagnostic snapshot).
 *
 * `ExecutionResult.failure.diagnostics` is an immutable final snapshot for that operation, and `getDiagnostics()`
 * is the latest *completed* snapshot — the very same array/reference, per
 * `diagnostic-snapshot.unit.test.ts`. Before this fix, `finalize()` returned a plain `entries.map(...)`
 * array, so `result.failure.diagnostics.push(fakeDiagnostic)` (or any other external mutation, including through `as
 * any`) silently corrupted the primitive's own `getDiagnostics()` state without any Runtime operation or
 * signal update ever running. `EMPTY_DIAGNOSTICS` was already frozen; this closes the same gap for every
 * non-empty completed snapshot across State, Property and Method.
 *
 * Normative source: diagnostic #10 diagnostic-snapshot contract (consolidated handoff §16).
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
		.description('Test widget')
		.interfaces<SnapshotInterfaces>()
		.state(state => state.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}))
		.properties(properties => properties
			.flaky({
				compute: ({ addDiagnostic }) => {
					if (propertyShouldFail)
						addDiagnostic({ message: 'property flaky failed' })
					return 0
				},
			})
			// Depends on `flaky`, so a wrapped target failure here carries a `property-dependency`
			// source with both `dependency` (a `BlueprintDependencyReference`) and `related` (a
			// `RuntimeDiagnosticLocation` array) — the two structural fields round-3 finding 3773890357
			// covers beyond the plain shallow `Object.freeze(diagnostic)`.
			.viaFlaky({
				registerDeps: ({ dep }) => ({ flaky: dep.self.properties.get('flaky') }),
				compute: ({ deps }) => {
					const result = deps.flaky()
					return result.ok ? result.value ?? 0 : -1
				},
			}))
		.methods(methods => methods.flakyMethod({
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ addDiagnostic }) => {
				if (methodShouldFail)
					addDiagnostic({ message: 'method flaky failed' })
				return 0
			},
		}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'counter' })
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

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

/** A stand-in diagnostic shaped closely enough to pass structurally as a `RuntimeDiagnostic` under `any`. */
const fakeDiagnostic = { source: { type: 'forged' }, message: 'forged' }

describe('completed non-empty diagnostic snapshots are frozen (round-2 finding 3773696025)', () => {
	it('state.set failure: `result.failure.diagnostics` is frozen, is the same reference as getDiagnostics(), and a mutation attempt does not corrupt subsequent reads', () => {
		const { widget } = createHarness()

		const result = widget.state.count.set('nope' as unknown as number)

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(Object.isFrozen(result.failure.diagnostics))
			.toBe(true)
		expect(Object.isFrozen(result.failure.diagnostics[0]))
			.toBe(true)
		expect(widget.state.count.getDiagnostics())
			.toBe(result.failure.diagnostics)

		expect(() => (result.failure.diagnostics as unknown as unknown[]).push(fakeDiagnostic))
			.toThrow(TypeError)
		expect(widget.state.count.getDiagnostics())
			.toHaveLength(1)
		expect(widget.state.count.getDiagnostics())
			.toBe(result.failure.diagnostics)
	})

	it('property.get failure: `result.failure.diagnostics` is frozen and immune to external mutation attempts', () => {
		const { widget, setPropertyShouldFail } = createHarness()
		setPropertyShouldFail(true)

		const result = widget.properties.flaky.get()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(Object.isFrozen(result.failure.diagnostics))
			.toBe(true)
		expect(widget.properties.flaky.getDiagnostics())
			.toBe(result.failure.diagnostics)

		expect(() => (result.failure.diagnostics as unknown as unknown[]).push(fakeDiagnostic))
			.toThrow(TypeError)
		expect(widget.properties.flaky.getDiagnostics())
			.toHaveLength(1)
	})

	it('method call failure: `result.failure.diagnostics` is frozen and immune to external mutation attempts', () => {
		const { widget, setMethodShouldFail } = createHarness()
		setMethodShouldFail(true)

		const result = widget.methods.flakyMethod()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(Object.isFrozen(result.failure.diagnostics))
			.toBe(true)
		expect(widget.methods.flakyMethod.getDiagnostics())
			.toBe(result.failure.diagnostics)

		expect(() => (result.failure.diagnostics as unknown as unknown[]).push(fakeDiagnostic))
			.toThrow(TypeError)
		expect(widget.methods.flakyMethod.getDiagnostics())
			.toHaveLength(1)
	})

	it('the framework generic-fallback diagnostic array (no addDiagnostic call) is frozen too', () => {
		const { widget } = createHarness()

		const result = widget.state.count.set('nope' as unknown as number)

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(result.failure.diagnostics[0]!.code)
			.toBe('invalid-state-value')
		expect(Object.isFrozen(result.failure.diagnostics))
			.toBe(true)
	})

	it('an attempted mutation of a failure snapshot does not leak a forged diagnostic into the Runtime aggregate', () => {
		const { runtime, widget, setPropertyShouldFail } = createHarness()
		setPropertyShouldFail(true)

		const result = widget.properties.flaky.get()
		if (result.ok)
			throw new Error('Expected a failure result.')

		try {
			(result.failure.diagnostics as unknown as unknown[]).push(fakeDiagnostic)
		}
		catch {
			// Expected: frozen arrays throw on mutation in strict mode (ESM is always strict).
		}

		expect(widget.properties.flaky.getDiagnostics())
			.toHaveLength(1)
		expect(runtime.getDiagnostics())
			.toHaveLength(1)
		expect(runtime.getDiagnostics())
			.not.toContain(fakeDiagnostic)
	})
})

describe('completed diagnostic snapshots are deep-frozen — source and its structural fields, not just the top-level diagnostic (round-3 finding 3773890357)', () => {
	it('the `source` object itself rejects field mutation and stays canonical afterward', () => {
		const { widget } = createHarness()

		const result = widget.state.count.set('nope' as unknown as number)
		if (result.ok)
			throw new Error('Expected a failure result.')

		const source = result.failure.diagnostics[0]! as unknown as { location: { widgetId: string } }
		expect(Object.isFrozen(source))
			.toBe(true)
		expect(() => {
			source.location.widgetId = 'forged'
		})
			.toThrow(TypeError)

		expect(result.failure.diagnostics[0]!.location.widgetId)
			.toBe('root')
		expect(widget.state.count.getDiagnostics()[0]!.location.widgetId)
			.toBe('root')
	})

	it('a property-dependency diagnostic\'s `related` array, its location wrapper, and `dependency` reference all reject mutation', () => {
		const { widget, setPropertyShouldFail } = createHarness()
		setPropertyShouldFail(true)

		const result = widget.properties.viaFlaky.get()
		if (result.ok)
			throw new Error('Expected a failure result.')

		const source = result.failure.diagnostics[0]!
		if (!('dependency' in source))
			throw new Error('Expected a property-dependency diagnostic.')

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
		expect(widget.properties.viaFlaky.getDiagnostics())
			.toEqual(result.failure.diagnostics)
	})

	it('does not freeze arbitrary payload values carried for diagnostic display (`candidate`/`result`)', () => {
		const { widget } = createHarness()

		// A mutable plain object used as the rejected candidate: only the diagnostic *structure* around
		// it is frozen, never the payload value itself.
		const mutableCandidate: Record<string, unknown> = { tag: 'original' }
		const result = widget.state.count.set(mutableCandidate as unknown as number)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(Object.isFrozen(result.failure.diagnostics[0]!.candidate))
			.toBe(false)
		expect(() => {
			mutableCandidate.tag = 'mutated'
		}).not.toThrow()
	})
})

describe('dependency-call diagnostic snapshots are frozen before both collector insertion and return to plugin code (round-3 finding 3773890368)', () => {
	it('a plugin attempting to mutate depResult.diagnostics[0] inside the callback cannot corrupt the outer consumer snapshot', () => {
		let mutationThrew = false

		interface MutateProbeInterfaces {
			properties: {
				flaky: number
				viaFlakyMutating: number
			}
		}

		const plugin = createWidgetPlugin('mutate-probe')
			.description('Test widget')
			.interfaces<MutateProbeInterfaces>()
			.properties(properties => properties
				.flaky({
					compute: ({ addDiagnostic }) => {
						addDiagnostic({ message: 'flaky failed' })
						return 0
					},
				})
				.viaFlakyMutating({
					registerDeps: ({ dep }) => ({ flaky: dep.self.properties.get('flaky') }),
					compute: ({ deps }) => {
						const depResult = deps.flaky()
						if (!depResult.ok) {
							try {
								(depResult.failure.diagnostics[0] as unknown as Record<string, unknown>).message = 'mutated by plugin code'
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

		// The dependency diagnostic was already frozen (both before insertion into the active collector and
		// before being handed back to plugin code as `depResult.diagnostics[0]`), so the plugin's own
		// mutation attempt threw and never landed.
		expect(mutationThrew)
			.toBe(true)

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(result.failure.diagnostics[0]!.message)
			.toBe('flaky failed')
		expect(widget.properties.viaFlakyMutating.getDiagnostics()[0]!.message)
			.toBe('flaky failed')
	})
})

describe('runtime.getDiagnostics() exposes an immutable runtime-level snapshot (round-3 finding 3773890376)', () => {
	interface OverrideProbeInterfaces {
		state: {
			count: number
		}
	}

	it('a malformed overrideStateDefaults produces non-empty runtime-level diagnostics that reject mutation and stay canonical', () => {
		const plugin = createWidgetPlugin('override-probe')
			.description('Test widget')
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
		// runtime-level `state-override` diagnostic, never blocking Runtime creation.
		const runtime = blueprint.createRuntime({ overrideStateDefaults: 'not-a-record' as unknown as Record<string, Record<string, unknown>> })

		const diagnostics = runtime.getDiagnostics()
		expect(diagnostics.length)
			.toBeGreaterThan(0)
		expect(Object.isFrozen(diagnostics))
			.toBe(true)
		expect(Object.isFrozen(diagnostics[0]))
			.toBe(true)

		const fake = { source: { type: 'forged' }, message: 'forged' }
		expect(() => (diagnostics as unknown as unknown[]).push(fake))
			.toThrow(TypeError)

		expect(runtime.getDiagnostics())
			.toBe(diagnostics)
		expect(runtime.getDiagnostics())
			.not.toContain(fake)
		expect(runtime.getDiagnostics())
			.not.toContain(fake)
	})

	it('a normal best-effort path (unknown widget id, valid top-level record) also produces a frozen runtime-level snapshot (round-4 finding 3774140630)', () => {
		const plugin = createWidgetPlugin('override-probe-normal')
			.description('Test widget')
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

		const diagnostics = runtime.getDiagnostics()
		expect(diagnostics.length)
			.toBeGreaterThan(0)
		expect(Object.isFrozen(diagnostics))
			.toBe(true)

		const fake = { source: { type: 'forged' }, message: 'forged' }
		expect(() => (diagnostics as unknown as unknown[]).push(fake))
			.toThrow(TypeError)
		expect(runtime.getDiagnostics())
			.toBe(diagnostics)
		expect(runtime.getDiagnostics())
			.not.toContain(fake)
	})

	it('an unknown state key on a known widget (also the final-return path) produces a frozen runtime-level snapshot too', () => {
		const plugin = createWidgetPlugin('override-probe-unknown-key')
			.description('Test widget')
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

		const diagnostics = runtime.getDiagnostics()
		expect(diagnostics.length)
			.toBeGreaterThan(0)
		expect(Object.isFrozen(diagnostics))
			.toBe(true)

		const fake = { source: { type: 'forged' }, message: 'forged' }
		expect(() => (diagnostics as unknown as unknown[]).push(fake))
			.toThrow(TypeError)
		expect(runtime.getDiagnostics())
			.toBe(diagnostics)
	})
})

describe('deepFreezeDiagnostic freezes the Blueprint dependency-diagnostic `member` wrapper too (round-4 finding 3774140636)', () => {
	interface MemberProbeInterfaces {
		properties: {
			probe: unknown
		}
	}

	it('(diagnostic.member as any).name = "forged" throws, and `member` stays canonical', () => {
		const plugin = createWidgetPlugin('member-freeze-prober')
			.description('Test widget')
			.interfaces<MemberProbeInterfaces>()
			.properties(properties => properties.probe({
				// `dep.parent` with no parent on the root widget: a required dependency with target
				// cardinality 0, producing a Blueprint `dependency` diagnostic owned by this Property member.
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

		const dependencyDiagnostic = blueprint.diagnostics
			.find(diagnostic => diagnostic.code === 'missing-dependency-target') as unknown as {
				code: string
				location: { type: string, name?: string }
			} | undefined
		if (dependencyDiagnostic === undefined || dependencyDiagnostic.code !== 'missing-dependency-target')
			throw new Error('test fixture: expected a dependency diagnostic.')

		expect(dependencyDiagnostic.location)
			.toMatchObject({ type: 'property', name: 'probe' })
		expect(Object.isFrozen(dependencyDiagnostic.location))
			.toBe(true)

		expect(() => {
			(dependencyDiagnostic.location as unknown as Record<string, unknown>).name = 'forged'
		})
			.toThrow(TypeError)

		expect(dependencyDiagnostic.location)
			.toEqual({ type: 'property', name: 'probe', node: expect.any(Object) })
		// Re-read through a fresh diagnostic snapshot to confirm the mutation attempt didn't leave any
		// lasting trace.
		const dependencyDiagnosticAgain = blueprint.diagnostics
			.find(diagnostic => diagnostic.code === 'missing-dependency-target') as unknown as {
				code: string
				location: { type: string, name?: string }
			} | undefined
		if (dependencyDiagnosticAgain === undefined || dependencyDiagnosticAgain.code !== 'missing-dependency-target')
			throw new Error('test fixture: expected a dependency diagnostic on re-read.')
		expect(dependencyDiagnosticAgain.location)
			.toMatchObject({ type: 'property', name: 'probe' })
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
			.description('Test widget')
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
						return result.ok ? (result.value ?? 0) * 2 : -1
					},
				})
				.viaDoubled({
					registerDeps: ({ dep }) => ({ doubled: dep.self.properties.get('doubled') }),
					compute: ({ deps }) => {
						const result = deps.doubled()
						return result.ok ? result.value ?? -1 : -1
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

	it('mutating a cached ok result throws, and a later get() / dependency read still observes the canonical value (no recompute)', () => {
		const { widget } = createHarness()

		const first = widget.properties.doubled.get()
		expect(first)
			.toEqual({ ok: true, value: 10 })
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
			.toEqual({ ok: true, value: 10 })

		// A dependent Property reading through the dependency graph also observes the canonical value,
		// not a forged one.
		expect(widget.properties.viaDoubled.get())
			.toEqual({ ok: true, value: 10 })
	})

	it('mutating a cached failure result throws and getDiagnostics()/get() stay canonical', () => {
		interface FlakyInterfaces {
			properties: {
				flaky: number
			}
		}

		const plugin = createWidgetPlugin('cached-failure-probe')
			.description('Test widget')
			.interfaces<FlakyInterfaces>()
			.properties(properties => properties.flaky({
				compute: ({ addDiagnostic }) => {
					addDiagnostic({ message: 'flaky failed' })
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
		expect(result.ok)
			.toBe(false)
		expect(Object.isFrozen(result))
			.toBe(true)

		expect(() => {
			(result as unknown as Record<string, unknown>).ok = true
		})
			.toThrow(TypeError)

		expect(widget.properties.flaky.get())
			.toBe(result)
		expect(widget.properties.flaky.get().ok)
			.toBe(false)
	})
})
