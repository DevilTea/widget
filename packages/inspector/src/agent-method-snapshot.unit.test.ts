/* eslint-disable no-proto, no-restricted-properties -- `__proto__` is a legitimate Method name that must survive the Agent's lookups */
import type { WidgetChild, WidgetInterfaces } from '@deviltea/widget-core'
import type { CreateInspectorAgentOptions } from './agent'
import type { InspectorEventMessage, InspectorResponseMessage } from './protocol'
import { createWidgetPlugin, createWidgetSystem, undocumented } from '@deviltea/widget-core'
import { describe, expect, it, vi } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { INSPECTOR_PROTOCOL_VERSION, parseInspectorResponseMessage } from './protocol'
import { createInProcessInspectorTransportPair } from './transport'

interface MethodInterfaces extends WidgetInterfaces {
	state: { count: number }
	properties: { doubled: number }
	methods: {
		// Declared first on purpose: `__proto__` and `constructor` are legitimate Method names.
		['__proto__']: () => number
		['constructor']: () => number
		check: (ok: boolean) => boolean
		fail: (text: string) => string
		strict: (value: number) => number
		chain: () => string
		outer: () => boolean
		explode: () => number
		bump: () => number
	}
}

const validateCount = (input: unknown): input is number => typeof input === 'number' && Number.isFinite(input)

const executeSpies = {
	check: vi.fn(),
	bump: vi.fn(),
	validateStrict: vi.fn(),
}

const MethodPlugin = createWidgetPlugin('MethodSnapshotFixture')
	.description(undocumented)
	.interfaces<MethodInterfaces>()
	.state(state => state.count({ description: undocumented, validate: validateCount, default: () => 1 }))
	.properties(properties => properties.doubled({
		description: undocumented,
		registerDeps: ({ dep }) => dep.self.state.get('count'),
		compute: ({ deps }) => (deps().ok ? 2 : 0),
	}))
	.methods(methods => methods
		.__proto__({
			description: undocumented,
			validateArgs: (args): args is [] => args.length === 0,
			execute: () => 1,
		})
		.constructor({
			description: undocumented,
			validateArgs: (args): args is [] => args.length === 0,
			execute: () => 2,
		})
		.check({
			description: undocumented,
			validateArgs: (args): args is [boolean] => args.length === 1 && typeof args[0] === 'boolean',
			execute: ({ args: [ok], addDiagnostic }) => {
				executeSpies.check()
				if (!ok)
					addDiagnostic({ message: 'bad', reason: 'r', path: ['x'] })
				return ok
			},
		})
		.fail({
			description: undocumented,
			validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
			execute: ({ args: [text], addDiagnostic }) => {
				addDiagnostic({ message: 'always fails', reason: 'always' })
				return text
			},
		})
		.strict({
			description: undocumented,
			validateArgs: (args): args is [number] => {
				executeSpies.validateStrict()
				return args.length === 1 && typeof args[0] === 'number'
			},
			execute: ({ args: [value] }) => value,
		})
		.chain({
			description: undocumented,
			registerDeps: ({ dep }) => dep.self.methods.invoke('fail'),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				deps('inner')
				return 'chain'
			},
		})
		.outer({
			description: undocumented,
			registerDeps: ({ dep }) => dep.self.methods.invoke('check'),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				deps(false)
				deps(true)
				return true
			},
		})
		.explode({
			description: undocumented,
			validateArgs: (args): args is [] => args.length === 0,
			execute: () => {
				throw new Error('explode')
			},
		})
		.bump({
			description: undocumented,
			registerDeps: ({ dep }) => ({ count: dep.self.state.get('count'), setCount: dep.self.state.set('count') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				executeSpies.bump()
				const current = deps.count()
				const next = (current.ok ? current.value ?? 0 : 0) + 1
				deps.setCount(next)
				return next
			},
		}))
	.done()

const NoMethodPlugin = createWidgetPlugin('NoMethodFixture')
	.description(undocumented)
	.interfaces<WidgetInterfaces>()
	.done()

interface MethodRootInterfaces extends WidgetInterfaces {
	slots: { body: WidgetChild }
}

