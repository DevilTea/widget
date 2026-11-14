/**
 * A Property may depend only on a read-only Method: one that neither writes State nor emits an Event,
 * itself or through the Methods it invokes. A Property that depends on any other Method is rejected when
 * the Blueprint is compiled, with one `property-dependency-has-side-effects` diagnostic per
 * Property-to-Method edge, whose message says which effect the Method has and whose `related` is the
 * directly invoked Method.
 */

import type { ExecutionResult, WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectBlueprint } from '../inspection'

const noArgs = (args: readonly unknown[]): args is [] => args.length === 0
const numberOf = (result: ExecutionResult<unknown, unknown>): number => result.ok && typeof result.value === 'number' ? result.value : 0

type Target = 'ping' | 'relay' | 'relayTwice' | 'bump' | 'bumpAndPing' | 'bumpThroughRelay' | 'quiet' | 'peek' | 'peekThroughPeek'

interface NodeInterfaces extends WidgetInterfaces {
	config: { raw: { prev?: string } | null, resolved: { prev: string | null } }
	state: { s: number }
	properties: { out: number }
	methods: {
		ping: () => void
		relay: () => void
		relayTwice: () => void
		bump: () => void
		bumpAndPing: () => void
		bumpThroughRelay: () => void
		quiet: () => void
		peek: () => number
		peekThroughPeek: () => number
	}
	events: { pinged: [] }
}

/** A node of a chain whose Property `out` depends on the Method named by `target`. */
function nodePlugin(target: Target) {
	return createWidgetPlugin('node')
		.description('A node of the chain')
		.interfaces<NodeInterfaces>()
		.config({
			description: 'Where the node reads from',
			validate: (input): input is { prev?: string } | null => input === null || typeof input === 'object',
			resolve: raw => ({ prev: raw?.prev ?? null }),
		})
		.state(state => state.s({ validate: (input): input is number => typeof input === 'number', default: () => 1 }))
		.properties(properties => properties.out({
			registerDeps: ({ dep, config }) => ({
				s: dep.self.state.get('s'),
				prev: dep.widget(config.prev ?? 'absent')
					.optional().properties.get('out'),
				call: dep.self.methods.invoke(target),
			}),
			compute: ({ deps }) => {
				deps.call()
				return numberOf(deps.s()) + numberOf(deps.prev())
			},
		}))
		.methods(methods => methods
			// Emits an Event itself.
			.ping({
				validateArgs: noArgs,
				emits: ['pinged'],
				execute: ({ emit }) => {
					emit.pinged()
				},
			})
			// Declares nothing: it emits only through `ping`, one Method away.
			.relay({
				validateArgs: noArgs,
				registerDeps: ({ dep }) => ({ ping: dep.self.methods.invoke('ping') }),
				execute: ({ deps }) => {
					deps.ping()
				},
			})
			// Two Methods away.
			.relayTwice({
				validateArgs: noArgs,
				registerDeps: ({ dep }) => ({ relay: dep.self.methods.invoke('relay') }),
				execute: ({ deps }) => {
					deps.relay()
				},
			})
			// Writes State only.
			.bump({
				validateArgs: noArgs,
				registerDeps: ({ dep }) => ({ set: dep.self.state.set('s') }),
				execute: ({ deps }) => {
					deps.set(2)
				},
			})
			// Writes State and emits an Event itself.
			.bumpAndPing({
				validateArgs: noArgs,
				registerDeps: ({ dep }) => ({ set: dep.self.state.set('s') }),
				emits: ['pinged'],
				execute: ({ deps, emit }) => {
					deps.set(2)
					emit.pinged()
				},
			})
			// Writes State itself and emits only through `ping`.
			.bumpThroughRelay({
				validateArgs: noArgs,
				registerDeps: ({ dep }) => ({ set: dep.self.state.set('s'), relay: dep.self.methods.invoke('relay') }),
				execute: ({ deps }) => {
					deps.set(2)
					deps.relay()
				},
			})
			// Declares an empty list: it emits nothing.
			.quiet({
				validateArgs: noArgs,
				emits: [],
				execute: () => {},
			})
			.peek({
				validateArgs: noArgs,
				registerDeps: ({ dep }) => ({ s: dep.self.state.get('s') }),
				execute: ({ deps }) => numberOf(deps.s()),
			})
			.peekThroughPeek({
				validateArgs: noArgs,
				registerDeps: ({ dep }) => ({ peek: dep.self.methods.invoke('peek') }),
				execute: ({ deps }) => numberOf(deps.peek()),
			}))
		.events(events => events.pinged({ description: 'The Method ran' }))
		.done()
}

const chainPlugin = createWidgetPlugin('chain')
	.description('A chain')
	.interfaces<{ slots: 'nodes' }>()
	.slots({ nodes: { description: 'Nodes' } })
	.done()

function chainSource(length: number) {
	return {
		id: 'c',
		type: 'chain',
		slots: { nodes: Array.from({ length }, (_, i) => ({ id: `l${i}`, type: 'node', config: i === 0 ? {} : { prev: `l${i - 1}` } })) },
	}
}

