/**
 * Conformance: a failure at the tail of a long Property dependency chain reaches the head as nested
 * `dependency-target-failed` diagnostics, one per link, exactly as for a short chain, without the cost or the
 * stack depth of the read growing with anything but the chain itself.
 *
 * Every dependent wraps its failing dependency's diagnostics 1:1 and keeps the wrapped diagnostic as its
 * `cause`, so the head's cause chain is as long as the dependency chain. The chain is walked iteratively here:
 * a recursive walk (or a recursive deep equality) is exactly what a long chain must not need.
 */

import type { ExecutionResult } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

/** Far beyond what V8 can nest, and long enough that re-walking each cause made a read quadratic. */
const LONG = 8_000

interface LinkConfig {
	readonly prev: string | null
}

interface LinkInterfaces {
	config: { raw: LinkConfig, resolved: LinkConfig }
	state: { n: number }
	properties: { total: number }
	methods: { readTotal: () => number }
}

const isNumber = (input: unknown): input is number => typeof input === 'number'

function numberOf(result: ExecutionResult<unknown, unknown>): number {
	return result.ok && typeof result.value === 'number' ? result.value : 0
}

const stats = { computeCalls: 0 }

const linkPlugin = createWidgetPlugin('link')
	.description('Test widget')
	.interfaces<LinkInterfaces>()
	.config({
		description: 'Link',
		validate: (input): input is LinkConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw!,
	})
	.state(state => state.n({ validate: isNumber, default: () => 1 }))
	.properties(properties => properties.total({
		registerDeps: ({ dep, config }) => ({
			prev: dep.widget(config.prev ?? 'absent')
				.optional()
				.properties
				.get('total'),
			n: dep.self.state.get('n'),
		}),
		compute: ({ deps, addDiagnostic }) => {
			stats.computeCalls++
			const prev = deps.prev()
			const own = numberOf(deps.n())
			if (own === 0)
				addDiagnostic({ message: 'the tail failed' })
			return numberOf(prev) + own
		},
	}))
	.methods(methods => methods.readTotal({
		registerDeps: ({ dep }) => ({ total: dep.self.properties.get('total') }),
		validateArgs: (args): args is [] => args.length === 0,
		execute: ({ deps }) => numberOf(deps.total()),
	}))
	.done()

const listPlugin = createWidgetPlugin('list')
	.description('Test widget')
	.interfaces<{ slots: 'items' }>()
	.slots({ items: { description: 'Items' } })
	.done()

const system = createWidgetSystem({ plugins: [linkPlugin, listPlugin] })

function createFailingChain(length: number) {
	const items = Array.from({ length }, (_, index) => ({ id: `l${index}`, type: 'link', config: { prev: index === 0 ? null : `l${index - 1}` } }))
	const blueprint = system.createBlueprint({ id: 'list', type: 'list', slots: { items } })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const runtime = blueprint.createRuntime()
	const link = (index: number) => {
		const widget = runtime.getWidget(`l${index}`)
		if (widget?.type !== 'link')
			throw new Error('expected a link widget')
		return widget
	}
	link(0).state.n.set(0)
	stats.computeCalls = 0
	return { runtime, link }
}

interface DiagnosticRecord {
	readonly code: string
	readonly location: Readonly<Record<string, unknown>>
	readonly message: string
	readonly dependency?: { readonly target: object, readonly operation: object }
	readonly related?: readonly object[]
	readonly cause?: DiagnosticRecord
	readonly result?: unknown
}

/**
 * Checks, iteratively, that `head` is the diagnostic a dependency-ordered evaluation gives at link `top`:
 * one `dependency-target-failed` per link down to the tail's own `invalid-property-result`, each cause the very
 * diagnostic its dependency committed, and every framework-owned part frozen.
 */