const RootPlugin = createWidgetPlugin('MethodSnapshotRoot')
	.description(undocumented)
	.interfaces<MethodRootInterfaces>()
	.slots({ body: { description: undocumented } })
	.done()

const RUNTIME_ID = 'runtime-method'
const LOCATION = (name: string) => ({ type: 'method', widgetId: 'probe', name })

function createFixture(agentOptions: Partial<CreateInspectorAgentOptions> = {}) {
	const system = createWidgetSystem({ plugins: [RootPlugin, MethodPlugin, NoMethodPlugin] })
	const blueprint = system.createBlueprint({
		id: 'root',
		type: 'MethodSnapshotRoot',
		slots: { body: [{ id: 'probe', type: 'MethodSnapshotFixture' }, { id: 'plain', type: 'NoMethodFixture' }] },
	})
	if (blueprint.status !== 'valid')
		throw new Error('Expected the Method fixture Blueprint to compile.')
	const runtime = blueprint.createRuntime()
	const probe = runtime.getWidget('probe')
	if (probe === null || probe.type !== 'MethodSnapshotFixture')
		throw new Error('Expected the probe widget.')
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: RUNTIME_ID, ...agentOptions })
	const client = createInspectorClient(pair.client)
	const events: InspectorEventMessage[] = []
	client.subscribe(event => events.push(event))
	const memberChanged = () => events.flatMap(event => event.event === 'runtime.memberChanged' ? [event.payload] : [])

	async function refOf(widgetId: string) {
		const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: RUNTIME_ID })
		return { runtimeId: RUNTIME_ID, nodeId: snapshot.nodes.find(node => node.widgetId === widgetId)!.nodeId }
	}

	// A raw peer for requests at an exact envelope version; the in-process transport answers synchronously.
	const responses: InspectorResponseMessage[] = []
	// Events exactly as sent, unparsed.
	const rawEvents: { readonly event: string, readonly protocol: { readonly major: number, readonly minor: number } }[] = []
	pair.client.subscribe((raw) => {
		const response = parseInspectorResponseMessage(raw)
		if (response !== null)
			responses.push(response)
		if (typeof raw === 'object' && raw !== null && (raw as { kind?: unknown }).kind === 'event')
			rawEvents.push(raw as (typeof rawEvents)[number])
	})
	let sequence = 0
	function raw(minor: number, method: string, params: unknown, major: number = INSPECTOR_PROTOCOL_VERSION.major): InspectorResponseMessage {
		const requestId = `raw-${sequence++}`
		pair.client.send({ protocol: { major, minor }, kind: 'request', requestId, method, params })
		return responses.find(response => response.requestId === requestId)!
	}

	const dispose = () => {
		client.dispose()
		agent.dispose()
	}
	return { runtime, probe, pair, agent, client, events, memberChanged, refOf, raw, rawEvents, responses: () => responses, dispose }
}

type Fixture = ReturnType<typeof createFixture>

async function methodMember(fixture: Fixture, name: string) {
	const ref = await fixture.refOf('probe')
	const snapshot = await fixture.client.request('runtime.getWidgetSnapshot', { ref })
	return snapshot.members.find(member => member.type === 'method' && member.name === name)
}