function compileChain(target: Target, length: number) {
	return createWidgetSystem({ plugins: [nodePlugin(target), chainPlugin] })
		.createBlueprint(chainSource(length))
}

function summarize(blueprint: ReturnType<typeof compileChain>) {
	return blueprint.diagnostics.map(diagnostic => ({
		code: diagnostic.code,
		message: diagnostic.message,
		owner: diagnostic.location.type === 'property' ? diagnostic.location.name : diagnostic.location.type,
		related: 'related' in diagnostic ? diagnostic.related?.map(location => location.type === 'method' ? location.name : location.type) : undefined,
	}))
}

describe('a Property that depends on a Method with side effects', () => {
	it('is rejected when the Method emits an Event: the reproduction of issue #203, one diagnostic per Property', () => {
		const blueprint = compileChain('ping', 3)
		expect(blueprint.status)
			.toBe('invalid')
		expect(summarize(blueprint))
			.toEqual([0, 1, 2].map(() => ({
				code: 'property-dependency-has-side-effects',
				message: 'Property "out" invokes method "ping", which emits an Event (itself or through the Methods it invokes).',
				owner: 'out',
				related: ['ping'],
			})))
	})

	it('is rejected when the Method writes State, with a message that says so', () => {
		const blueprint = compileChain('bump', 1)
		expect(blueprint.status)
			.toBe('invalid')
		expect(summarize(blueprint))
			.toEqual([{
				code: 'property-dependency-has-side-effects',
				message: 'Property "out" invokes method "bump", which writes State (itself or through the Methods it invokes).',
				owner: 'out',
				related: ['bump'],
			}])
	})

	it('is rejected when the Method both writes State and emits an Event, with one diagnostic and no second code', () => {
		const blueprint = compileChain('bumpAndPing', 1)
		expect(blueprint.status)
			.toBe('invalid')
		expect(summarize(blueprint))
			.toEqual([{
				code: 'property-dependency-has-side-effects',
				message: 'Property "out" invokes method "bumpAndPing", which writes State and emits an Event (itself or through the Methods it invokes).',
				owner: 'out',
				related: ['bumpAndPing'],
			}])
	})

	it('is rejected when the Method emits only through a Method it invokes; `related` names the direct target', () => {
		for (const [target, direct] of [['relay', 'relay'], ['relayTwice', 'relayTwice']] as const) {
			const blueprint = compileChain(target, 1)
			expect(blueprint.status)
				.toBe('invalid')
			expect(summarize(blueprint))
				.toEqual([{
					code: 'property-dependency-has-side-effects',
					message: `Property "out" invokes method "${direct}", which emits an Event (itself or through the Methods it invokes).`,
					owner: 'out',
					related: [direct],
				}])
		}
	})

	it('names both effects when the writes are direct and the emit comes through a Method it invokes', () => {
		const blueprint = compileChain('bumpThroughRelay', 1)
		expect(summarize(blueprint))
			.toEqual([{
				code: 'property-dependency-has-side-effects',
				message: 'Property "out" invokes method "bumpThroughRelay", which writes State and emits an Event (itself or through the Methods it invokes).',
				owner: 'out',
				related: ['bumpThroughRelay'],
			}])
	})

	it('is rejected across widgets, like a State write', () => {
		interface ReaderInterfaces extends WidgetInterfaces {
			slots: 'children'
			properties: { reader: number }
			methods: { outer: () => void }
		}
		interface EmitterInterfaces extends WidgetInterfaces {
			methods: { fire: () => void }
			events: { fired: [] }
		}
		const reader = createWidgetPlugin('reader')
			.description('Reader')
			.interfaces<ReaderInterfaces>()
			.slots({ children: { description: 'Children' } })
			.properties(properties => properties.reader({
				registerDeps: ({ dep }) => ({ outer: dep.self.methods.invoke('outer') }),
				compute: ({ deps }) => numberOf(deps.outer()),
			}))
			.methods(methods => methods.outer({
				validateArgs: noArgs,
				registerDeps: ({ dep }) => ({ fire: dep.widget('emitter').methods.invoke('fire') }),
				execute: ({ deps }) => {
					deps.fire()
				},
			}))
			.done()
		const emitter = createWidgetPlugin('emitter')
			.description('Emitter')
			.interfaces<EmitterInterfaces>()
			.methods(methods => methods.fire({ validateArgs: noArgs, emits: ['fired'], execute: ({ emit }) => emit.fired() }))
			.events(events => events.fired({ description: 'Fired' }))
			.done()
		const blueprint = createWidgetSystem({ plugins: [reader, emitter] })
			.createBlueprint({ id: 'root', type: 'reader', slots: { children: [{ id: 'emitter', type: 'emitter' }] } })
		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.message, 'related' in diagnostic ? diagnostic.related?.map(location => location.type === 'method' ? `${location.node.id}.${location.name}` : location.type) : undefined]))
			.toEqual([['property-dependency-has-side-effects', 'Property "reader" invokes method "outer", which emits an Event (itself or through the Methods it invokes).', ['root.outer']]])
	})
})

