/**
 * Conformance: a callback's dependency and `emit` callables work only while that callback is the
 * innermost running callback, and code that is not that callback never counts as it — even while it runs
 * inside the callback's own operation.
 *
 * While an external listener (State/Property/diagnostics/Event/`WidgetDocument`/inspection) or a plugin
 * callback that owns no dependency callables (`validate`, `validateArgs`, `default`, a dependency
 * `.validate()` refinement, config and structure callbacks) runs, no callback is open: callables retained
 * from the running Method throw. The Method's own callables work again once that code returned or threw.
 *
 * The one accepted gap: a callable retained from an earlier invocation still works during a later
 * invocation of the same member, because the lifetime check compares members, not invocations.
 */

import type { ExecutionResult, JsonValue } from '../index'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWidgetDocument, createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectRuntime } from '../inspection'

interface ExecuteContext {
	readonly deps: {
		readonly setN: (value: number) => ExecutionResult<number, unknown>
		readonly twice: () => ExecutionResult<number, unknown>
		readonly helper: () => ExecutionResult<string, unknown>
		readonly refinedN: () => ExecutionResult<number | null, unknown>
	}
	readonly emit: { readonly changed: () => void }
}

/** Plugin callbacks call these when set, so each test decides what runs inside them. */
interface Hooks {
	execute?: (ctx: ExecuteContext) => void
	validate?: () => void
	validateArgs?: () => void
	refine?: () => void
	configValidate?: () => void
	defaultValue?: () => void
}

let hooks: Hooks = {}
/** The callables of the Method invocation that is running (or last ran). */
let retained: ExecuteContext | null = null

interface HostInterfaces {
	config: {
		raw: Record<string, JsonValue> | null
		resolved: Record<string, JsonValue>
	}
	state: {
		n: number
	}
	properties: {
		twice: number
	}
	methods: {
		run: () => null
		helper: () => string
	}
	events: {
		changed: []
	}
}

const isNumber = (input: unknown): input is number => typeof input === 'number'

const plugin = createWidgetPlugin('host')
	.description('Test widget')
	.interfaces<HostInterfaces>()
	.config({
		description: 'Test config',
		validate: (_input): _input is Record<string, JsonValue> | null => {
			hooks.configValidate?.()
			return true
		},
		resolve: raw => raw ?? {},
	})
	.state(state => state.n({
		validate: (input): input is number => {
			hooks.validate?.()
			return isNumber(input)
		},
		default: () => {
			hooks.defaultValue?.()
			return 0
		},
	}))
	.properties(properties => properties.twice({
		registerDeps: ({ dep }) => ({ n: dep.self.state.get('n') }),
		compute: ({ deps }) => {
			const n = deps.n()
			return n.ok ? (n.value ?? 0) * 2 : 0
		},
	}))
	.methods(methods => methods
		.run({
			registerDeps: ({ dep }) => ({
				setN: dep.self.state.set('n'),
				twice: dep.self.properties.get('twice'),
				helper: dep.self.methods.invoke('helper'),
				refinedN: dep.self.state.get('n')
					.validate((input): input is number => {
						hooks.refine?.()
						return isNumber(input)
					}),
			}),
			validateArgs: (args): args is [] => args.length === 0,
			execute: (ctx) => {
				retained = ctx as unknown as ExecuteContext
				hooks.execute?.(retained)
				return null
			},
		})
		.helper({
			validateArgs: (args): args is [] => {
				hooks.validateArgs?.()
				return args.length === 0
			},
			execute: () => 'helper',
		}))
	.events(events => events.changed({ description: 'Changed' }))
	.done()

const system = createWidgetSystem({ plugins: [plugin] })

function createHarness() {
	const blueprint = system.createBlueprint({ id: 'host', type: 'host' })
	if (blueprint.status !== 'valid')
		throw new Error(`expected a valid Blueprint: ${JSON.stringify(blueprint.diagnostics)}`)
	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('host')!
	const inspection = inspectRuntime(runtime)
	const inspected = inspection.getWidget(inspection.blueprint.rootNodeId)!
	return { runtime, widget, inspected }
}

/** Calls the running Method's retained setter and emitter; records how each call ended. */
function probeRetained(outcomes: string[]): void {
	for (const call of [() => retained!.deps.setN(99), () => retained!.emit.changed()]) {
		try {
			call()
			outcomes.push('ran')
		}
		catch (error) {
			outcomes.push(error instanceof TypeError ? 'TypeError' : String(error))
		}
	}
}

/** `probeRetained` the first time only, so a probe that wrongly succeeds cannot re-enter itself. */
function probeOnce(outcomes: string[]): () => void {
	let probed = false
	return () => {
		if (probed)
			return
		probed = true
		probeRetained(outcomes)
	}
}

beforeEach(() => {
	hooks = {}
	retained = null
})

const reported: unknown[] = []
function onUncaughtException(error: unknown): void {
	reported.push(error)
}

beforeEach(() => {
	reported.length = 0
	process.on('uncaughtException', onUncaughtException)
})

afterEach(async () => {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	process.off('uncaughtException', onUncaughtException)
})

