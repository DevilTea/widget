/**
 * Conformance regressions (issue #204): a State write made by a listener while another Runtime operation is in
 * progress must not make a subscriber miss a notification.
 *
 * A listener runs inside the flush of the operation that notified it, at alien-signals batch depth `0`. A
 * `set()` or `resetState()` it made flushed on its own there, a second flush inside the first, while the
 * listener's own subscription effect was still running; alien-signals does not queue an effect again for a
 * write made while that effect runs. When the write's own listeners wrote back what the first listener
 * observes, that subscriber was never told: its last delivered value stayed old, and nothing threw. A write
 * nested in another operation now leaves its notifications to the outermost operation, as a nested Method
 * invocation already did (issue #199).
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface NodeInterfaces {
	state: { s: number }
	properties: { out: number }
	methods: { setTo: (value: number) => number }
}

const isNumber = (input: unknown): input is number => typeof input === 'number'

const nodePlugin = createWidgetPlugin('node')
	.description('Test widget')
	.interfaces<NodeInterfaces>()
	.state(state => state.s({ validate: isNumber, default: () => 1 }))
	.properties(properties => properties.out({
		registerDeps: ({ dep }) => ({ s: dep.self.state.get('s') }),
		compute: ({ deps }) => {
			const s = deps.s()
			return s.ok && s.value !== null ? s.value : 0
		},
	}))
	.methods(methods => methods.setTo({
		registerDeps: ({ dep }) => ({ own: dep.self.state.set('s') }),
		validateArgs: (args): args is [number] => isNumber(args[0]),
		execute: ({ args, deps }) => {
			deps.own(args[0])
			return args[0]
		},
	}))
	.done()

const graphPlugin = createWidgetPlugin('graph')
	.description('Test widget')
	.interfaces<{ slots: 'nodes' }>()
	.slots({ nodes: { description: 'Nodes' } })
	.done()

const system = createWidgetSystem({ plugins: [nodePlugin, graphPlugin] })

type Kind = 'property' | 'state'

/** Widgets `a`, `b` (and `c`), each with State `s` (default 1) and Property `out` equal to it. */
function createPair(kind: Kind) {
	const blueprint = system.createBlueprint({
		id: 'g',
		type: 'graph',
		slots: { nodes: [{ id: 'a', type: 'node' }, { id: 'b', type: 'node' }, { id: 'c', type: 'node' }] },
	})
	if (blueprint.status !== 'valid')
		throw new Error('fixture setup error: the Blueprint is invalid')
	const runtime = blueprint.createRuntime()
	const widget = (id: string) => {
		const found = runtime.getWidget(id)
		if (found?.type !== 'node')
			throw new Error(`missing node ${id}`)
		return found
	}
	const read = (id: string): number | null => {
		if (kind === 'state')
			return widget(id).state.s.get()
		const result = widget(id).properties.out.get()
		return result.ok ? result.value : null
	}
	const subscribe = (id: string, listener: (value: number | null) => void) => kind === 'state'
		? widget(id).state.s.subscribe(listener)
		: widget(id).properties.out.subscribe(result => listener(result.ok ? result.value : null))
	if (kind === 'property') {
		read('a')
		read('b')
	}
	return { runtime, widget, read, subscribe }
}

