/**
 * Unit-test fixture for the Events log: a real Core Runtime (a plugin that declares and emits Events) behind a real
 * Inspector Agent, reached through the in-process transport, so the log is tested against the real protocol and the
 * real payload encoding rather than against hand-written DTOs.
 */
import type { WidgetChild, WidgetInterfaces } from '@deviltea/widget-core'
import type { InspectorClient } from '@deviltea/widget-inspector/client'
import type { InspectorBlueprintSnapshot } from '@deviltea/widget-inspector/protocol'
import type { ShowcaseEntry } from '../showcases/registry'
import { createWidgetPlugin, createWidgetSystem, undocumented } from '@deviltea/widget-core'
import { createInspectorAgent } from '@deviltea/widget-inspector/agent'
import { createInspectorClient } from '@deviltea/widget-inspector/client'
import { createInProcessInspectorTransportPair } from '@deviltea/widget-inspector/transport'

/** Event log fixture. */
interface NotifierInterfaces extends WidgetInterfaces {
	slots: {
		/** Nested notifiers. */
		children: WidgetChild
	}
	methods: {
		fire: (value: number) => void
		ping: () => void
		check: (ok: boolean) => boolean
	}
	events: {
		/** The value changed. */
		changed: [payload: { value: number, label: string }]
		/** Pinged. */
		pinged: []
	}
}

export const NotifierPlugin = createWidgetPlugin('Notifier')
	.description(undocumented)
	.interfaces<NotifierInterfaces>()
	.slots({ children: { description: undocumented } })
	.methods(methods => methods
		.fire({
			description: undocumented,
			validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
			emits: ['changed'],
			execute: ({ args: [value], emit }) => {
				emit.changed({ value, label: 'x'.repeat(value) })
			},
		})
		.ping({
			description: undocumented,
			validateArgs: (args): args is [] => args.length === 0,
			emits: ['pinged'],
			execute: ({ emit }) => {
				emit.pinged()
			},
		})
		.check({
			description: undocumented,
			validateArgs: (args): args is [boolean] => args.length === 1 && typeof args[0] === 'boolean',
			execute: ({ args: [ok], addDiagnostic }) => {
				if (!ok)
					addDiagnostic({ message: 'The check failed.', reason: 'not-ok' })
				return ok
			},
		}))
	.events({ changed: undocumented, pinged: undocumented })
	.done()

/** Declares Methods but no Events: the log has nothing to listen to except Method failures. */
interface CheckerInterfaces extends WidgetInterfaces {
	methods: {
		check: (ok: boolean) => boolean
	}
}

export const CheckerPlugin = createWidgetPlugin('Checker')
	.description(undocumented)
	.interfaces<CheckerInterfaces>()
	.methods(methods => methods
		.check({
			description: undocumented,
			validateArgs: (args): args is [boolean] => args.length === 1 && typeof args[0] === 'boolean',
			execute: ({ args: [ok], addDiagnostic }) => {
				if (!ok)
					addDiagnostic({ message: 'The check failed.', reason: 'not-ok' })
				return ok
			},
		}))
	.done()

export const PlainPlugin = createWidgetPlugin('Plain')
	.description(undocumented)
	.interfaces<WidgetInterfaces>()
	.done()

/** The prose fields of a documented member, the way `widgetDocs({ slim: true })` emits them. */
function docText(summary: string) {
	return { summary, remarks: '' }
}

/**
 * A stand-in showcase for the fixture plugins, for views that read the documentation of the current showcase
 * (`getShowcase(showcaseId).docs`): its `docs` is what `widgetDocs({ slim: true })` would generate for documented plugins of this shape. A
 * test swaps it in with `vi.mock('…/showcases/registry')` and selects it by `id`.
 */
export const eventsFixtureShowcase = {
	id: 'events-fixture',
	sources: {},
	configSchemas: {},
	docs: {
		docsVersion: 2,
		system: 'eventsFixtureSystem',
		plugins: {
			Notifier: {
				...docText('Event log fixture.'),
				slots: { children: docText('Nested notifiers.') },
				events: { changed: docText('The value changed.'), pinged: docText('Pinged.') },
			},
		},
	},
} as unknown as ShowcaseEntry

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
	/** Calls `check(ok)` on `widgetId` (default the root): `check(false)` returns with an `invalid-method-result` diagnostic (`reason: 'not-ok'`). */
	readonly check: (ok: boolean, widgetId?: string) => void
	/** Method subscriptions the Agent currently holds for this Preview: subscribeMember answered minus unsubscribeMember. */
	readonly activeMembers: Set<string>
	/** Subscriptions the Agent currently holds for this Preview: subscribes answered minus unsubscribes. */
	readonly active: Set<string>
	/** Every request method the client sent, in order. */
	readonly requests: string[]
	/** Delays every `runtime.subscribeEvent` answer until `release()`, which lets all the delayed ones through. */
	readonly gate: { hold: boolean, readonly pending: (() => void)[], release: () => void }
	/** Disposes this Preview's Agent only; the client (shared or not) stays open. */
	disposeAgent: () => void
	dispose: () => void
}

