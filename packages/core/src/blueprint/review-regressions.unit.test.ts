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
