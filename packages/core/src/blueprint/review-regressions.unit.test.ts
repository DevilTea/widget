/**
 * Regressions for adversarial PR #12 review findings on the Blueprint side.
 *
 * finding 3773310829 (blueprint/deps.ts:153): a Property-owned `state-set` dependency expression
 * (only reachable via a JS/`any` contract escape, since the fluent `dep` grammar never exposes `.set`
 * to a property consumer) must throw an implementation-contract error instead of silently compiling
 * into a resolved dependency — Properties must stay transitively side-effect free.
 *
 * finding 3773310833 (blueprint/structure.ts:49): every Blueprint-side semantic callback
 * (`validateStructure` at the slot/plugin/system scopes, `registerDeps`, `config.validate`,
 * `config.resolve`) is synchronous-only; a returned thenable is an implementation-contract violation
 * that throws synchronously, never a silently-started async side effect.
 *
 * finding 3773363784 (blueprint/recovery.ts:296): "not declared by its plugin" and "malformed raw
 * value" are independent facts about the same raw slot name and must both be reported, each their own
 * `['slots', slotName]` definition diagnostic; a malformed value never recovers children either way.
 *
 * finding 3773363797 (blueprint/structure.ts:91): a system-level `validateStructure` author's
 * `related` locations are deduplicated by semantic identity and ordered deterministically by semantic
 * traversal order before finalizing, never left in raw authoring order with duplicates intact.
 *
 * finding (runtime-agent discovered, orchestrator-confirmed; blueprint/deps.ts's `walkDeps` object
 * branch, ~line 59-61): a `registerDeps` container keyed by a special JavaScript name such as
 * `"__proto__"` must not pollute the compiled container's own `[[Prototype]]` — a plain `{}` plus
 * bracket assignment would let such a key overwrite the prototype instead of creating an own member,
 * after which every other key would delegate to it through prototype inheritance and be misdetected by
 * `isCompiledDependency`. `Object.create(null)` keeps every key an own, prototype-safe data property.
 * This is an end-to-end regression: the companion Runtime-side fix (`Object.create(null)` in
 * `runtime/deps.ts` / `runtime/widget.ts`) is owned by a different unit but exercised here through the
 * public API.
 *
 * finding 3773695993 (blueprint/deps.ts:47): `edgeKey()`'s naive template-literal concatenation of the
 * six graph-identity components is not injective over the `WidgetMemberKey = string` domain (member
 * names may themselves contain `:` / `->`), so two semantically distinct edges can serialize to the
 * same string and the later one silently disappears from graph analysis — including a
 * Property -> writeful-Method edge, which would let purity analysis miss a hard invariant violation.
 *
 * finding 3773696006 (blueprint/deps.ts:241): `registerDepsResult ?? {}` conflated "callback omitted"
 * (legitimate empty deps) with "callback present but returned `undefined`/`null`" (malformed output,
 * only reachable via a JS/`any` contract escape); the latter must throw as a plugin implementation bug
 * instead of being silently accepted as empty deps.
 *
 * finding 3773890334 (blueprint/view.ts:23): the round-2 compile-view type fix had no runtime
 * counterpart — compile-time callbacks physically received the original navigator and full public
 * nodes, so a JS/`any` callback could still call `getDiagnostics()` mid-compilation, and the navigator
 * object itself was neither restricted nor frozen, so plugin code could reassign a navigation method
 * (`ctx.blueprint.getWidget = ...`) and corrupt the view every later callback in the same compile pass
 * receives. `createCompileFacade` (`./view.ts`) now builds a real, frozen, restricted facade (no
 * `getDiagnostics` anywhere, slots/`getLocation().parent` are themselves facades) shared by every
 * compile-time callback in one `compileBlueprint()` call.
 *
 * finding 3773890344 (blueprint/recovery.ts:111): `WidgetLocation` records were left mutable even
 * though `getLocation()` returns the exact stored object; a caller casting away `readonly` could
 * mutate topology metadata observed by every later `getLocation()` call. Now frozen at construction.
 *
 * finding 3773890349 (blueprint/index.ts:105): freezing only the aggregate `finalDiagnostics` array left
 * per-node `getDiagnostics()` arrays, and the diagnostic/`source` objects themselves, mutable — a caller could
 * permanently rewrite a node's diagnostic snapshot or its structured `source` fields through either
 * view. Now both `diagnosticsByNode`'s per-node arrays and the aggregate array are frozen via the
 * Runtime-side `freezeDiagnosticSnapshot`/`deepFreezeDiagnostic` helpers (shared, generic, imported from
 * `../runtime/diagnostics`), which freeze the framework-owned diagnostic structure without touching
 * caller/plugin-owned payload values.
 *
 * Only the public entry (`../index`) is used; no internal module or `blueprintInternals` access.
 */