describe('runtime widget snapshot Method members', () => {
	it('lists State, Property then Method members in declaration order, with empty diagnostics before any call', async () => {
		const fixture = createFixture()
		try {
			const ref = await fixture.refOf('probe')
			const snapshot = await fixture.client.request('runtime.getWidgetSnapshot', { ref })
			expect(snapshot.members.map(member => `${member.type}:${member.name}`))
				.toEqual([
					'state:count',
					'property:doubled',
					'method:__proto__',
					'method:constructor',
					'method:check',
					'method:fail',
					'method:strict',
					'method:chain',
					'method:outer',
					'method:explode',
					'method:bump',
				])
			for (const member of snapshot.members.filter(member => member.type === 'method')) {
				expect(member)
					.toEqual({ type: 'method', name: member.name, diagnostics: [] })
			}
		}
		finally {
			fixture.dispose()
		}
	})

	it('projects a Method result diagnostic field by field, with the encoded result', async () => {
		const fixture = createFixture()
		try {
			expect(fixture.probe.methods.check(false).ok)
				.toBe(false)
			expect(await methodMember(fixture, 'check'))
				.toEqual({
					type: 'method',
					name: 'check',
					diagnostics: [{
						code: 'invalid-method-result',
						message: 'bad',
						location: LOCATION('check'),
						path: ['x'],
						reason: 'r',
						result: { type: 'boolean', value: false },
					}],
				})
			// Only the failing Method changes.
			expect(await methodMember(fixture, 'fail'))
				.toEqual({ type: 'method', name: 'fail', diagnostics: [] })
		}
		finally {
			fixture.dispose()
		}
	})

	it('projects an arguments diagnostic with the encoded args', async () => {
		const fixture = createFixture()
		try {
			fixture.probe.methods.strict('not a number' as never)
			expect(await methodMember(fixture, 'strict'))
				.toEqual({
					type: 'method',
					name: 'strict',
					diagnostics: [{
						code: 'invalid-method-arguments',
						message: 'The method arguments failed validation.',
						location: LOCATION('strict'),
						args: [{ type: 'string', value: 'not a number', truncated: false }],
					}],
				})
		}
		finally {
			fixture.dispose()
		}
	})

	it('projects a dependency diagnostic with dependency, related and the nested cause', async () => {
		const fixture = createFixture()
		try {
			expect(fixture.probe.methods.chain().ok)
				.toBe(false)
			const member = await methodMember(fixture, 'chain')
			expect(member)
				.toEqual({
					type: 'method',
					name: 'chain',
					diagnostics: [{
						code: 'dependency-target-failed',
						message: expect.any(String),
						location: LOCATION('chain'),
						dependency: { target: { type: 'self' }, operation: { type: 'method-invoke', name: 'fail' } },
						related: [LOCATION('fail')],
						cause: {
							code: 'invalid-method-result',
							message: 'always fails',
							location: LOCATION('fail'),
							reason: 'always',
							result: { type: 'string', value: 'inner', truncated: false },
						},
					}],
				})
		}
		finally {
			fixture.dispose()
		}
	})

	it('keeps the snapshot a current fact: a later success clears it and a call that throws leaves it unchanged', async () => {
		const fixture = createFixture()
		try {
			fixture.probe.methods.check(false)
			expect(() => fixture.probe.methods.explode())
				.toThrow('explode')
			expect((await methodMember(fixture, 'check'))!)
				.toMatchObject({ diagnostics: [{ code: 'invalid-method-result' }] })
			expect(await methodMember(fixture, 'explode'))
				.toEqual({ type: 'method', name: 'explode', diagnostics: [] })
			fixture.probe.methods.check(true)
			expect(await methodMember(fixture, 'check'))
				.toEqual({ type: 'method', name: 'check', diagnostics: [] })
		}
		finally {
			fixture.dispose()
		}
	})

	it('encodes args and result within valueLimits and marks the truncation', async () => {
		const fixture = createFixture({ valueLimits: { maxStringLength: 5 } })
		try {
			fixture.probe.methods.fail('abcdefghij')
			fixture.probe.methods.strict('abcdefghij' as never)
			expect(await methodMember(fixture, 'fail'))
				.toMatchObject({ diagnostics: [{ result: { type: 'string', value: 'abcde', truncated: true } }] })
			expect(await methodMember(fixture, 'strict'))
				.toMatchObject({ diagnostics: [{ args: [{ type: 'string', value: 'abcde', truncated: true }] }] })
		}
		finally {
			fixture.dispose()
		}
	})

	it('never invokes a Method or writes State while answering snapshot and subscribe requests', async () => {
		executeSpies.check.mockClear()
		executeSpies.bump.mockClear()
		executeSpies.validateStrict.mockClear()
		const fixture = createFixture()
		try {
			const ref = await fixture.refOf('probe')
			const before = fixture.runtime.snapshotState()
			await fixture.client.request('runtime.getWidgetSnapshot', { ref })
			for (const name of ['check', 'strict', 'bump'])
				await fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name } })
			expect(executeSpies.check).not.toHaveBeenCalled()
			expect(executeSpies.bump).not.toHaveBeenCalled()
			expect(executeSpies.validateStrict).not.toHaveBeenCalled()
			expect(fixture.runtime.snapshotState())
				.toEqual(before)
		}
		finally {
			fixture.dispose()
		}
	})

	it('lists no Method member for a widget without Methods', async () => {
		const fixture = createFixture()
		try {
			const snapshot = await fixture.client.request('runtime.getWidgetSnapshot', { ref: await fixture.refOf('plain') })
			expect(snapshot.members)
				.toEqual([])
		}
		finally {
			fixture.dispose()
		}
	})
})

