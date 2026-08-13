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
 * `['slots', slotName]` definition issue; a malformed value never recovers children either way.
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
 * Only the public entry (`../index`) is used; no internal module or `blueprintInternals` access.
 */

import type { StateSetDepExpression } from '../index'
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
			.interfaces<ListInterfaces>()
			.slots({
				items: {
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
			.interfaces<ListInterfaces>()
			.slots(
				{ items: {} },
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
			.interfaces<AsyncDepsInterfaces>()
			.properties(section => section.value({
				// Deliberately lies about its declared synchronous return type to simulate a
				// misbehaving plugin implementation, per issue #10 consolidated handoff §16.
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
				raw: Record<string, unknown>
				resolved: Record<string, unknown>
			}
		}

		const plugin = createWidgetPlugin('async-config-validate')
			.interfaces<AsyncConfigInterfaces>()
			.config({
				validate: (_input): _input is Record<string, unknown> => (Promise.resolve(true) as unknown as boolean),
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
				raw: Record<string, unknown>
				resolved: Record<string, unknown>
			}
		}

		const plugin = createWidgetPlugin('async-config-resolve')
			.interfaces<AsyncConfigInterfaces>()
			.config({
				validate: (input): input is Record<string, unknown> => typeof input === 'object' && input !== null,
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
		.interfaces<ContainerInterfaces>()
		.slots({ content: {} })
		.done()

	const system = createWidgetSystem({ plugins: [containerPlugin] })

	it('emits both a not-declared and a malformed-value definition issue at the same [\'slots\', slotName] path', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'dual-diag-container', slots: { legacy: 123 } })

		expect(blueprint.status)
			.toBe('invalid')

		const legacyIssues = blueprint.root.getIssues()
			.filter(issue => issue.source.type === 'definition')
			.filter((issue) => {
				const path = (issue.source as { path?: readonly PropertyKey[] }).path
				return path?.[0] === 'slots' && path?.[1] === 'legacy'
			})

		// Two independent facts, two independent issues — neither suppresses the other.
		expect(legacyIssues)
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
		.interfaces<LeafInterfaces>()
		.done()

	interface ListInterfaces {
		slots: 'items'
	}

	const listPlugin = createWidgetPlugin('related-normalize-list')
		.interfaces<ListInterfaces>()
		.slots({ items: {} })
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

			ctx.addIssue({
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

		const issue = blueprint.getCollectedIssues()
			.find(candidate => candidate.message === 'dup-and-reverse')
		expect(issue)
			.toBeDefined()

		const related = (issue!.source as { related?: readonly { node: unknown }[] }).related
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
				ctx.addIssue({ message: 'no-related', location: { type: 'widget', node: root } })
			},
		})

		const blueprint = noRelatedSystem.createBlueprint({ id: 'root', type: 'related-normalize-list' })
		const issue = blueprint.getCollectedIssues()
			.find(candidate => candidate.message === 'no-related')

		expect(issue)
			.toBeDefined()
		expect((issue!.source as { related?: unknown }).related)
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
		.interfaces<ProtoSafeInterfaces>()
		.state(section => section.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 42,
		}))
		.properties(section => section.viaProperty({
			registerDeps: ({ dep }) => ({ [protoKey]: dep.self.state.get('count') }),
			compute: ({ deps }) => {
				const result = deps[protoKey]()
				return result.success ? (result.value ?? -1) : -1
			},
		}))
		.methods(section => section.viaMethod({
			registerDeps: ({ dep }) => ({ [protoKey]: dep.self.state.get('count') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				const result = deps[protoKey]()
				return result.success ? (result.value ?? -1) : -1
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
			.toEqual({ success: true, value: 42 })
		expect(widget.methods.viaMethod())
			.toEqual({ success: true, value: 42 })

		widget.state.count.set(7)

		expect(widget.properties.viaProperty.get())
			.toEqual({ success: true, value: 7 })
		expect(widget.methods.viaMethod())
			.toEqual({ success: true, value: 7 })
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
					return result.success ? (result.value ?? -1) : -1
				},
			})
			const afterA = afterWeird.a({
				// Edge B: Property "a" -> Method "b->property:0:c" (method-invoke). Old key:
				// `property:0:a->method:0:b->property:0:c` — identical to Edge A's, even though the two
				// edges are semantically unrelated.
				registerDeps: ({ dep }) => ({ target: dep.self.methods.invoke('b->property:0:c') }),
				compute: ({ deps }) => {
					const result = deps.target()
					return result.success ? (result.value ?? -1) : -1
				},
			})
			return afterA.c({
				// Cycle back to "a->method:0:b" so a dropped Edge A would also be independently
				// detectable (cycle detection between "a->method:0:b" and "c" requires both directions).
				registerDeps: ({ dep }) => ({ target: dep.self.properties.get('a->method:0:b') }),
				compute: ({ deps }) => {
					const result = deps.target()
					return result.success ? (result.value ?? -1) : -1
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

		const purityIssue = blueprint.getCollectedIssues()
			.find(issue =>
				issue.source.type === 'dependency'
				&& issue.source.member.type === 'property'
				&& issue.source.member.name === 'a'
				&& issue.source.dependency?.operation.type === 'method-invoke')

		if (purityIssue === undefined || purityIssue.source.type !== 'dependency')
			throw new Error('test fixture: expected a Property "a" dependency issue naming the method-invoke edge')

		const related = purityIssue.source.related
		expect(related?.some(location => location.type === 'method' && location.name === 'b->property:0:c'))
			.toBe(true)
	})

	it('keeps the Property <-> Property edge (A) distinct: the evaluation cycle is still detected on both ends', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'edge-key-collision' })

		const cycleIssues = blueprint.getCollectedIssues()
			.filter(issue =>
				issue.source.type === 'dependency'
				&& issue.source.member.type === 'property'
				&& (issue.source.member.name === 'a->method:0:b' || issue.source.member.name === 'c')
				&& issue.source.dependency === undefined)

		// One cycle diagnostic per Property participant in the cyclic SCC (COMMENT 18).
		expect(cycleIssues)
			.toHaveLength(2)

		const weirdIssue = cycleIssues.find(issue => issue.source.type === 'dependency' && issue.source.member.name === 'a->method:0:b')
		const cIssue = cycleIssues.find(issue => issue.source.type === 'dependency' && issue.source.member.name === 'c')

		if (weirdIssue === undefined || weirdIssue.source.type !== 'dependency' || cIssue === undefined || cIssue.source.type !== 'dependency')
			throw new Error('test fixture: expected cycle issues on both "a->method:0:b" and "c"')

		expect(weirdIssue.source.related?.some(location => location.type === 'property' && location.name === 'c'))
			.toBe(true)
		expect(cIssue.source.related?.some(location => location.type === 'property' && location.name === 'a->method:0:b'))
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