const disposers: (() => void)[] = []

export function disposePreviews(): void {
	for (const dispose of disposers.splice(0))
		dispose()
}

/** One Inspector client and transport that several Previews' Agents take turns on, as the browser's frame does across an Apply. */
export interface PreviewLink {
	readonly pair: ReturnType<typeof createInProcessInspectorTransportPair>
	readonly client: InspectorClient
}

export function createPreviewLink(): PreviewLink {
	const pair = createInProcessInspectorTransportPair()
	const client = createInspectorClient(pair.client)
	disposers.push(() => client.dispose())
	return { pair, client }
}

/**
 * A real Core Runtime behind a real Inspector Agent. `plain`: its only widget declares no Events; `nested`: a second
 * Notifier, `inner`, in the root's slot; `link`: reuse that client and transport instead of making new ones (dispose the
 * previous Preview's Agent first: one Agent per transport per Runtime).
 */
export async function createPreview(revision: number, options: { plain?: boolean, methodsOnly?: boolean, nested?: boolean, link?: PreviewLink } = {}): Promise<Preview> {
	const system = createWidgetSystem({ plugins: [NotifierPlugin, PlainPlugin, CheckerPlugin] })
	const blueprint = system.createBlueprint(options.plain === true
		? { id: 'only', type: 'Plain' }
		: options.methodsOnly === true
			? { id: 'checker', type: 'Checker' }
			: { id: 'notifier', type: 'Notifier', ...(options.nested === true ? { slots: { children: [{ id: 'inner', type: 'Notifier' }] } } : {}) })
	if (blueprint.status !== 'valid')
		throw new Error('Expected the fixture to compile.')
	const runtime = blueprint.createRuntime()
	const widgetOf = (id: string) => (runtime.getWidget(id) as unknown as { methods: { fire: (n: number) => void, ping: () => void, check: (ok: boolean) => boolean } }).methods
	const runtimeId = `runtime-r${revision}`
	const link = options.link ?? createPreviewLink()
	// With a shared link the transport outlives the Agent, as the Preview frame's channel does across an Apply.
	const agent = createInspectorAgent({ runtime, transport: link.pair.agent, runtimeId, closeTransportOnDispose: options.link === undefined })
	const client = link.client
	const snapshot = await client.request('blueprint.getSnapshot', { runtimeId })

	const active = new Set<string>()
	const activeMembers = new Set<string>()
	const requests: string[] = []
	const gate = {
		hold: false,
		pending: [] as (() => void)[],
		release: () => {
			for (const resolve of gate.pending.splice(0))
				resolve()
		},
	}
	const tracked: InspectorClient = {
		...client,
		request: (async (method: string, params: unknown) => {
			requests.push(method)
			if (method === 'runtime.subscribeEvent' && gate.hold) {
				await new Promise<void>((resolve) => {
					gate.pending.push(resolve)
				})
			}
			const result = await (client.request as (m: string, p: unknown) => Promise<unknown>)(method, params)
			if (method === 'runtime.subscribeEvent')
				active.add((result as { subscriptionId: string }).subscriptionId)
			if (method === 'runtime.unsubscribeEvent')
				active.delete((params as { subscriptionId: string }).subscriptionId)
			if (method === 'runtime.subscribeMember' && (params as { member: { type: string } }).member.type === 'method')
				activeMembers.add((result as { subscriptionId: string }).subscriptionId)
			if (method === 'runtime.unsubscribeMember')
				activeMembers.delete((params as { subscriptionId: string }).subscriptionId)
			return result
		}) as InspectorClient['request'],
	}
	disposers.push(() => agent.dispose())
	return {
		connection: { runtimeId, revision, blueprint: snapshot, inspectorClient: tracked },
		fire: (value: number, widgetId = 'notifier') => widgetOf(widgetId)
			.fire(value),
		ping: (widgetId = 'notifier') => widgetOf(widgetId)
			.ping(),
		check: (ok: boolean, widgetId = 'notifier') => {
			widgetOf(widgetId)
				.check(ok)
		},
		active,
		activeMembers,
		requests,
		gate,
		disposeAgent: () => agent.dispose(),
		dispose: () => agent.dispose(),
	}
}