describe('runtime.subscribeMember for a Method', () => {
	it('answers the current snapshot and notifies once per failing call, repeated identical failures included', async () => {
		const fixture = createFixture()
		try {
			const ref = await fixture.refOf('probe')
			fixture.probe.methods.check(false)
			const result = await fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'check' } })
			expect(result.member)
				.toMatchObject({ type: 'method', name: 'check', diagnostics: [{ code: 'invalid-method-result', reason: 'r' }] })
			expect(fixture.memberChanged())
				.toEqual([])

			fixture.probe.methods.check(false)
			fixture.probe.methods.check(false)
			const changes = fixture.memberChanged()
			expect(changes.map(change => change.subscriptionId))
				.toEqual([result.subscriptionId, result.subscriptionId])
			expect(changes[0]!.ref)
				.toEqual(ref)
			expect(changes.map(change => change.member))
				.toEqual([result.member, result.member])
		}
		finally {
			fixture.dispose()
		}
	})

	it('notifies with an empty snapshot on the first success after a failure, and not for a success while clear', async () => {
		const fixture = createFixture()
		try {
			const ref = await fixture.refOf('probe')
			await fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'check' } })
			fixture.probe.methods.check(true)
			expect(fixture.memberChanged())
				.toHaveLength(0)
			fixture.probe.methods.check(false)
			expect(fixture.memberChanged())
				.toHaveLength(1)
			fixture.probe.methods.check(true)
			expect(fixture.memberChanged())
				.toHaveLength(2)
			expect(fixture.memberChanged()[1]!.member)
				.toEqual({ type: 'method', name: 'check', diagnostics: [] })
			fixture.probe.methods.check(true)
			expect(fixture.memberChanged())
				.toHaveLength(2)
		}
		finally {
			fixture.dispose()
		}
	})

	it('delivers only the latest snapshot of changes made inside one Runtime call (a current fact, not a log)', async () => {
		const fixture = createFixture()
		try {
			const ref = await fixture.refOf('probe')
			await fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'check' } })
			// outer() runs check(false) and then check(true) inside one operation: the failure never reaches the peer.
			fixture.probe.methods.outer()
			expect(fixture.memberChanged())
				.toEqual([])
			fixture.probe.methods.check(false)
			fixture.probe.methods.outer()
			expect(fixture.memberChanged()
				.map(change => change.member))
				.toEqual([
					expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'invalid-method-result' })] }),
					{ type: 'method', name: 'check', diagnostics: [] },
				])
		}
		finally {
			fixture.dispose()
		}
	})

	it('answers member-not-found for an unknown Method and for a widget without Methods', async () => {
		const fixture = createFixture()
		try {
			const ref = await fixture.refOf('probe')
			await expect(fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'missing' } }))
				.rejects
				.toMatchObject({ code: 'member-not-found' })
			// A State key is not a Method name.
			await expect(fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'count' } }))
				.rejects
				.toMatchObject({ code: 'member-not-found' })
			await expect(fixture.client.request('runtime.subscribeMember', { ref: await fixture.refOf('plain'), member: { type: 'method', name: 'check' } }))
				.rejects
				.toMatchObject({ code: 'member-not-found' })
			// Names that exist on every object prototype are not Methods unless declared; `__proto__` and `constructor` are declared here.
			await expect(fixture.client.request('runtime.subscribeMember', { ref: await fixture.refOf('plain'), member: { type: 'method', name: 'constructor' } }))
				.rejects
				.toMatchObject({ code: 'member-not-found' })
			await expect(fixture.client.request('runtime.subscribeMember', { ref: await fixture.refOf('plain'), member: { type: 'method', name: 'toString' } }))
				.rejects
				.toMatchObject({ code: 'member-not-found' })
		}
		finally {
			fixture.dispose()
		}
	})

	it('subscribes to Methods named __proto__ and constructor', async () => {
		const fixture = createFixture()
		try {
			const ref = await fixture.refOf('probe')
			for (const name of ['__proto__', 'constructor']) {
				const result = await fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name } })
				expect(result.member)
					.toEqual({ type: 'method', name, diagnostics: [] })
			}
		}
		finally {
			fixture.dispose()
		}
	})

	it('counts Method subscriptions against maxSubscriptions', async () => {
		const fixture = createFixture({ maxSubscriptions: 2 })
		try {
			const ref = await fixture.refOf('probe')
			await fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'check' } })
			const second = await fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'fail' } })
			await expect(fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'strict' } }))
				.rejects
				.toMatchObject({ code: 'subscription-limit' })
			await expect(fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'state', name: 'count' } }))
				.rejects
				.toMatchObject({ code: 'subscription-limit' })
			expect(await fixture.client.request('runtime.unsubscribeMember', { subscriptionId: second.subscriptionId }))
				.toEqual({ removed: true })
			await fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'strict' } })
		}
		finally {
			fixture.dispose()
		}
	})

	it('releases the Core subscription on unsubscribe, Agent disposal, transport close and Runtime disposal', async () => {
		// Unsubscribe.
		const first = createFixture()
		try {
			const ref = await first.refOf('probe')
			const { subscriptionId } = await first.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'check' } })
			first.probe.methods.check(false)
			expect(first.memberChanged())
				.toHaveLength(1)
			await first.client.request('runtime.unsubscribeMember', { subscriptionId })
			first.probe.methods.check(true)
			first.probe.methods.check(false)
			expect(first.memberChanged())
				.toHaveLength(1)
		}
		finally {
			first.dispose()
		}

		// Agent disposal and transport close: no further sends, and the Runtime keeps working.
		for (const how of ['agent', 'transport'] as const) {
			const fixture = createFixture()
			const ref = await fixture.refOf('probe')
			await fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'check' } })
			const sent = vi.spyOn(fixture.pair.agent, 'send')
			if (how === 'agent')
				fixture.agent.dispose()
			else
				fixture.pair.client.close()
			sent.mockClear()
			expect(fixture.probe.methods.check(false).ok)
				.toBe(false)
			expect(sent).not.toHaveBeenCalled()
			fixture.dispose()
		}

		// Runtime disposal: the peer is told, later requests answer runtime-disposed, nothing throws.
		const disposed = createFixture()
		try {
			const ref = await disposed.refOf('probe')
			await disposed.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'check' } })
			disposed.runtime.dispose()
			await expect(disposed.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'check' } }))
				.rejects
				.toMatchObject({ code: 'runtime-disposed' })
			await expect(disposed.client.request('runtime.getWidgetSnapshot', { ref }))
				.rejects
				.toMatchObject({ code: 'runtime-disposed' })
		}
		finally {
			disposed.dispose()
		}
	})
})