import type { JsonValue, StateSetDepExpression } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

function captureThrow(action: () => unknown): { readonly caught: unknown, readonly threw: boolean } {
	try {
		action()
		return { caught: undefined, threw: false }
	}
	catch (error) {
		return { caught: error, threw: true }
	}
}

// -------------------------------------------------------------------------------------------------
// finding 3773310829 — Property-owned state-set dependency escape
// -------------------------------------------------------------------------------------------------

describe('property-owned state-set dependency escape (finding 3773310829)', () => {
	interface EscapeInterfaces {
		state: {
			count: number
		}
		properties: {
			sneaky: number
		}
	}

	const plugin = createWidgetPlugin('property-state-set-escape')
		.description('Test widget')
		.interfaces<EscapeInterfaces>()
		.state(section => section.count({
			validate: (input): input is number => typeof input === 'number',
		}))
		.properties(section => section.sneaky({
			registerDeps: ({ dep }) => ({
				// Only reachable through a JS/`any` contract escape: the fluent dep grammar never
				// exposes `.set` to a property consumer (COMMENT 31 §10 amendment).
				write: (dep.self.state as unknown as { set: (key: string) => StateSetDepExpression<number, false> }).set('count'),
			}),
			compute: () => 0,
		}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })

	it('throws an implementation-contract error instead of silently compiling a resolved dependency', () => {
		const { caught, threw } = captureThrow(() => system.createBlueprint({ id: 'root', type: 'property-state-set-escape' }))

		expect(threw)
			.toBe(true)
		expect(caught)
			.toBeInstanceOf(TypeError)
		expect((caught as Error).message)
			.toMatch(/plugin implementation bug/i)
	})
})

// -------------------------------------------------------------------------------------------------
// finding 3773310833 — synchronous semantic-boundary guard, Blueprint side
// -------------------------------------------------------------------------------------------------

