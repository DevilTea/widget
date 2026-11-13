// @vitest-environment happy-dom
import type { InspectorClient } from './client'
import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { createInspectorTestFixture, devtoolsTestSystem } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

const RUNTIME_ID = 'runtime-lookup'

function createLargeRuntime(count: number) {
	const blueprint = devtoolsTestSystem.createBlueprint({
		id: 'root',
		type: 'DevtoolsRoot',
		slots: {
			body: Array.from({ length: count }, (_, index) => ({ id: `counter-${index}`, type: 'DevtoolsCounter' })),
		},
	})
	if (blueprint.status !== 'valid')
		throw new Error('Expected a valid large Blueprint.')
	return blueprint.createRuntime()
}

async function failureCode(pending: Promise<unknown>): Promise<unknown> {
	try {
		await pending
	}
	catch (error) {
		return (error as { protocolError?: { code?: string } }).protocolError?.code
	}
	return 'resolved'
}

function connect(runtime: ReturnType<typeof createInspectorTestFixture>['runtime'], dom?: { root: HTMLElement }) {
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: RUNTIME_ID, ...(dom === undefined ? {} : { dom }) })
	const client: InspectorClient = createInspectorClient(pair.client)
	return { agent, client }
}

async function lastNodeIdOf(runtime: ReturnType<typeof createInspectorTestFixture>['runtime']): Promise<number> {
	const { agent, client } = connect(runtime)
	try {
		const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: RUNTIME_ID })
		return snapshot.nodes[snapshot.nodes.length - 1]!.nodeId
	}
	finally {
		client.dispose()
		agent.dispose()
	}
}

describe('inspectorAgent widget reference lookup', () => {
	it('resolves a widget late in a large document and sampled positions to the matching widget', async () => {
		const runtime = createLargeRuntime(4000)
		const { agent, client } = connect(runtime)
		try {
			const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: RUNTIME_ID })
			expect(snapshot.nodes)
				.toHaveLength(4001)
			const last = snapshot.nodes[snapshot.nodes.length - 1]!
			expect(last.widgetId)
				.toBe('counter-3999')
			const lastWidget = await client.request('runtime.getWidgetSnapshot', { ref: { runtimeId: RUNTIME_ID, nodeId: last.nodeId } })
			expect(lastWidget)
				.toMatchObject({ ref: { runtimeId: RUNTIME_ID, nodeId: last.nodeId }, widgetId: 'counter-3999', widgetType: 'DevtoolsCounter' })
			for (let index = 0; index < snapshot.nodes.length; index += 331) {
				const node = snapshot.nodes[index]!
				const widget = await client.request('runtime.getWidgetSnapshot', { ref: { runtimeId: RUNTIME_ID, nodeId: node.nodeId } })
				expect(widget)
					.toMatchObject({ ref: { runtimeId: RUNTIME_ID, nodeId: node.nodeId }, widgetId: node.widgetId })
			}
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('answers a forged or foreign node id exactly as an unknown widget', async () => {
		const { runtime } = createInspectorTestFixture()
		const foreignNodeId = await lastNodeIdOf(createLargeRuntime(50))
		const { agent, client } = connect(runtime)
		const request = (ref: unknown) => client.request('runtime.getWidgetSnapshot', { ref } as never)
		try {
			// Never issued, including an id issued only by another Blueprint.
			expect(await failureCode(request({ runtimeId: RUNTIME_ID, nodeId: 999999 })))
				.toBe('widget-not-found')
			expect(foreignNodeId)
				.toBeGreaterThan(1)
			expect(await failureCode(request({ runtimeId: RUNTIME_ID, nodeId: foreignNodeId })))
				.toBe('widget-not-found')
			// Rejected by wire validation before any lookup.
			for (const nodeId of [-1, 1.5, '0', 'length', null]) {
				expect(await failureCode(request({ runtimeId: RUNTIME_ID, nodeId })))
					.toBe('invalid-params')
			}
			// Another Runtime.
			expect(await failureCode(request({ runtimeId: 'elsewhere', nodeId: 0 })))
				.toBe('runtime-not-found')
			// -0 is the integer zero (the root).
			expect(await request({ runtimeId: RUNTIME_ID, nodeId: -0 }))
				.toMatchObject({ widgetId: 'root' })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('answers runtime-disposed for real and forged references alike once the Runtime is disposed', async () => {
		const { runtime } = createInspectorTestFixture()
		const { agent, client } = connect(runtime)
		try {
			const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: RUNTIME_ID })
			const counter = snapshot.nodes.find(node => node.widgetId === 'counter')!
			runtime.dispose()
			expect(await failureCode(client.request('runtime.getWidgetSnapshot', { ref: { runtimeId: RUNTIME_ID, nodeId: counter.nodeId } })))
				.toBe('runtime-disposed')
			expect(await failureCode(client.request('runtime.getWidgetSnapshot', { ref: { runtimeId: RUNTIME_ID, nodeId: 424242 } })))
				.toBe('runtime-disposed')
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})
})

describe('inspectorAgent anchor lookup', () => {
	function createAnchorFixture(anchors: ReadonlyArray<{ readonly id: string, readonly type: string }>) {
		const { runtime } = createInspectorTestFixture()
		const root = document.createElement('div')
		let parent: HTMLElement = root
		const elements: HTMLElement[] = []
		for (const anchor of anchors) {
			const element = document.createElement('div')
			element.dataset.widgetId = anchor.id
			element.dataset.widgetType = anchor.type
			parent.append(element)
			parent = element
			elements.push(element)
		}
		document.body.append(root)
		return { runtime, root, elements }
	}

	it('does not resolve an anchor whose id matches a widget but whose type does not', async () => {
		const { runtime, root, elements } = createAnchorFixture([
			{ id: 'counter', type: 'DevtoolsRoot' },
		])
		const { agent, client } = connect(runtime, { root })
		try {
			const hovered: unknown[] = []
			client.on('inspect.hovered', payload => hovered.push(payload))
			await client.request('inspect.enable', {})
			const click = new MouseEvent('click', { bubbles: true, cancelable: true })
			elements[0]!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			elements[0]!.dispatchEvent(click)
			await Promise.resolve()
			expect(hovered.filter(payload => payload !== null && (payload as { ref?: unknown }).ref !== undefined))
				.toStrictEqual([])
			expect(click.defaultPrevented)
				.toBe(false)
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('falls through a type-mismatched anchor to the resolvable ancestor, and resolves an exact match', async () => {
		const { runtime, root, elements } = createAnchorFixture([
			{ id: 'root', type: 'DevtoolsRoot' },
			{ id: 'counter', type: 'DevtoolsRoot' },
			{ id: 'counter', type: 'DevtoolsCounter' },
		])
		const { agent, client } = connect(runtime, { root })
		try {
			const hovered: Array<{ widgetId: string, widgetType: string }> = []
			client.on('inspect.hovered', (payload) => {
				if (payload !== null && 'widgetId' in payload)
					hovered.push(payload as never)
			})
			await client.request('inspect.enable', {})
			elements[2]!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			await Promise.resolve()
			expect(hovered.at(-1))
				.toMatchObject({ widgetId: 'counter', widgetType: 'DevtoolsCounter' })
			// Hover the mismatched middle anchor: it must not resolve, so the root wins.
			elements[1]!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			await Promise.resolve()
			expect(hovered.at(-1))
				.toMatchObject({ widgetId: 'root', widgetType: 'DevtoolsRoot' })
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})
})