describe('external listeners running inside a Method cannot use its callables', () => {
	it('a public Event listener of the Method\'s own emit', () => {
		const { widget } = createHarness()
		const outcomes: string[] = []
		widget.events.changed.subscribe(probeOnce(outcomes))
		hooks.execute = ({ emit }) => emit.changed()

		expect(widget.methods.run())
			.toEqual({ ok: true, value: null })
		expect(outcomes)
			.toEqual(['TypeError', 'TypeError'])
		expect(widget.state.n.get())
			.toBe(0)
	})

	it('an Event inspection listener', () => {
		const { widget, inspected } = createHarness()
		const outcomes: string[] = []
		inspected.getEvent('changed')!.subscribe(probeOnce(outcomes))
		hooks.execute = ({ emit }) => emit.changed()

		widget.methods.run()

		expect(outcomes)
			.toEqual(['TypeError', 'TypeError'])
		expect(widget.state.n.get())
			.toBe(0)
	})

	it('a State inspection listener notified by the Method\'s own write', () => {
		const { widget, inspected } = createHarness()
		const outcomes: string[] = []
		inspected.getState('n')!.subscribe(probeOnce(outcomes))
		hooks.execute = ({ deps }) => {
			deps.setN(1)
		}

		widget.methods.run()

		expect(outcomes)
			.toEqual(['TypeError', 'TypeError'])
		expect(widget.state.n.get())
			.toBe(1)
	})

	it('a Property inspection listener notified by the Method\'s dependency read', () => {
		const { widget, inspected } = createHarness()
		const outcomes: string[] = []
		inspected.getProperty('twice')!.subscribe(probeOnce(outcomes))
		hooks.execute = ({ deps }) => {
			deps.twice()
		}

		widget.methods.run()

		expect(outcomes)
			.toEqual(['TypeError', 'TypeError'])
		expect(widget.state.n.get())
			.toBe(0)
	})

	it('a WidgetDocument listener notified by a patch the Method applies', () => {
		const { widget } = createHarness()
		const document = createWidgetDocument({ system, source: { id: 'doc', type: 'host' } })
		const outcomes: string[] = []
		document.subscribe(probeOnce(outcomes))
		hooks.execute = () => {
			document.applyPatch([{ op: 'add', path: '/config', value: {} }])
		}

		widget.methods.run()

		expect(outcomes)
			.toEqual(['TypeError', 'TypeError'])
		expect(widget.state.n.get())
			.toBe(0)
	})
})

describe('plugin callbacks that own no callables cannot use the running Method\'s callables', () => {
	it('a State validate run by the Method\'s own write', () => {
		const { widget } = createHarness()
		const outcomes: string[] = []
		hooks.execute = ({ deps }) => {
			hooks.validate = probeOnce(outcomes)
			deps.setN(1)
		}

		widget.methods.run()

		expect(outcomes)
			.toEqual(['TypeError', 'TypeError'])
		expect(widget.state.n.get())
			.toBe(1)
	})

	it('the validateArgs of a Method the running Method invokes', () => {
		const { widget } = createHarness()
		const outcomes: string[] = []
		hooks.execute = ({ deps }) => {
			hooks.validateArgs = probeOnce(outcomes)
			deps.helper()
		}

		widget.methods.run()

		expect(outcomes)
			.toEqual(['TypeError', 'TypeError'])
		expect(widget.state.n.get())
			.toBe(0)
	})

	it('a dependency .validate() refinement', () => {
		const { widget } = createHarness()
		const outcomes: string[] = []
		hooks.execute = ({ deps }) => {
			hooks.refine = probeOnce(outcomes)
			deps.refinedN()
		}

		widget.methods.run()

		expect(outcomes)
			.toEqual(['TypeError', 'TypeError'])
		expect(widget.state.n.get())
			.toBe(0)
	})

	it('config, State default and validate callbacks of a Blueprint and Runtime created inside the Method', () => {
		const { widget } = createHarness()
		const outcomes: Record<string, string[]> = { config: [], defaultValue: [], validate: [] }
		hooks.execute = () => {
			hooks.configValidate = probeOnce(outcomes.config!)
			hooks.defaultValue = probeOnce(outcomes.defaultValue!)
			hooks.validate = probeOnce(outcomes.validate!)
			const nested = system.createBlueprint({ id: 'nested', type: 'host' })
			if (nested.status === 'valid')
				nested.createRuntime()
		}

		widget.methods.run()

		expect(outcomes)
			.toEqual({ config: ['TypeError', 'TypeError'], defaultValue: ['TypeError', 'TypeError'], validate: ['TypeError', 'TypeError'] })
		expect(widget.state.n.get())
			.toBe(0)
	})
})

describe('the running Method\'s callables work again afterwards', () => {
	it('after a throwing Event listener', () => {
		const { widget } = createHarness()
		widget.events.changed.subscribe(() => {
			throw new Error('listener boom')
		})
		hooks.execute = ({ deps, emit }) => {
			emit.changed()
			deps.setN(5)
		}

		expect(widget.methods.run())
			.toEqual({ ok: true, value: null })
		expect(widget.state.n.get())
			.toBe(5)
	})

	it('after a throwing refinement, validateArgs or State validate the Method caught', () => {
		const { widget } = createHarness()
		const boom = (): never => {
			throw new Error('callback boom')
		}
		const caught: unknown[] = []
		hooks.execute = ({ deps }) => {
			for (const run of [() => deps.refinedN(), () => deps.helper(), () => deps.setN(3)]) {
				hooks.refine = boom
				hooks.validateArgs = boom
				hooks.validate = boom
				try {
					run()
				}
				catch (error) {
					caught.push((error as Error).message)
				}
				hooks = { execute: hooks.execute }
			}
			deps.setN(6)
		}

		expect(widget.methods.run())
			.toEqual({ ok: true, value: null })
		expect(caught)
			.toEqual(['callback boom', 'callback boom', 'callback boom'])
		expect(widget.state.n.get())
			.toBe(6)
	})
})