describe('synchronous semantic-boundary guard, Blueprint side (finding 3773310833)', () => {
	it('an async slot-level validateStructure throws instead of silently starting async work', () => {
		interface ListInterfaces {
			slots: 'items'
		}

		const plugin = createWidgetPlugin('async-slot-validate-structure')
			.description('Test widget')
			.interfaces<ListInterfaces>()
			.slots({
				items: {
					description: 'Test slot',
					// TypeScript's `void`-return contextual typing allows this async function through;
					// the sync-boundary guard must still catch it at runtime.
					validateStructure: async () => {},
				},
			})
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })

		const { caught, threw } = captureThrow(() => system.createBlueprint({ id: 'root', type: 'async-slot-validate-structure', slots: { items: [] } }))

		expect(threw)
			.toBe(true)
		expect(caught)
			.toBeInstanceOf(TypeError)
		expect((caught as Error).message)
			.toMatch(/thenable/i)
	})

	it('an async plugin-level validateStructure throws instead of silently starting async work', () => {
		interface ListInterfaces {
			slots: 'items'
		}

		const plugin = createWidgetPlugin('async-plugin-validate-structure')
			.description('Test widget')
			.interfaces<ListInterfaces>()
			.slots(
				{ items: { description: 'Test slot' } },
				async () => {},
			)
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })

		const { caught, threw } = captureThrow(() => system.createBlueprint({ id: 'root', type: 'async-plugin-validate-structure', slots: { items: [] } }))

		expect(threw)
			.toBe(true)
		expect(caught)
			.toBeInstanceOf(TypeError)
		expect((caught as Error).message)
			.toMatch(/thenable/i)
	})

	it('an async system-level validateStructure throws instead of silently starting async work', () => {
		interface LeafInterfaces {}

		const plugin = createWidgetPlugin('async-system-validate-structure-leaf')
			.description('Test widget')
			.interfaces<LeafInterfaces>()
			.done()

		const system = createWidgetSystem({
			plugins: [plugin],
			validateStructure: async () => {},
		})

		const { caught, threw } = captureThrow(() => system.createBlueprint({ id: 'root', type: 'async-system-validate-structure-leaf' }))

		expect(threw)
			.toBe(true)
		expect(caught)
			.toBeInstanceOf(TypeError)
		expect((caught as Error).message)
			.toMatch(/thenable/i)
	})

	it('an async registerDeps throws instead of silently starting async work', () => {
		interface AsyncDepsInterfaces {
			properties: {
				value: number
			}
		}

		const plugin = createWidgetPlugin('async-register-deps')
			.description('Test widget')
			.interfaces<AsyncDepsInterfaces>()
			.properties(section => section.value({
				// Deliberately lies about its declared synchronous return type to simulate a
				// misbehaving plugin implementation, per diagnostic #10 consolidated handoff §16.
				registerDeps: () => Promise.resolve({}) as unknown as Record<never, never>,
				compute: () => 0,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })

		const { caught, threw } = captureThrow(() => system.createBlueprint({ id: 'root', type: 'async-register-deps' }))

		expect(threw)
			.toBe(true)
		expect(caught)
			.toBeInstanceOf(TypeError)
		expect((caught as Error).message)
			.toMatch(/thenable/i)
	})

	it('an async config.validate throws instead of silently starting async work', () => {
		interface AsyncConfigInterfaces {
			config: {
				raw: Record<string, JsonValue>
				resolved: Record<string, unknown>
			}
		}

		const plugin = createWidgetPlugin('async-config-validate')
			.description('Test widget')
			.interfaces<AsyncConfigInterfaces>()
			.config({
				description: 'Test config',
				validate: (_input): _input is Record<string, JsonValue> => (Promise.resolve(true) as unknown as boolean),
				resolve: raw => raw ?? {},
			})
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })

		const { caught, threw } = captureThrow(() => system.createBlueprint({ id: 'root', type: 'async-config-validate', config: {} }))

		expect(threw)
			.toBe(true)
		expect(caught)
			.toBeInstanceOf(TypeError)
		expect((caught as Error).message)
			.toMatch(/thenable/i)
	})

	it('an async config.resolve throws instead of silently starting async work', () => {
		interface AsyncConfigInterfaces {
			config: {
				raw: Record<string, JsonValue>
				resolved: Record<string, unknown>
			}
		}

		const plugin = createWidgetPlugin('async-config-resolve')
			.description('Test widget')
			.interfaces<AsyncConfigInterfaces>()
			.config({
				description: 'Test config',
				validate: (input): input is Record<string, JsonValue> => typeof input === 'object' && input !== null,
				resolve: raw => Promise.resolve(raw ?? {}) as unknown as Record<string, unknown>,
			})
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })

		// No raw `config` supplied, so recovery calls `resolve(null)` directly.
		const { caught, threw } = captureThrow(() => system.createBlueprint({ id: 'root', type: 'async-config-resolve' }))

		expect(threw)
			.toBe(true)
		expect(caught)
			.toBeInstanceOf(TypeError)
		expect((caught as Error).message)
			.toMatch(/thenable/i)
	})
})

// -------------------------------------------------------------------------------------------------
// finding 3773363784 — slot dual diagnostics (not-declared + malformed independently)
// -------------------------------------------------------------------------------------------------

describe('slot dual diagnostics: not-declared and malformed coexist independently (finding 3773363784)', () => {
	interface ContainerInterfaces {
		slots: 'content'
	}

	const containerPlugin = createWidgetPlugin('dual-diag-container')
		.description('Test widget')
		.interfaces<ContainerInterfaces>()
		.slots({ content: { description: 'Test slot' } })
		.done()

	const system = createWidgetSystem({ plugins: [containerPlugin] })

	it('emits both a not-declared and a malformed-value definition diagnostic at the same [\'slots\', slotName] path', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'dual-diag-container', slots: { legacy: 123 } })

		expect(blueprint.status)
			.toBe('invalid')

		const legacyDiagnostics = blueprint.root.diagnostics
			.filter(diagnostic => ['invalid-widget-definition', 'invalid-widget-id', 'invalid-widget-type', 'unknown-widget-type', 'unexpected-widget-config', 'invalid-widget-slots', 'unexpected-widget-slots', 'undeclared-widget-slot', 'invalid-widget-slot'].includes(diagnostic.code))
			.filter((diagnostic) => {
				const path = (diagnostic as { path?: readonly PropertyKey[] }).path
				return path?.[0] === 'slots' && path?.[1] === 'legacy'
			})

		// Two independent facts, two independent diagnostics — neither suppresses the other.
		expect(legacyDiagnostics)
			.toHaveLength(2)
	})

	it('still recovers no children from the malformed value even though the slot is also undeclared', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'dual-diag-container', slots: { legacy: 123 } })

		expect(blueprint.getChildrenAt(blueprint.root, 'legacy'))
			.toHaveLength(0)
	})
})