describe('a Property that depends on a read-only Method', () => {
	it('keeps the Blueprint valid when the Method only reads State, directly or through another read-only Method', () => {
		for (const target of ['peek', 'peekThroughPeek'] as const) {
			const blueprint = compileChain(target, 3)
			expect(blueprint.status)
				.toBe('valid')
			expect(blueprint.diagnostics)
				.toEqual([])
		}
	})

	it('keeps the Blueprint valid when the Method declares an empty `emits`', () => {
		const blueprint = compileChain('quiet', 3)
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
	})

	it('still lets the host and other Methods invoke a Method that emits', () => {
		interface HostInterfaces extends WidgetInterfaces {
			methods: { outer: () => void, fire: () => void }
			events: { fired: [] }
		}
		const host = createWidgetPlugin('host')
			.description('Host')
			.interfaces<HostInterfaces>()
			.methods(methods => methods
				.outer({
					validateArgs: noArgs,
					registerDeps: ({ dep }) => ({ fire: dep.self.methods.invoke('fire') }),
					// Declares nothing: the callee's emit is the callee's own.
					execute: ({ deps }) => {
						deps.fire()
					},
				})
				.fire({ validateArgs: noArgs, emits: ['fired'], execute: ({ emit }) => emit.fired() }))
			.events(events => events.fired({ description: 'Fired' }))
			.done()
		const blueprint = createWidgetSystem({ plugins: [host] })
			.createBlueprint({ id: 'h', type: 'host' })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const widget = blueprint.createRuntime()
			.getWidget('h')!
		let fired = 0
		widget.events.fired.subscribe(() => fired++)
		expect(widget.methods.outer().ok)
			.toBe(true)
		expect(fired)
			.toBe(1)
		expect(widget.methods.fire().ok)
			.toBe(true)
		expect(fired)
			.toBe(2)
	})
})

describe('blueprint inspection of the effects of a Method', () => {
	it('reports `transitivelyWrites` and `transitivelyEmits` as independent compiler facts', () => {
		interface HostInterfaces extends WidgetInterfaces {
			state: { s: number }
			methods: { reader: () => number, writer: () => void, emitter: () => void, both: () => void, viaWriter: () => void, viaEmitter: () => void, viaBoth: () => void, silent: () => void }
			events: { fired: [] }
		}
		const host = createWidgetPlugin('host')
			.description('Host')
			.interfaces<HostInterfaces>()
			.state(state => state.s({ validate: (input): input is number => typeof input === 'number', default: () => 0 }))
			.methods(methods => methods
				.reader({
					validateArgs: noArgs,
					registerDeps: ({ dep }) => ({ s: dep.self.state.get('s') }),
					execute: ({ deps }) => numberOf(deps.s()),
				})
				.writer({
					validateArgs: noArgs,
					registerDeps: ({ dep }) => ({ set: dep.self.state.set('s') }),
					execute: ({ deps }) => {
						deps.set(1)
					},
				})
				.emitter({ validateArgs: noArgs, emits: ['fired'], execute: ({ emit }) => emit.fired() })
				.both({
					validateArgs: noArgs,
					registerDeps: ({ dep }) => ({ set: dep.self.state.set('s') }),
					emits: ['fired'],
					execute: ({ deps, emit }) => {
						deps.set(1)
						emit.fired()
					},
				})
				.viaWriter({
					validateArgs: noArgs,
					registerDeps: ({ dep }) => ({ writer: dep.self.methods.invoke('writer') }),
					execute: ({ deps }) => {
						deps.writer()
					},
				})
				.viaEmitter({
					validateArgs: noArgs,
					registerDeps: ({ dep }) => ({ emitter: dep.self.methods.invoke('emitter') }),
					execute: ({ deps }) => {
						deps.emitter()
					},
				})
				.viaBoth({
					validateArgs: noArgs,
					registerDeps: ({ dep }) => ({ both: dep.self.methods.invoke('both') }),
					execute: ({ deps }) => {
						deps.both()
					},
				})
				.silent({ validateArgs: noArgs, emits: [], execute: () => {} }))
			.events(events => events.fired({ description: 'Fired' }))
			.done()
		const blueprint = createWidgetSystem({ plugins: [host] })
			.createBlueprint({ id: 'h', type: 'host' })
		const node = inspectBlueprint(blueprint).nodes[0]
		if (node === undefined || !node.resolved)
			throw new Error('expected a resolved node')
		expect(Object.fromEntries(node.methods.map(method => [method.name, [method.transitivelyWrites, method.transitivelyEmits]])))
			.toEqual({
				reader: [false, false],
				writer: [true, false],
				emitter: [false, true],
				both: [true, true],
				viaWriter: [true, false],
				viaEmitter: [false, true],
				viaBoth: [true, true],
				silent: [false, false],
			})
		expect(node.methods.map(method => Object.keys(method)
			.sort()))
			.toEqual(node.methods.map(() => ['dependencies', 'name', 'transitivelyEmits', 'transitivelyWrites', 'type']))
	})
})
