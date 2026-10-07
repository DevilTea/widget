/**
 * Browser-side harness for the inspect-anchor contract (DevilTea/widget#161).
 *
 * Runs in native Chromium (served by Vite from source, like `devtools-transport.browser.ts`) with REAL
 * `@deviltea/widget-vue` renderers: each renderer projects `useWidget()` identity through the public
 * `@deviltea/widget-inspector/anchor` contract and nothing else, mounts into a real DOM root, and is
 * inspected by a real `InspectorAgent` through an in-process transport. Layout is fixed by CSS so the
 * spec can assert exact geometry and hit-testing in actual browser layout.
 *
 * Fixed layout (viewport coordinates; the harness root sits at 0,0):
 *   Shell    0,0   400x300
 *   Panel    20,20 360x240   (inside Shell)
 *   Leaf     40,40 120x40    (inside Panel)   x 40..160, y 40..80
 *   Floater  120,40 80x40    (inside Panel, later sibling, z-index 5) overlaps Leaf for x 120..160
 */
import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { InspectorClient } from '@deviltea/widget-inspector/client'
import type { InspectorRequestMethod, InspectorRequestParams, InspectorRequestResult, WidgetRef } from '@deviltea/widget-inspector/protocol'
import type { App } from 'vue'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { createInspectorAgent } from '@deviltea/widget-inspector/agent'
import { inspectAnchorAttributes } from '@deviltea/widget-inspector/anchor'
import { createInspectorClient } from '@deviltea/widget-inspector/client'
import { createInProcessInspectorTransportPair } from '@deviltea/widget-inspector/transport'
import { createWidgetVueRenderer, useWidget } from '@deviltea/widget-vue'
import { createApp, defineComponent, Fragment, h } from 'vue'

export type LeafMode = 'visible' | 'hidden' | 'replaced' | 'fragments' | 'wrapped'

interface SlotInterfaces extends WidgetInterfaces {
	slots: 'body'
}

interface LeafInterfaces extends WidgetInterfaces {
	state: { mode: LeafMode }
}

const ShellPlugin = createWidgetPlugin('Shell')
	.description('Anchor fixture shell')
	.interfaces<SlotInterfaces>()
	.slots({ body: { description: 'Body' } })
	.done()

const PanelPlugin = createWidgetPlugin('Panel')
	.description('Anchor fixture panel')
	.interfaces<SlotInterfaces>()
	.slots({ body: { description: 'Body' } })
	.done()

const FloaterPlugin = createWidgetPlugin('Floater')
	.description('Anchor fixture floating widget')
	.interfaces<SlotInterfaces>()
	.slots({ body: { description: 'Body' } })
	.done()

const LeafPlugin = createWidgetPlugin('Leaf')
	.description('Anchor fixture leaf whose rendered shape the spec switches')
	.interfaces<LeafInterfaces>()
	.state(state => state.mode({
		validate: (input): input is LeafMode => input === 'visible' || input === 'hidden' || input === 'replaced' || input === 'fragments' || input === 'wrapped',
		default: () => 'visible',
	}))
	.done()

const system = createWidgetSystem({ plugins: [ShellPlugin, PanelPlugin, FloaterPlugin, LeafPlugin] })

const STYLE = `
	.shell { position: absolute; left: 0; top: 0; width: 400px; height: 300px; }
	.panel { position: absolute; left: 20px; top: 20px; width: 360px; height: 240px; }
	.leaf { position: absolute; left: 20px; top: 20px; width: 120px; height: 40px; margin: 0; padding: 0; border: 0; }
	.leaf--replaced { left: 20px; top: 100px; width: 90px; height: 30px; }
	.frag { position: absolute; width: 50px; height: 20px; }
	.frag-a { left: 20px; top: 160px; }
	.frag-b { left: 120px; top: 190px; }
	.wrap-container { position: absolute; left: 200px; top: 100px; width: 60px; font: 16px/20px monospace; }
	.floater { position: absolute; left: 100px; top: 20px; width: 80px; height: 40px; z-index: 5; }
`

const ShellRenderer = defineComponent({
	name: 'AnchorShellRenderer',
	setup() {
		const { WidgetSlot, widgetId, widgetType } = useWidget(ShellPlugin)
		const anchor = inspectAnchorAttributes({ widgetId, widgetType })
		return () => h('div', { class: 'shell', ...anchor }, [h(WidgetSlot, { name: 'body' })])
	},
})

const PanelRenderer = defineComponent({
	name: 'AnchorPanelRenderer',
	setup() {
		const { WidgetSlot, widgetId, widgetType } = useWidget(PanelPlugin)
		const anchor = inspectAnchorAttributes({ widgetId, widgetType })
		return () => h('div', { class: 'panel', ...anchor }, [h(WidgetSlot, { name: 'body' })])
	},
})

const FloaterRenderer = defineComponent({
	name: 'AnchorFloaterRenderer',
	setup() {
		const { widgetId, widgetType } = useWidget(FloaterPlugin)
		const anchor = inspectAnchorAttributes({ widgetId, widgetType })
		return () => h('div', { class: 'floater', ...anchor })
	},
})