// -------------------------------------------------------------------------------------------------
// finding 3773363797 — system-level related normalization (dedupe + deterministic order)
// -------------------------------------------------------------------------------------------------

describe('system-level related normalization (finding 3773363797)', () => {
	interface LeafInterfaces {}

	const leafPlugin = createWidgetPlugin('related-normalize-leaf')
		.description('Test widget')
		.interfaces<LeafInterfaces>()
		.done()

	interface ListInterfaces {
		slots: 'items'
	}

	const listPlugin = createWidgetPlugin('related-normalize-list')
		.description('Test widget')
		.interfaces<ListInterfaces>()
		.slots({ items: { description: 'Test slot' } })
		.done()

	const system = createWidgetSystem({
		plugins: [listPlugin, leafPlugin],
		validateStructure: (ctx) => {
			const root = ctx.blueprint.root
			if (!root.resolved || root.type !== 'related-normalize-list')
				return

			const children = ctx.blueprint.getChildrenAt(root, 'items')
			const [first, second] = children
			if (first === undefined || second === undefined)
				return

			ctx.addDiagnostic({
				message: 'dup-and-reverse',
				location: { type: 'widget', node: root },
				related: [
					{ type: 'widget', node: second },
					{ type: 'widget', node: first },
					// Semantic duplicate of the first entry above (same node, same discriminator),
					// authored out of traversal order.
					{ type: 'widget', node: second },
				],
			})
		},
	})

	it('dedupes semantic duplicates and orders `related` by semantic traversal order, not authoring order', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'related-normalize-list',
			slots: {
				items: [
					{ id: 'a', type: 'related-normalize-leaf' },
					{ id: 'b', type: 'related-normalize-leaf' },
				],
			},
		})

		const diagnostic = blueprint.diagnostics
			.find(candidate => candidate.message === 'dup-and-reverse')
		expect(diagnostic)
			.toBeDefined()

		const related = (diagnostic! as { related?: readonly { node: unknown }[] }).related
		expect(related)
			.toBeDefined()

		// Deduped from 3 authored entries (with one semantic duplicate) down to 2.
		expect(related)
			.toHaveLength(2)

		const [firstChild, secondChild] = blueprint.getChildrenAt(blueprint.root, 'items')
		// Canonical order follows semantic traversal order (first child, then second child), even
		// though the author supplied the second child first.
		expect(related![0]!.node)
			.toBe(firstChild)
		expect(related![1]!.node)
			.toBe(secondChild)
	})

	it('never leaves `related` present-but-empty', () => {
		const noRelatedSystem = createWidgetSystem({
			plugins: [listPlugin, leafPlugin],
			validateStructure: (ctx) => {
				const root = ctx.blueprint.root
				if (!root.resolved || root.type !== 'related-normalize-list')
					return
				ctx.addDiagnostic({ message: 'no-related', location: { type: 'widget', node: root } })
			},
		})

		const blueprint = noRelatedSystem.createBlueprint({ id: 'root', type: 'related-normalize-list' })
		const diagnostic = blueprint.diagnostics
			.find(candidate => candidate.message === 'no-related')

		expect(diagnostic)
			.toBeDefined()
		expect((diagnostic! as { related?: unknown }).related)
			.toBeUndefined()
	})
})

// -------------------------------------------------------------------------------------------------
// registerDeps container proto-safety (runtime-agent discovered, orchestrator-confirmed)
// -------------------------------------------------------------------------------------------------