describe('a listener that writes while another operation notifies (issue #204)', () => {
	for (const via of ['set', 'method'] as const) {
		it(`delivers the value written back to a Property subscriber whose listener is still running (${via})`, () => {
			const { widget, read, subscribe } = createPair('property')
			const log: string[] = []
			subscribe('a', (value) => {
				log.push(`a=${value}`)
				if (value === 7)
					via === 'set' ? widget('b').state.s.set(44) : widget('b').methods.setTo(44)
			})
			subscribe('b', (value) => {
				log.push(`b=${value}`)
				if (value === 44)
					via === 'set' ? widget('a').state.s.set(2) : widget('a').methods.setTo(2)
			})

			widget('a').state.s.set(7)

			expect(log)
				.toEqual(['a=7', 'b=44', 'a=2'])
			expect([read('a'), read('b')])
				.toEqual([2, 44])
		})
	}

	it('does the same for State subscribers', () => {
		const { widget, read, subscribe } = createPair('state')
		const log: string[] = []
		subscribe('a', (value) => {
			log.push(`a=${value}`)
			if (value === 7)
				widget('b').state.s.set(44)
		})
		subscribe('b', (value) => {
			log.push(`b=${value}`)
			if (value === 44)
				widget('a').state.s.set(2)
		})

		widget('a').state.s.set(7)

		expect(log)
			.toEqual(['a=7', 'b=44', 'a=2'])
		expect([read('a'), read('b')])
			.toEqual([2, 44])
	})

	for (const kind of ['property', 'state'] as const) {
		it(`delivers a widget resetState() made by a listener to a ${kind} subscriber whose listener is still running`, () => {
			const { widget, read, subscribe } = createPair(kind)
			const log: string[] = []
			subscribe('a', (value) => {
				log.push(`a=${value}`)
				if (value === 7)
					widget('b').state.s.set(44)
			})
			subscribe('b', (value) => {
				log.push(`b=${value}`)
				if (value === 44) {
					widget('a')
						.resetState()
				}
			})

			widget('a').state.s.set(7)

			expect(log)
				.toEqual(['a=7', 'b=44', 'a=1'])
			expect([read('a'), read('b')])
				.toEqual([1, 44])
		})

		it(`delivers a runtime resetState() made by a listener to a ${kind} subscriber whose listener is still running`, () => {
			const { runtime, widget, read, subscribe } = createPair(kind)
			const log: string[] = []
			subscribe('a', (value) => {
				log.push(`a=${value}`)
				if (value === 7)
					widget('b').state.s.set(44)
			})
			subscribe('b', (value) => {
				log.push(`b=${value}`)
				if (value === 44)
					runtime.resetState()
			})

			widget('a').state.s.set(7)

			// The reset also restores `b`, which `b`'s own listener wrote: whether that listener is called again
			// for its own write is not guaranteed, so only `a`'s sequence and the values are pinned here.
			expect(log.slice(0, 2))
				.toEqual(['a=7', 'b=44'])
			expect(log.filter(entry => entry.startsWith('a=')))
				.toEqual(['a=7', 'a=1'])
			expect([read('a'), read('b')])
				.toEqual([1, 1])
		})
	}
})

describe('when the subscribers of a write made by a listener are notified', () => {
	for (const kind of ['property', 'state'] as const) {
		for (const write of ['set', 'widget resetState', 'runtime resetState'] as const) {
			it(`notifies them after the ${write} returns, within the same outer operation (${kind} subscribers)`, () => {
				const { runtime, widget, subscribe } = createPair(kind)
				widget('b').state.s.set(30)
				const order: string[] = []
				subscribe('c', (value) => {
					order.push(`c listener (${value})`)
					// Writes only for the host's value, so a further call (the runtime reset also restores `c`, and
					// whether `c`'s listener is called again for that is not guaranteed) adds one entry and nothing else.
					if (value !== 7)
						return
					if (write === 'set') {
						widget('b').state.s.set(50)
					}
					else if (write === 'widget resetState') {
						widget('b')
							.resetState()
					}
					else {
						runtime.resetState()
					}
					order.push(`${write} returned`)
				})
				subscribe('b', value => order.push(`b listener (${value})`))

				widget('c').state.s.set(7)
				order.push('c.set returned')

				const written = write === 'set' ? 50 : 1
				expect(order.filter(entry => entry !== 'c listener (1)'))
					.toEqual(['c listener (7)', `${write} returned`, `b listener (${written})`, 'c.set returned'])
			})
		}

		it(`still notifies the subscribers of a top-level set() before it returns (${kind} subscribers)`, () => {
			const { widget, subscribe } = createPair(kind)
			const order: string[] = []
			subscribe('a', value => order.push(`a listener (${value})`))

			widget('a').state.s.set(7)
			order.push('set returned')

			expect(order)
				.toEqual(['a listener (7)', 'set returned'])
		})
	}
})
