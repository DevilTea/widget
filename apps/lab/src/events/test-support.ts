/**
 * Unit-test fixture for the Events log: a real Core Runtime (a plugin that declares and emits Events) behind a real
 * Inspector Agent, reached through the in-process transport, so the log is tested against the real protocol and the
 * real payload encoding rather than against hand-written DTOs.
 */
import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { InspectorClient } from '@deviltea/widget-inspector/client'
import type { InspectorBlueprintSnapshot } from '@deviltea/widget-inspector/protocol'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { createInspectorAgent } from '@deviltea/widget-inspector/agent'
import { createInspectorClient } from '@deviltea/widget-inspector/client'
import { createInProcessInspectorTransportPair } from '@deviltea/widget-inspector/transport'

interface NotifierInterfaces extends WidgetInterfaces {
	slots: 'children'
	methods: {
		fire: (value: number) => void
		ping: () => void
	}
	events: {
		changed: [payload: { value: number, label: string }]
		pinged: []
	}
}

export const NotifierPlugin = createWidgetPlugin('Notifier')
	.description('Event log fixture')
	.interfaces<NotifierInterfaces>()
	.slots({ children: { description: 'Nested notifiers' } })
	.methods(methods => methods
		.fire({
			validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
			emits: ['changed'],
			execute: ({ args: [value], emit }) => {
				emit.changed({ value, label: 'x'.repeat(value) })
			},
		})
		.ping({
			validateArgs: (args): args is [] => args.length === 0,
			emits: ['pinged'],
			execute: ({ emit }) => {
				emit.pinged()
			},
		}))
	.events(events => events
		.changed({ description: 'The value changed.' })
		.pinged({ description: 'Pinged.' }))
	.done()

export const PlainPlugin = createWidgetPlugin('Plain')
	.description('No events')
	.interfaces<WidgetInterfaces>()
	.done()

export interface Preview {
	readonly connection: {
		readonly runtimeId: string
		readonly revision: number
		readonly blueprint: InspectorBlueprintSnapshot
		readonly inspectorClient: InspectorClient
	}
	/** Emits `changed` with `{ value, label: 'x' * value }` from `widgetId` (default the root, `notifier`). */
	readonly fire: (value: number, widgetId?: string) => void
	/** Emits `pinged` with no payload from `widgetId` (default the root). */
	readonly ping: (widgetId?: string) => void
	/** Subscriptions the Agent currently holds for this Preview: subscribes answered minus unsubscribes. */
	readonly active: Set<string>
	/** Every request method the client sent, in order. */
	readonly requests: string[]
	/** Delays every `runtime.subscribeEvent` answer until `release()`. */
	readonly gate: { hold: boolean, release: () => void }
	dispose: () => void
}

const disposers: (() => void)[] = []

export function disposePreviews(): void {
	for (const dispose of disposers.splice(0))
		dispose()
}

/** A real Core Runtime behind a real Inspector Agent; `plain`: its only widget declares no Events; `nested`: a second Notifier, `inner`, in the root's slot. */
export async function createPreview(revision: number, options: { plain?: boolean, nested?: boolean } = {}): Promise<Preview> {
	const system = createWidgetSystem({ plugins: [NotifierPlugin, PlainPlugin] })
	const blueprint = system.createBlueprint(options.plain === true
		? { id: 'only', type: 'Plain' }
		: { id: 'notifier', type: 'Notifier', ...(options.nested === true ? { slots: { children: [{ id: 'inner', type: 'Notifier' }] } } : {}) })
	if (blueprint.status !== 'valid')
		throw new Error('Expected the fixture to compile.')
	const runtime = blueprint.createRuntime()
	const widgetOf = (id: string) => (runtime.getWidget(id) as unknown as { methods: { fire: (n: number) => void, ping: () => void } }).methods
	const runtimeId = `runtime-r${revision}`
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId })
	const client = createInspectorClient(pair.client)
	const snapshot = await client.request('blueprint.getSnapshot', { runtimeId })

	const active = new Set<string>()
	const requests: string[] = []
	const gate = { hold: false, release: () => {} }
	const tracked: InspectorClient = {
		...client,
		request: (async (method: string, params: unknown) => {
			requests.push(method)
			if (method === 'runtime.subscribeEvent' && gate.hold) {
				await new Promise<void>((resolve) => {
					gate.release = resolve
				})
			}
			const result = await (client.request as (m: string, p: unknown) => Promise<unknown>)(method, params)
			if (method === 'runtime.subscribeEvent')
				active.add((result as { subscriptionId: string }).subscriptionId)
			if (method === 'runtime.unsubscribeEvent')
				active.delete((params as { subscriptionId: string }).subscriptionId)
			return result
		}) as InspectorClient['request'],
	}
	const dispose = (): void => {
		client.dispose()
		agent.dispose()
	}
	disposers.push(dispose)
	return {
		connection: { runtimeId, revision, blueprint: snapshot, inspectorClient: tracked },
		fire: (value: number, widgetId = 'notifier') => widgetOf(widgetId)
			.fire(value),
		ping: (widgetId = 'notifier') => widgetOf(widgetId)
			.ping(),
		active,
		requests,
		gate,
		dispose,
	}
}
