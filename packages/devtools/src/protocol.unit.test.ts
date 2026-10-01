import { describe, expect, it } from 'vitest'
import {
	INSPECTOR_PROTOCOL_VERSION,
	isCompatibleProtocolVersion,
	isInspectorRequestResult,
	parseInspectorEventMessage,
	parseInspectorRequestMessage,
	parseInspectorResponseMessage,
} from './protocol'

describe('inspector protocol validation', () => {
	it('accepts a valid typed request and rejects malformed parameters', () => {
		const valid = {
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'request',
			requestId: 'r1',
			method: 'runtime.getWidgetSnapshot',
			params: { ref: { runtimeId: 'runtime-a', nodeId: 2 } },
		}
		expect(parseInspectorRequestMessage(valid))
			.toEqual(valid)
		expect(parseInspectorRequestMessage({ ...valid, params: { ref: { runtimeId: 1, nodeId: '2' } } }))
			.toBeNull()
		expect(parseInspectorRequestMessage({ ...valid, method: 'method.invoke' }))
			.toBeNull()
	})

	it('validates response envelopes before request correlation', () => {
		const success = {
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: 'r1',
			ok: true,
			result: { anything: 'is method-validated by the client later' },
		}
		expect(parseInspectorResponseMessage(success))
			.toEqual(success)
		expect(parseInspectorResponseMessage({ ...success, ok: false, error: null }))
			.toBeNull()
	})

	it('rejects cyclic InspectableValue event payloads without throwing while allowing acyclic sharing', () => {
		const cyclic: Record<string, unknown> = {
			type: 'object',
			id: 1,
			entries: [],
			truncated: false,
		}
		;(cyclic.entries as Array<Record<string, unknown>>).push({ key: 'self', value: cyclic })
		const cyclicEvent = {
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'event',
			event: 'runtime.eventOccurred',
			payload: {
				subscriptionId: 'event-1',
				ref: { runtimeId: 'runtime-a', nodeId: 1 },
				event: 'changed',
				args: [cyclic],
			},
		}

		expect(() => parseInspectorEventMessage(cyclicEvent))
			.not.toThrow()
		expect(parseInspectorEventMessage(cyclicEvent))
			.toBeNull()

		const shared = {
			type: 'object',
			id: 2,
			entries: [{ key: 'value', value: { type: 'number', value: 1 } }],
			truncated: false,
		}
		const sharedEvent = {
			...cyclicEvent,
			payload: {
				...cyclicEvent.payload,
				args: [{
					type: 'object',
					id: 3,
					entries: [
						{ key: 'left', value: shared },
						{ key: 'right', value: shared },
					],
					truncated: false,
				}],
			},
		}

		expect(parseInspectorEventMessage(sharedEvent))
			.toBe(sharedEvent)
	})

	it('handles deeply nested InspectableValue payloads without recursion overflow or receive-side depth ceilings', () => {
		const root: Record<string, unknown> = {
			type: 'array',
			id: 1,
			items: [],
			truncated: false,
		}
		let cursor = root
		for (let id = 2; id <= 20_000; id++) {
			const next: Record<string, unknown> = {
				type: 'array',
				id,
				items: [],
				truncated: false,
			}
			;(cursor.items as unknown[]).push(next)
			cursor = next
		}
		;(cursor.items as unknown[]).push({ type: 'number', value: 1 })

		const event = {
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'event',
			event: 'runtime.eventOccurred',
			payload: {
				subscriptionId: 'event-deep',
				ref: { runtimeId: 'runtime-a', nodeId: 1 },
				event: 'changed',
				args: [root],
			},
		}

		let parsed: ReturnType<typeof parseInspectorEventMessage> | undefined
		expect(() => {
			parsed = parseInspectorEventMessage(event)
		})
			.not.toThrow()
		expect(parsed)
			.toBe(event)

		;(cursor.items as unknown[])[0] = root
		parsed = undefined
		expect(() => {
			parsed = parseInspectorEventMessage(event)
		})
			.not.toThrow()
		expect(parsed)
			.toBeNull()
	})

	it('short-circuits wide InspectableValue containers before reading later siblings', () => {
		const siblingWidth = 100_000
		for (const containerType of ['array', 'object'] as const) {
			let siblingReads = 0
			const children = new Proxy([] as unknown[], {
				get(target, property, receiver) {
					if (property === 'length')
						return siblingWidth
					if (typeof property === 'string' && /^\d+$/.test(property)) {
						siblingReads++
						const value = property === '0' ? { type: 'invalid' } : { type: 'null' }
						return containerType === 'array' ? value : { key: property, value }
					}
					return Reflect.get(target, property, receiver)
				},
				has(_target, property) {
					return typeof property === 'string' && /^\d+$/.test(property)
				},
			})
			const value = containerType === 'array'
				? { type: 'array', id: 1, items: children, truncated: false }
				: { type: 'object', id: 1, entries: children, truncated: false }
			const event = {
				protocol: INSPECTOR_PROTOCOL_VERSION,
				kind: 'event',
				event: 'runtime.eventOccurred',
				payload: {
					subscriptionId: `event-wide-invalid-${containerType}`,
					ref: { runtimeId: 'runtime-a', nodeId: 1 },
					event: 'changed',
					args: [value],
				},
			}

			expect(parseInspectorEventMessage(event))
				.toBeNull()
			expect(siblingReads)
				.toBe(1)
		}
	})

	it('rejects InspectableValue arrays with invalid proxy lengths without iterating indexes', () => {
		for (const invalidLength of [0.5, Number.POSITIVE_INFINITY]) {
			for (const containerType of ['array', 'object'] as const) {
				let indexReads = 0
				const children = new Proxy([] as unknown[], {
					get(target, property, receiver) {
						if (property === 'length')
							return invalidLength
						if (typeof property === 'string' && /^\d+$/.test(property)) {
							indexReads++
							if (indexReads > 3)
								throw new Error('Validator continued iterating an invalid array length.')
							const value = { type: 'null' }
							return containerType === 'array' ? value : { key: property, value }
						}
						return Reflect.get(target, property, receiver)
					},
					has(_target, property) {
						return typeof property === 'string' && /^\d+$/.test(property)
					},
				})
				const value = containerType === 'array'
					? { type: 'array', id: 1, items: children, truncated: false }
					: { type: 'object', id: 1, entries: children, truncated: false }
				const event = {
					protocol: INSPECTOR_PROTOCOL_VERSION,
					kind: 'event',
					event: 'runtime.eventOccurred',
					payload: {
						subscriptionId: `event-invalid-length-${containerType}`,
						ref: { runtimeId: 'runtime-a', nodeId: 1 },
						event: 'changed',
						args: [value],
					},
				}

				let parsed: ReturnType<typeof parseInspectorEventMessage> | undefined
				expect(() => {
					parsed = parseInspectorEventMessage(event)
				})
					.not.toThrow()
				expect(parsed)
					.toBeNull()
				expect(indexReads)
					.toBe(0)
			}
		}
	})

	it('preserves sparse InspectableValue array hole semantics', () => {
		for (const containerType of ['array', 'object'] as const) {
			const children: unknown[] = []
			children.length = 2
			children[1] = containerType === 'array'
				? { type: 'null' }
				: { key: 'present', value: { type: 'null' } }
			const value = containerType === 'array'
				? { type: 'array', id: 1, items: children, truncated: false }
				: { type: 'object', id: 1, entries: children, truncated: false }
			const event = {
				protocol: INSPECTOR_PROTOCOL_VERSION,
				kind: 'event',
				event: 'runtime.eventOccurred',
				payload: {
					subscriptionId: `event-sparse-${containerType}`,
					ref: { runtimeId: 'runtime-a', nodeId: 1 },
					event: 'changed',
					args: [value],
				},
			}

			expect(parseInspectorEventMessage(event))
				.toBe(event)
		}
	})

	it('uses major-version compatibility while allowing minor-version capability negotiation', () => {
		expect(isCompatibleProtocolVersion({ major: INSPECTOR_PROTOCOL_VERSION.major, minor: 999 }))
			.toBe(true)
		expect(isCompatibleProtocolVersion({ major: INSPECTOR_PROTOCOL_VERSION.major + 1, minor: 0 }))
			.toBe(false)
	})
})