function expectWrappedChain(head: DiagnosticRecord, top: number, link: (index: number) => { properties: { total: { getDiagnostics: () => readonly unknown[] } } }): void {
	let current: DiagnosticRecord | undefined = head
	for (let index = top; index >= 0; index--) {
		const diagnostic: DiagnosticRecord = current!
		expect(Object.isFrozen(diagnostic))
			.toBe(true)
		expect(Object.isFrozen(diagnostic.location))
			.toBe(true)
		expect(diagnostic.location)
			.toEqual({ type: 'property', widgetId: `l${index}`, name: 'total' })
		// The tail's message, preserved 1:1 by every wrap.
		expect(diagnostic.message)
			.toBe('the tail failed')
		if (index === 0) {
			expect(diagnostic.code)
				.toBe('invalid-property-result')
			expect(diagnostic.cause)
				.toBeUndefined()
			break
		}
		expect(diagnostic.code)
			.toBe('dependency-target-failed')
		expect(Object.keys(diagnostic)
			.sort())
			.toEqual(['cause', 'code', 'dependency', 'location', 'message', 'related'])
		expect(diagnostic.dependency)
			.toEqual({
				target: { type: 'widget', widgetId: `l${index - 1}`, optional: true },
				operation: { type: 'property-get', name: 'total' },
			})
		expect(diagnostic.related)
			.toEqual([{ type: 'property', widgetId: `l${index - 1}`, name: 'total' }])
		expect(Object.isFrozen(diagnostic.dependency))
			.toBe(true)
		expect(Object.isFrozen(diagnostic.dependency!.target))
			.toBe(true)
		expect(Object.isFrozen(diagnostic.dependency!.operation))
			.toBe(true)
		expect(Object.isFrozen(diagnostic.related))
			.toBe(true)
		expect(Object.isFrozen(diagnostic.related![0]))
			.toBe(true)
		expect(diagnostic.cause)
			.toBe(link(index - 1).properties.total.getDiagnostics()[0])
		current = diagnostic.cause
	}
}

describe('a long chain whose tail fails', () => {
	it('reports the failure at the head as one wrapped diagnostic per link, frozen at every level', () => {
		const { link } = createFailingChain(LONG)

		const result = link(LONG - 1).properties.total.get()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('expected a failure')
		expect(result.failure.diagnostics)
			.toHaveLength(1)
		expect(Object.isFrozen(result.failure.diagnostics))
			.toBe(true)
		expect(link(LONG - 1).properties.total.getDiagnostics())
			.toBe(result.failure.diagnostics)
		expectWrappedChain(result.failure.diagnostics[0] as DiagnosticRecord, LONG - 1, link)
		expect(stats.computeCalls)
			.toBeLessThanOrEqual(3 * LONG)
	})

	it('clears at every level once the tail is fixed', () => {
		const { runtime, link } = createFailingChain(LONG)
		link(LONG - 1).properties.total.get()

		link(0).state.n.set(1)

		expect(link(LONG - 1).properties.total.get())
			.toEqual({ ok: true, value: LONG })
		for (let index = 0; index < LONG; index += 997) {
			expect(link(index).properties.total.getDiagnostics())
				.toEqual([])
		}
		expect(runtime.getDiagnostics())
			.toEqual([])
	})

	it('reaches a subscriber of the head, which recovers after the fix', () => {
		const { link } = createFailingChain(LONG)
		const seen: unknown[] = []
		link(LONG - 1).properties.total.subscribe(result => seen.push(result.ok ? result.value : result.failure.diagnostics[0]!.code))

		link(LONG - 1).state.n.set(2)
		link(0).state.n.set(1)

		expect(seen)
			.toEqual(['dependency-target-failed', LONG + 1])
	})

	it('reaches a Method that reads the head, wrapped once more', () => {
		const { link } = createFailingChain(LONG)

		const result = link(LONG - 1).methods.readTotal()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('expected a failure')
		const wrapper = result.failure.diagnostics[0] as DiagnosticRecord
		expect(wrapper.code)
			.toBe('dependency-target-failed')
		expect(wrapper.location)
			.toEqual({ type: 'method', widgetId: `l${LONG - 1}`, name: 'readTotal' })
		expect(Object.isFrozen(wrapper))
			.toBe(true)
		expectWrappedChain(wrapper.cause!, LONG - 1, link)
	})

	it('gives the same diagnostics read cold from the head as read in dependency order', () => {
		const cold = createFailingChain(LONG)
		const ordered = createFailingChain(LONG)

		cold.link(LONG - 1).properties.total.get()
		for (let index = 0; index < LONG; index++)
			ordered.link(index).properties.total.get()

		// Each level against the other Runtime's same level: equal own fields, and the cause at the same place.
		const describeLevel = (diagnostic: DiagnosticRecord) => ({ ...diagnostic, cause: diagnostic.cause?.location })
		for (let index = 0; index < LONG; index++) {
			const ofCold = cold.link(index).properties.total.getDiagnostics() as readonly DiagnosticRecord[]
			const ofOrdered = ordered.link(index).properties.total.getDiagnostics() as readonly DiagnosticRecord[]
			expect(ofCold.map(describeLevel))
				.toEqual(ofOrdered.map(describeLevel))
		}
	})
})