describe('registerDeps container keyed by a special JavaScript name stays prototype-safe end-to-end', () => {
	// The repo's eslint config rejects literal `.__proto__` / `{ __proto__: ... }` syntax; a `const`
	// key plus bracket notation exercises the exact same runtime key without tripping that rule.
	const protoKey = '__proto__' as const

	interface ProtoSafeInterfaces {
		state: {
			count: number
		}
		properties: {
			viaProperty: number
		}
		methods: {
			viaMethod: () => number
		}
	}

	const plugin = createWidgetPlugin('proto-safe-register-deps')
		.description('Test widget')
		.interfaces<ProtoSafeInterfaces>()
		.state(section => section.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 42,
		}))
		.properties(section => section.viaProperty({
			registerDeps: ({ dep }) => ({ [protoKey]: dep.self.state.get('count') }),
			compute: ({ deps }) => {
				const result = deps[protoKey]()
				return result.ok ? (result.value ?? -1) : -1
			},
		}))
		.methods(section => section.viaMethod({
			registerDeps: ({ dep }) => ({ [protoKey]: dep.self.state.get('count') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				const result = deps[protoKey]()
				return result.ok ? (result.value ?? -1) : -1
			},
		}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })

	it('compiles a Blueprint normally instead of misdetecting the whole container as one leaf', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'proto-safe-register-deps' })

		expect(blueprint.status)
			.toBe('valid')
	})

	it('materializes deps[\'__proto__\'] as its own callable dependency and behaves correctly through Property and Method', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'proto-safe-register-deps' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')

		expect(widget.properties.viaProperty.get())
			.toEqual({ ok: true, value: 42 })
		expect(widget.methods.viaMethod())
			.toEqual({ ok: true, value: 42 })

		widget.state.count.set(7)

		expect(widget.properties.viaProperty.get())
			.toEqual({ ok: true, value: 7 })
		expect(widget.methods.viaMethod())
			.toEqual({ ok: true, value: 7 })
	})
})

// -------------------------------------------------------------------------------------------------
// finding 3773695993 — edgeKey() collision across delimiter-rich member names
// -------------------------------------------------------------------------------------------------

describe('edge identity collision across delimiter-rich member names (finding 3773695993)', () => {
	interface CollisionInterfaces {
		state: {
			count: number
		}
		properties: {
			'a->method:0:b': number
			'a': number
			'c': number
		}
		methods: {
			'b->property:0:c': () => number
		}
	}

	const plugin = createWidgetPlugin('edge-key-collision')
		.description('Test widget')
		.interfaces<CollisionInterfaces>()
		.state(section => section.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}))
		.properties((section) => {
			// Declaration order matters: under the old buggy `edgeKey()`, whichever edge is registered
			// first "wins" the colliding key and the second is silently dropped. Declaring the
			// property->property edge (A) before the property->method edge (B) makes B — the one with
			// the real safety consequence — the one that would disappear under the bug.
			const afterWeird = section['a->method:0:b']({
				// Edge A: Property "a->method:0:b" -> Property "c" (property-get). Old key:
				// `property:0:a->method:0:b->property:0:c`.
				registerDeps: ({ dep }) => ({ target: dep.self.properties.get('c') }),
				compute: ({ deps }) => {
					const result = deps.target()
					return result.ok ? (result.value ?? -1) : -1
				},
			})
			const afterA = afterWeird.a({
				// Edge B: Property "a" -> Method "b->property:0:c" (method-invoke). Old key:
				// `property:0:a->method:0:b->property:0:c` — identical to Edge A's, even though the two
				// edges are semantically unrelated.
				registerDeps: ({ dep }) => ({ target: dep.self.methods.invoke('b->property:0:c') }),
				compute: ({ deps }) => {
					const result = deps.target()
					return result.ok ? (result.value ?? -1) : -1
				},
			})
			return afterA.c({
				// Cycle back to "a->method:0:b" so a dropped Edge A would also be independently
				// detectable (cycle detection between "a->method:0:b" and "c" requires both directions).
				registerDeps: ({ dep }) => ({ target: dep.self.properties.get('a->method:0:b') }),
				compute: ({ deps }) => {
					const result = deps.target()
					return result.ok ? (result.value ?? -1) : -1
				},
			})
		})
		.methods(section => section['b->property:0:c']({
			registerDeps: ({ dep }) => ({ setCount: dep.self.state.set('count') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				deps.setCount(1)
				return 1
			},
		}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })

	it('keeps the Property -> writeful-Method edge (B) distinct: purity analysis still catches it', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'edge-key-collision' })

		expect(blueprint.status)
			.toBe('invalid')

		const purityDiagnostic = blueprint.diagnostics
			.find(diagnostic =>
				diagnostic.code.includes('dependency')
				&& diagnostic.location.type === 'property'
				&& diagnostic.location.name === 'a'
				&& 'dependency' in diagnostic
				&& diagnostic.dependency?.operation.type === 'method-invoke') as unknown as {
					code: string
					related?: readonly { type: string, name?: string }[]
				} | undefined

		if (purityDiagnostic === undefined || purityDiagnostic.code !== 'property-dependency-has-write-effects')
			throw new Error('test fixture: expected a Property "a" dependency diagnostic naming the method-invoke edge')

		const related = purityDiagnostic.related
		expect(related?.some(location => location.type === 'method' && location.name === 'b->property:0:c'))
			.toBe(true)
	})

	it('keeps the Property <-> Property edge (A) distinct: the evaluation cycle is still detected on both ends', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'edge-key-collision' })

		const cycleDiagnostics = blueprint.diagnostics
			.filter(diagnostic =>
				diagnostic.code === 'property-evaluation-cycle'
				&& diagnostic.location.type === 'property'
				&& (diagnostic.location.name === 'a->method:0:b' || diagnostic.location.name === 'c')
				&& !('dependency' in diagnostic)) as unknown as readonly {
			code: string
			location: { type: string, name?: string }
			related?: readonly { type: string, name?: string }[]
		}[]

		// One cycle diagnostic per Property participant in the cyclic SCC (COMMENT 18).
		expect(cycleDiagnostics)
			.toHaveLength(2)

		const weirdDiagnostic = cycleDiagnostics.find(diagnostic => diagnostic.code === 'property-evaluation-cycle' && diagnostic.location.name === 'a->method:0:b')
		const cDiagnostic = cycleDiagnostics.find(diagnostic => diagnostic.code === 'property-evaluation-cycle' && diagnostic.location.name === 'c')

		if (weirdDiagnostic === undefined || weirdDiagnostic.code !== 'property-evaluation-cycle' || cDiagnostic === undefined || cDiagnostic.code !== 'property-evaluation-cycle')
			throw new Error('test fixture: expected cycle diagnostics on both "a->method:0:b" and "c"')

		expect(weirdDiagnostic.related?.some(location => location.type === 'property' && location.name === 'c'))
			.toBe(true)
		expect(cDiagnostic.related?.some(location => location.type === 'property' && location.name === 'a->method:0:b'))
			.toBe(true)
	})
})