describe('deep wire DTO validation', () => {
	it('rejects malformed nested Blueprint members, diagnostics, and cycles', () => {
		const base = {
			runtimeId: 'runtime-a',
			rootNodeId: 1,
			nodes: [{
				nodeId: 1,
				resolved: true,
				widgetId: 'root',
				widgetType: 'fixture',
				capabilities: { config: false, slots: false, state: false, properties: false, methods: false, events: false },
				config: null,
				sourceSlots: [],
				semanticSlots: [],
				state: [],
				properties: [],
				methods: [],
				events: [],
				diagnostics: [],
			}],
			invalidCycles: [],
		}
		expect(isInspectorRequestResult('blueprint.getSnapshot', base))
			.toBe(true)

		const legacy = structuredClone(base)
		Reflect.deleteProperty(legacy.nodes[0]!, 'config')
		Reflect.deleteProperty(legacy.nodes[0]!, 'events')
		Reflect.deleteProperty(legacy.nodes[0]!.capabilities, 'events')
		expect(isInspectorRequestResult('blueprint.getSnapshot', legacy, 1))
			.toBe(true)
		expect(isInspectorRequestResult('blueprint.getSnapshot', legacy, INSPECTOR_PROTOCOL_VERSION.minor))
			.toBe(false)

		expect(isInspectorRequestResult('blueprint.getSnapshot', {
			...base,
			nodes: [{ ...base.nodes[0], properties: [{ type: 'property', name: 'x', dependencies: [{ status: 'resolved', path: [], reference: {}, target: {} }] }] }],
		}))
			.toBe(false)
		expect(isInspectorRequestResult('blueprint.getSnapshot', {
			...base,
			nodes: [{ ...base.nodes[0], diagnostics: [{ code: 'x', message: 'bad', location: { type: 'widget', nodeId: 'not-a-node-id' } }] }],
		}))
			.toBe(false)
		expect(isInspectorRequestResult('blueprint.getSnapshot', {
			...base,
			invalidCycles: [{ members: [{ nodeId: 1, member: { type: 'state', name: 'not-valid-in-cycle' } }] }],
		}))
			.toBe(false)
	})

	it('rejects cyclic RuntimeDiagnostic cause chains without throwing', () => {
		const diagnostic: Record<string, unknown> = {
			code: 'dependency-target-failed',
			message: 'Dependency failed.',
			location: { type: 'property', widgetId: 'root', name: 'value' },
		}
		diagnostic.cause = diagnostic
		const event = {
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'event',
			event: 'runtime.memberChanged',
			payload: {
				subscriptionId: 'member-1',
				ref: { runtimeId: 'runtime-a', nodeId: 1 },
				member: {
					type: 'property',
					name: 'value',
					snapshot: {
						status: 'completed',
						result: { ok: false, diagnostics: [diagnostic] },
					},
				},
			},
		}

		let parsed: ReturnType<typeof parseInspectorEventMessage> | undefined
		expect(() => {
			parsed = parseInspectorEventMessage(event)
		})
			.not.toThrow()
		expect(parsed)
			.toBeNull()
	})

	it('accepts deep acyclic and shared RuntimeDiagnostic cause objects', () => {
		const leaf = {
			code: 'leaf',
			message: 'Leaf diagnostic.',
			location: { type: 'property', widgetId: 'root', name: 'value' },
		}
		const first = {
			code: 'first',
			message: 'First diagnostic.',
			location: { type: 'property', widgetId: 'root', name: 'value' },
			cause: leaf,
		}
		const second = {
			code: 'second',
			message: 'Second diagnostic.',
			location: { type: 'property', widgetId: 'root', name: 'value' },
			cause: leaf,
		}
		const eventFor = (diagnostics: readonly unknown[]) => ({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'event',
			event: 'runtime.memberChanged',
			payload: {
				subscriptionId: 'member-shared',
				ref: { runtimeId: 'runtime-a', nodeId: 1 },
				member: {
					type: 'property',
					name: 'value',
					snapshot: {
						status: 'completed',
						result: { ok: false, diagnostics },
					},
				},
			},
		})

		const sharedEvent = eventFor([first, second])
		expect(parseInspectorEventMessage(sharedEvent))
			.toBe(sharedEvent)

		const deepRoot: Record<string, unknown> = {
			code: 'deep-0',
			message: 'Deep diagnostic.',
			location: { type: 'property', widgetId: 'root', name: 'value' },
		}
		let cursor = deepRoot
		for (let index = 1; index <= 20_000; index++) {
			const next: Record<string, unknown> = {
				code: `deep-${index}`,
				message: 'Deep diagnostic.',
				location: { type: 'property', widgetId: 'root', name: 'value' },
			}
			cursor.cause = next
			cursor = next
		}
		const deepEvent = eventFor([deepRoot])
		expect(() => parseInspectorEventMessage(deepEvent))
			.not.toThrow()
		expect(parseInspectorEventMessage(deepEvent))
			.toBe(deepEvent)
	})

	it('rejects unknown handshake events, unknown error codes, and malformed failed Runtime diagnostics', () => {
		expect(isInspectorRequestResult('handshake', {
			protocol: INSPECTOR_PROTOCOL_VERSION,
			capabilities: { methods: ['runtime.list'], events: ['not-a-real-event'] },
		}))
			.toBe(false)
		expect(parseInspectorResponseMessage({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: 'r1',
			ok: false,
			error: { code: 'arbitrary-error', message: 'nope' },
		}))
			.toBeNull()
		expect(isInspectorRequestResult('runtime.getWidgetSnapshot', {
			ref: { runtimeId: 'runtime-a', nodeId: 1 },
			widgetId: 'root',
			widgetType: 'fixture',
			members: [{
				type: 'property',
				name: 'value',
				snapshot: { status: 'completed', result: { ok: false, diagnostics: [{ code: 'bad' }] } },
			}],
		}))
			.toBe(false)
	})
})