const LeafRenderer = defineComponent({
	name: 'AnchorLeafRenderer',
	setup() {
		const { useState, widgetId, widgetType } = useWidget(LeafPlugin)
		const { mode } = useState()
		const anchor = inspectAnchorAttributes({ widgetId, widgetType })
		return () => {
			switch (mode.value) {
				case 'hidden':
					// Renders nothing: the anchor leaves the DOM with the renderer, no cleanup API involved.
					return null
				case 'replaced':
					return h('section', { class: 'leaf leaf--replaced', ...anchor }, 'replaced')
				case 'fragments':
					// A multi-root Vue fragment: two anchors for one Widget, no wrapper element.
					return h(Fragment, [
						h('div', { class: 'frag frag-a', ...anchor }),
						h('div', { class: 'frag frag-b', ...anchor }),
					])
				case 'wrapped':
					// One anchor whose inline content wraps over several lines: several client rects.
					return h('div', { class: 'wrap-container' }, [
						h('span', { ...anchor }, 'aaaa bbbb cccc dddd'),
					])
				default:
					return h('button', { class: 'leaf', type: 'button', ...anchor }, 'leaf')
			}
		}
	},
})

const WidgetRenderer = createWidgetVueRenderer(system, renderers =>
	renderers
		.Shell(ShellRenderer)
		.Panel(PanelRenderer)
		.Floater(FloaterRenderer)
		.Leaf(LeafRenderer))

export interface AnchorHarness {
	/** Issues a read-only Inspector request through the real client/transport/agent. */
	request: <Method extends InspectorRequestMethod>(
		method: Method,
		params: InspectorRequestParams<Method>,
	) => Promise<InspectorRequestResult<Method>>
	refFor: (widgetId: string) => Promise<WidgetRef>
	setLeafMode: (mode: LeafMode) => Promise<void>
	/** Mounts a nonsemantic element above the Leaf, outside the inspected root. */
	addCover: () => void
	removeCover: () => void
	/** Unmounts the Vue app (all anchors leave the DOM); the Agent and Runtime stay alive. */
	unmountApp: () => void
	disposeAgent: () => void
	attributesOf: (selector: string) => string[]
	overlayHostCount: () => number
	dispose: () => void
}

declare global {
	interface Window {
		__anchorHarness?: AnchorHarness
	}
}

export async function mountAnchorHarness(): Promise<void> {
	window.__anchorHarness?.dispose()
	const style = document.createElement('style')
	style.textContent = STYLE
	document.head.append(style)
	const root = document.createElement('div')
	root.id = 'anchor-root'
	root.style.cssText = 'position: absolute; left: 0; top: 0; width: 400px; height: 300px;'
	document.body.append(root)

	const blueprint = system.createBlueprint({
		id: 'shell',
		type: 'Shell',
		slots: {
			body: [{
				id: 'panel',
				type: 'Panel',
				slots: {
					body: [
						{ id: 'leaf', type: 'Leaf' },
						{ id: 'floater', type: 'Floater' },
					],
				},
			}],
		},
	})
	if (blueprint.status !== 'valid')
		throw new Error('Expected a valid anchor fixture Blueprint.')
	const runtime = blueprint.createRuntime()

	let app: App | null = createApp({ render: () => h(WidgetRenderer, { runtime }) })
	app.mount(root)

	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-anchors', dom: { root } })
	const client: InspectorClient = createInspectorClient(pair.client)

	let cover: HTMLElement | null = null
	let agentDisposed = false

	const harness: AnchorHarness = {
		request: (method, params) => client.request(method, params),
		async refFor(widgetId) {
			const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-anchors' })
			const node = snapshot.nodes.find(candidate => candidate.resolved && candidate.widgetId === widgetId)
			if (node === undefined)
				throw new Error(`No Blueprint node for ${widgetId}.`)
			return { runtimeId: 'runtime-anchors', nodeId: node.nodeId }
		},
		async setLeafMode(mode) {
			const leaf = runtime.getWidget('leaf')
			if (leaf === null || leaf.type !== 'Leaf')
				throw new Error('Expected the leaf Runtime widget.')
			leaf.state.mode.set(mode)
			// Let Vue flush its render, then wait two frames so the Agent's geometry observers settle.
			await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
		},
		addCover() {
			cover = document.createElement('div')
			cover.id = 'anchor-cover'
			cover.style.cssText = 'position: absolute; left: 30px; top: 30px; width: 140px; height: 60px; z-index: 50; background: rgba(0, 0, 0, 0.3);'
			document.body.append(cover)
		},
		removeCover() {
			cover?.remove()
			cover = null
		},
		unmountApp() {
			app?.unmount()
			app = null
		},
		disposeAgent() {
			if (!agentDisposed) {
				agentDisposed = true
				agent.dispose()
			}
		},
		attributesOf(selector) {
			return document.querySelector(selector)
				?.getAttributeNames()
				.sort() ?? []
		},
		overlayHostCount: () => document.querySelectorAll('[data-widget-inspector-overlay="true"]').length,
		dispose() {
			harness.disposeAgent()
			client.dispose()
			harness.unmountApp()
			harness.removeCover()
			runtime.dispose()
			root.remove()
			style.remove()
			delete window.__anchorHarness
		},
	}
	window.__anchorHarness = harness
}