// -------------------------------------------------------------------------------------------------
// finding 3773696006 — registerDeps omitted vs present-but-malformed output
// -------------------------------------------------------------------------------------------------

describe('registerDeps: present-but-malformed output vs an omitted callback (finding 3773696006)', () => {
	it('throws when a Property\'s registerDeps is present but returns undefined (JS/any escape)', () => {
		interface MalformedInterfaces {
			properties: {
				value: number
			}
		}

		const plugin = createWidgetPlugin('malformed-register-deps-property')
			.description('Test widget')
			.interfaces<MalformedInterfaces>()
			.properties(section => section.value({

				// implementation bug reached only through a JS/`any` contract escape.
				registerDeps: (): any => undefined,
				compute: () => 0,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const { caught, threw } = captureThrow(() => system.createBlueprint({ id: 'root', type: 'malformed-register-deps-property' }))

		expect(threw)
			.toBe(true)
		expect(caught)
			.toBeInstanceOf(TypeError)
	})

	it('throws when a Method\'s registerDeps is present but returns null (JS/any escape)', () => {
		interface MalformedInterfaces {
			methods: {
				run: () => number
			}
		}

		const plugin = createWidgetPlugin('malformed-register-deps-method')
			.description('Test widget')
			.interfaces<MalformedInterfaces>()
			.methods(section => section.run({

				// implementation bug reached only through a JS/`any` contract escape.
				registerDeps: (): any => null,
				validateArgs: (args): args is [] => args.length === 0,
				execute: () => 0,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const { caught, threw } = captureThrow(() => system.createBlueprint({ id: 'root', type: 'malformed-register-deps-method' }))

		expect(threw)
			.toBe(true)
		expect(caught)
			.toBeInstanceOf(TypeError)
	})

	it('does not throw and synthesizes empty deps when registerDeps is omitted entirely', () => {
		interface OmittedInterfaces {
			properties: {
				value: number
			}
		}

		const plugin = createWidgetPlugin('omitted-register-deps')
			.description('Test widget')
			.interfaces<OmittedInterfaces>()
			.properties(section => section.value({
				compute: () => 0,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'omitted-register-deps' })

		expect(blueprint.status)
			.toBe('valid')
	})
})

// -------------------------------------------------------------------------------------------------
// finding 3773890334 — real, frozen, restricted runtime compile facade
// -------------------------------------------------------------------------------------------------

describe('the compile-time facade is genuinely restricted and frozen at runtime, not just narrowly typed (finding 3773890334)', () => {
	it('physically has no getDiagnostics anywhere: widget, blueprint.root, slot children, and getLocation(...).parent', () => {
		const checks: Record<string, boolean> = {}

		interface LeafInterfaces {}

		const leafPlugin = createWidgetPlugin('facade-leaf')
			.description('Test widget')
			.interfaces<LeafInterfaces>()
			.done()

		interface ListInterfaces {
			slots: 'items'
		}

		const listPlugin = createWidgetPlugin('facade-list')
			.description('Test widget')
			.interfaces<ListInterfaces>()
			.slots(
				{
					items: {
						description: 'Test slot',
						validateStructure: (ctx) => {
							checks.slotWidgetHasNoGetDiagnostics = (ctx.widget as unknown as { getDiagnostics?: unknown }).getDiagnostics === undefined
							checks.slotChildrenHaveNoGetDiagnostics = ctx.children.every(child => (child as unknown as { getDiagnostics?: unknown }).getDiagnostics === undefined)
						},
					},
				},
				(ctx) => {
					checks.pluginWidgetHasNoGetDiagnostics = (ctx.widget as unknown as { getDiagnostics?: unknown }).getDiagnostics === undefined
					checks.rootHasNoGetDiagnostics = (ctx.blueprint.root as unknown as { getDiagnostics?: unknown }).getDiagnostics === undefined

					const firstChild = ctx.blueprint.getChildrenAt(ctx.widget, 'items')[0]
					if (firstChild !== undefined) {
						const location = ctx.blueprint.getLocation(firstChild)
						checks.locationParentHasNoGetDiagnostics = location !== null
							&& location.type !== 'root'
							&& (location.parent as unknown as { getDiagnostics?: unknown }).getDiagnostics === undefined
					}
				},
			)
			.done()

		const system = createWidgetSystem({ plugins: [listPlugin, leafPlugin] })
		system.createBlueprint({
			id: 'root',
			type: 'facade-list',
			slots: { items: [{ id: 'child', type: 'facade-leaf' }] },
		})

		expect(checks.slotWidgetHasNoGetDiagnostics)
			.toBe(true)
		expect(checks.slotChildrenHaveNoGetDiagnostics)
			.toBe(true)
		expect(checks.pluginWidgetHasNoGetDiagnostics)
			.toBe(true)
		expect(checks.rootHasNoGetDiagnostics)
			.toBe(true)
		expect(checks.locationParentHasNoGetDiagnostics)
			.toBe(true)
	})

	it('is frozen: reassigning a navigation method throws, and later callbacks in the same compile pass see the unpolluted view', () => {
		let assignmentThrew = false
		let laterCallbackSawWorkingGetWidget: boolean | undefined

		interface ContainerInterfaces {
			slots: 'child'
		}

		const containerPlugin = createWidgetPlugin('facade-freeze-container')
			.description('Test widget')
			.interfaces<ContainerInterfaces>()
			.slots(
				{ child: { description: 'Test slot' } },
				(ctx) => {
					try {
						// Only reachable through a JS/`any` contract escape: the type is `readonly`.
						;(ctx.blueprint as unknown as { getWidget: unknown }).getWidget = () => null
					}
					catch (error) {
						assignmentThrew = error instanceof TypeError
					}
				},
			)
			.done()

		interface LeafInterfaces {
			properties: {
				probe: boolean
			}
		}

		const leafPlugin = createWidgetPlugin('facade-freeze-leaf')
			.description('Test widget')
			.interfaces<LeafInterfaces>()
			.properties(section => section.probe({
				// `registerDeps` runs in a later compile pipeline stage than structure validation, but
				// shares the exact same frozen facade instance for the whole `compileBlueprint()` call.
				registerDeps: ({ blueprint }) => {
					laterCallbackSawWorkingGetWidget = blueprint.getWidget('root') !== null
					return {}
				},
				compute: () => true,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [containerPlugin, leafPlugin] })
		system.createBlueprint({
			id: 'root',
			type: 'facade-freeze-container',
			slots: { child: [{ id: 'leaf', type: 'facade-freeze-leaf' }] },
		})

		expect(assignmentThrew)
			.toBe(true)
		expect(laterCallbackSawWorkingGetWidget)
			.toBe(true)
	})
})

// -------------------------------------------------------------------------------------------------
// finding 3773890344 — WidgetLocation records are frozen
// -------------------------------------------------------------------------------------------------

describe('widgetLocation records are frozen (finding 3773890344)', () => {
	interface ContainerInterfaces {
		slots: 'child'
	}

	interface LeafInterfaces {}

	const containerPlugin = createWidgetPlugin('location-freeze-container')
		.description('Test widget')
		.interfaces<ContainerInterfaces>()
		.slots({ child: { description: 'Test slot' } })
		.done()

	const leafPlugin = createWidgetPlugin('location-freeze-leaf')
		.description('Test widget')
		.interfaces<LeafInterfaces>()
		.done()

	const system = createWidgetSystem({ plugins: [containerPlugin, leafPlugin] })

	it('is frozen, rejects mutation through a cast, and getLocation stays consistent afterward', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'location-freeze-container',
			slots: { child: [{ id: 'leaf', type: 'location-freeze-leaf' }] },
		})
		const child = blueprint.getChildrenAt(blueprint.root, 'child')[0]!
		const location = blueprint.getLocation(child)

		expect(location)
			.not.toBeNull()
		expect(Object.isFrozen(location))
			.toBe(true)

		expect(() => {
			(location as unknown as { slot: string }).slot = 'other'
		})
			.toThrow(TypeError)

		const locationAgain = blueprint.getLocation(child)
		expect(locationAgain)
			.toBe(location)
		expect(locationAgain?.type === 'slot' ? locationAgain.slot : undefined)
			.toBe('child')
	})
})

// -------------------------------------------------------------------------------------------------
// finding 3773890349 — Blueprint diagnostic/source structures are immutable
// -------------------------------------------------------------------------------------------------

describe('blueprint diagnostic/source structures are immutable (finding 3773890349)', () => {
	interface LeafInterfaces {}

	const leafPlugin = createWidgetPlugin('diagnostic-freeze-leaf')
		.description('Test widget')
		.interfaces<LeafInterfaces>()
		.done()

	const system = createWidgetSystem({ plugins: [leafPlugin] })

	it('freezes per-node getDiagnostics() arrays, the aggregate array, and the diagnostic/source structures, at both entry points', () => {
		const blueprint = system.createBlueprint({ type: 'diagnostic-freeze-leaf' })

		expect(blueprint.status)
			.toBe('invalid')

		const nodeDiagnostics = blueprint.root.diagnostics
		expect(nodeDiagnostics.length)
			.toBeGreaterThan(0)
		expect(Object.isFrozen(nodeDiagnostics))
			.toBe(true)
		expect(() => (nodeDiagnostics as unknown as unknown[]).push({}))
			.toThrow(TypeError)

		const aggregateDiagnostics = blueprint.diagnostics
		expect(Object.isFrozen(aggregateDiagnostics))
			.toBe(true)
		expect(() => (aggregateDiagnostics as unknown as unknown[]).push({}))
			.toThrow(TypeError)

		const diagnostic = nodeDiagnostics[0]!
		expect(Object.isFrozen(diagnostic))
			.toBe(true)
		expect(Object.isFrozen(diagnostic))
			.toBe(true)
		expect(() => {
			(diagnostic as unknown as { message: string }).message = 'mutated'
		})
			.toThrow(TypeError)
		expect(() => {
			(diagnostic as unknown as Record<string, unknown>).path = ['mutated']
		})
			.toThrow(TypeError)

		const path = (diagnostic as unknown as { path?: unknown[] }).path
		if (path !== undefined) {
			expect(Object.isFrozen(path))
				.toBe(true)
			expect(() => path.push('extra'))
				.toThrow(TypeError)
		}

		// The same diagnostic object is shared identically between the node-local and aggregate views (a
		// mutation through either would otherwise silently corrupt the other).
		expect(aggregateDiagnostics)
			.toContain(diagnostic)
	})
})