describe('method members and the protocol major', () => {
	it('answers a 0.5 peer unsupported-version to the handshake and to Method requests, at the Agent\'s own version', async () => {
		const fixture = createFixture()
		try {
			const ref = await fixture.refOf('probe')
			for (const [method, params] of [
				['handshake', { protocol: { major: 0, minor: 5 } }],
				['runtime.getWidgetSnapshot', { ref }],
				['runtime.subscribeMember', { ref, member: { type: 'method', name: 'check' } }],
			] as const) {
				const answer = fixture.raw(5, method, params, 0)
				expect(answer)
					.toEqual({
						protocol: INSPECTOR_PROTOCOL_VERSION,
						kind: 'response',
						requestId: answer.requestId,
						ok: false,
						error: { code: 'unsupported-version', message: 'Unsupported Inspector protocol major 0.' },
					})
			}
			// The handshake params alone carrying the older major is refused too.
			expect(fixture.raw(0, 'handshake', { protocol: { major: 0, minor: 5 } }))
				.toMatchObject({ ok: false, error: { code: 'unsupported-version', message: 'Unsupported Inspector protocol major 0.' } })
		}
		finally {
			fixture.dispose()
		}
	})

	it('answers a request rejected while it is classified at the request\'s envelope version when the major matches', async () => {
		const fixture = createFixture()
		try {
			const ref = await fixture.refOf('probe')
			expect(fixture.raw(0, 'runtime.subscribeMember', { ref, member: { type: 'bogus', name: 'x' } }))
				.toMatchObject({ ok: false, protocol: INSPECTOR_PROTOCOL_VERSION, error: { code: 'invalid-params' } })
			expect(fixture.raw(0, 'runtime.noSuchMethod', {}))
				.toMatchObject({ ok: false, protocol: INSPECTOR_PROTOCOL_VERSION, error: { code: 'unknown-method' } })
			// An invalid message whose envelope still carries a valid version (the method is not a string).
			expect(fixture.raw(0, 1 as unknown as string, {}))
				.toMatchObject({ ok: false, protocol: INSPECTOR_PROTOCOL_VERSION, error: { code: 'invalid-message' } })
			// An incompatible major is answered at the Agent's own version, whatever minor it names.
			fixture.pair.client.send({ protocol: { major: 9, minor: 0 }, kind: 'request', requestId: 'major-9', method: 'runtime.list', params: {} })
			expect(fixture.responses()
				.find(response => response.requestId === 'major-9'))
				.toMatchObject({ ok: false, protocol: INSPECTOR_PROTOCOL_VERSION, error: { code: 'unsupported-version' } })
			// A newer minor of the same major is answered at this Agent's minor.
			expect(fixture.raw(4, 'runtime.list', {}))
				.toMatchObject({ ok: true, protocol: INSPECTOR_PROTOCOL_VERSION })
		}
		finally {
			fixture.dispose()
		}
	})

	it('answers a peer addressing a stale Runtime, an unknown node or a disposed Runtime with the ordinary codes', async () => {
		const fixture = createFixture()
		try {
			const widget = await fixture.refOf('probe')
			expect(fixture.raw(0, 'runtime.subscribeMember', { ref: { runtimeId: 'gone', nodeId: widget.nodeId }, member: { type: 'method', name: 'check' } }))
				.toMatchObject({ ok: false, error: { code: 'runtime-not-found' } })
			expect(fixture.raw(0, 'runtime.subscribeMember', { ref: { runtimeId: widget.runtimeId, nodeId: 999 }, member: { type: 'method', name: 'check' } }))
				.toMatchObject({ ok: false, error: { code: 'widget-not-found' } })
			expect(fixture.raw(0, 'runtime.subscribeMember', { ref: widget, member: { type: 'method', name: 'missing' } }))
				.toMatchObject({ ok: false, error: { code: 'member-not-found' } })
			fixture.runtime.dispose()
			expect(fixture.raw(0, 'runtime.subscribeMember', { ref: widget, member: { type: 'method', name: 'check' } }))
				.toMatchObject({ ok: false, error: { code: 'runtime-disposed' } })
		}
		finally {
			fixture.dispose()
		}
	})

	it('sends one Method memberChanged per change after a re-handshake, at the negotiated version', async () => {
		const fixture = createFixture()
		try {
			const ref = await fixture.refOf('probe')
			expect(fixture.raw(0, 'handshake', { protocol: INSPECTOR_PROTOCOL_VERSION }))
				.toMatchObject({ ok: true })
			expect(fixture.raw(0, 'runtime.subscribeMember', { ref, member: { type: 'method', name: 'check' } }))
				.toMatchObject({ ok: true })
			fixture.probe.methods.check(false)
			fixture.raw(0, 'handshake', { protocol: INSPECTOR_PROTOCOL_VERSION })
			fixture.probe.methods.check(true)
			fixture.probe.methods.check(false)
			const changes = fixture.rawEvents.filter(event => event.event === 'runtime.memberChanged')
			expect(changes)
				.toHaveLength(3)
			for (const change of changes) {
				expect(change.protocol)
					.toEqual(INSPECTOR_PROTOCOL_VERSION)
			}
		}
		finally {
			fixture.dispose()
		}
	})
})
