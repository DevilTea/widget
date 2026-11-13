/**
 * Vue adapter scenarios (`@deviltea/widget-vue`), run in Node against a SIMULATED DOM (happy-dom, the same
 * implementation the package's own tests use). The absolute numbers are only comparable to themselves: a
 * real browser has different DOM costs. What they are good for is the library's own share (the renderer,
 * the bridge subscriptions, Vue patching) and how it scales.
 *
 * Renderers are hand-written render functions (no SFC compiler involved). Vue and happy-dom are resolved
 * from `packages/vue/node_modules`, so the Vue instance is exactly the one the built package imports.
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createFixture, PROFILES } from '../lib/gen.mjs'
import { loadVue, root } from '../lib/load.mjs'
import { followerPlugin, rootPlugin, srcPlugin, starSource, starSystem } from '../lib/star.mjs'
import { counter, freshBatch, treeOf } from './common.mjs'

let environment = null

async function ensureEnvironment() {
	if (environment !== null)
		return environment
	const require = createRequire(`${root}packages/vue/package.json`)
	const happyDom = await import(pathToFileURL(require.resolve('happy-dom')).href)
	const window = new happyDom.Window({ url: 'http://localhost/' })
	globalThis.window = window
	globalThis.document = window.document
	for (const key of ['Node', 'Element', 'HTMLElement', 'SVGElement', 'Text', 'Comment', 'Event', 'MouseEvent', 'DocumentFragment', 'MutationObserver'])
		globalThis[key] = window[key]
	// Vue captures `document` when it is first imported, so the globals above come first.
	const vue = await import(pathToFileURL(require.resolve('vue')).href)
	const widgetVue = await loadVue()
	environment = { window, vue, widgetVue }
	return environment
}

function container(env) {
	const el = env.window.document.createElement('div')
	env.window.document.body.appendChild(el)
	return el
}

/** Renderer for the generated standard document (plugins `group` and `unit`). */
function standardRenderer(env, fixture) {
	const { defineComponent, h } = env.vue
	const { createWidgetVueRenderer, useWidget } = env.widgetVue
	const Group = defineComponent({
		name: 'BenchGroup',
		setup() {
			const { WidgetSlot } = useWidget(fixture.plugins.group)
			return () => h('div', { class: 'group' }, [h(WidgetSlot, { name: 'children' })])
		},
	})
	const Unit = defineComponent({
		name: 'BenchUnit',
		setup() {
			const { useState, useProperties } = useWidget(fixture.plugins.unit)
			const { s0 } = useState()
			const { ps0 } = useProperties()
			return () => h('span', { class: 'unit' }, `${s0.value}:${ps0.value}`)
		},
	})
	return createWidgetVueRenderer(fixture.system, renderers => renderers.group(Group)
		.unit(Unit))
}

/** Renderer for the star document. */
function starRenderer(env) {
	const { defineComponent, h } = env.vue
	const { createWidgetVueRenderer, useWidget } = env.widgetVue
	const Root = defineComponent({
		name: 'BenchRoot',
		setup() {
			const { WidgetSlot } = useWidget(rootPlugin)
			return () => h('div', { class: 'root' }, [h(WidgetSlot, { name: 'children' })])
		},
	})
	const Src = defineComponent({
		name: 'BenchSrc',
		setup() {
			const { useState } = useWidget(srcPlugin)
			const { v } = useState()
			return () => h('b', null, String(v.value))
		},
	})
	const Follower = defineComponent({
		name: 'BenchFollower',
		setup() {
			const { useProperties } = useWidget(followerPlugin)
			const { p } = useProperties()
			return () => h('i', null, String(p.value))
		},
	})
	return createWidgetVueRenderer(starSystem, renderers => renderers.root(Root)
		.src(Src)
		.follower(Follower))
}

function mountApp(env, Renderer, runtime) {
	const { createApp, h } = env.vue
	const app = createApp({ render: () => h(Renderer, { runtime }) })
	const el = container(env)
	app.mount(el)
	app.hostElement = el
	return app
}

async function standardSetup(n) {
	const env = await ensureEnvironment()
	const fixture = createFixture(treeOf(PROFILES.standard), n)
	const blueprint = fixture.compileValid()
	const Renderer = standardRenderer(env, fixture)
	// Guard against measuring a mount that renders nothing: every unit must appear in the DOM.
	const probe = blueprint.createRuntime()
	const probeApp = mountApp(env, Renderer, probe)
	const rendered = probeApp.hostElement.querySelectorAll('.unit').length
	probeApp.unmount()
	probeApp.hostElement.remove()
	probe.dispose()
	if (rendered !== fixture.unitIds().length)
		throw new Error(`expected ${fixture.unitIds().length} rendered units, found ${rendered}`)
	return { env, fixture, blueprint, Renderer }
}

export const scenarios = [
	{
		id: 'vue.mount',
		area: 'vue',
		jitless: false,
		perWidget: true,
		summary: 'Mount an N-widget standard tree through WidgetRenderer (simulated DOM).',
		inside: 'createApp + mount: renderer tree, every useWidget() bridge, first render of every widget',
		outside: 'compiling, Runtime creation, unmounting and disposing afterwards',
		note: 'simulated DOM (happy-dom); only comparable to itself',
		variants: [{
			name: 'standard',
			sizes: [100, 1000, 4000],
			async setup(n) {
				const { env, blueprint, Renderer } = await standardSetup(n)
				return {
					maxBatch: freshBatch(n),
					fresh: () => blueprint.createRuntime(),
					run: runtime => mountApp(env, Renderer, runtime),
					after: (runtime, app) => {
						app.unmount()
						// Detach the container too: happy-dom keeps everything reachable from the document alive.
						app.hostElement.remove()
						runtime.dispose()
					},
				}
			},
		}],
	},
	{
		id: 'vue.unmount',
		area: 'vue',
		jitless: false,
		perWidget: true,
		summary: 'Unmount an N-widget standard tree (simulated DOM).',
		inside: 'app.unmount()',
		outside: 'compiling, Runtime creation, mounting (a freshly mounted app per call), disposing',
		note: 'simulated DOM (happy-dom); only comparable to itself',
		variants: [{
			name: 'standard',
			sizes: [100, 1000, 4000],
			async setup(n) {
				const { env, blueprint, Renderer } = await standardSetup(n)
				return {
					maxBatch: freshBatch(n),
					fresh: () => {
						const runtime = blueprint.createRuntime()
						return { runtime, app: mountApp(env, Renderer, runtime) }
					},
					run: ({ app }) => app.unmount(),
					after: ({ runtime, app }) => {
						app.hostElement.remove()
						runtime.dispose()
					},
				}
			},
		}],
	},
	{
		id: 'vue.update',
		area: 'vue',
		jitless: false,
		summary: 'One State write that changes what K rendered widgets display, measured until the DOM has flushed.',
		inside: 'src.state.v.set(value) followed by await nextTick() (Vue flush + DOM patch of the K changed widgets)',
		outside: 'compiling, Runtime creation, mounting',
		note: 'simulated DOM (happy-dom); only comparable to itself',
		variants: [
			{
				name: 'star',
				note: 'K follower widgets render a Property that depends on the written State',
				sizeLabel: 'K widgets changed',
				perWidget: true,
				sizes: [10, 100, 1000, 4000],
				async setup(k) {
					const env = await ensureEnvironment()
					const blueprint = starSystem.createBlueprint(starSource(k))
					const runtime = blueprint.createRuntime()
					const app = mountApp(env, starRenderer(env), runtime)
					const src = runtime.getWidget('src')
					const next = counter(7000)
					// Guard against measuring a no-op: the flushed DOM must show the new value in every follower.
					src.state.v.set(next())
					await env.vue.nextTick()
					const shown = app.hostElement.querySelectorAll('i')
					if (shown.length !== k || (k > 0 && !Array.from(shown)
						.every(node => node.textContent === '7000'))) {
						throw new Error('vue.update star fixture did not update the DOM')
					}
					return {
						async: true,
						run: async () => {
							src.state.v.set(next())
							await env.vue.nextTick()
						},
					}
				},
			},
			{
				name: 'one-of-N',
				note: 'N-widget standard tree mounted; a write changes the display of exactly one unit; the size column is N',
				sizes: [100, 1000, 4000],
				async setup(n) {
					const { env, blueprint, Renderer } = await standardSetup(n)
					const runtime = blueprint.createRuntime()
					const app = mountApp(env, Renderer, runtime)
					const widget = runtime.getWidget('u0')
					const next = counter(100)
					widget.state.s0.set(424242)
					await env.vue.nextTick()
					if (!app.hostElement.textContent.includes('424242:'))
						throw new Error('vue.update one-of-N fixture did not update the DOM')
					return {
						async: true,
						run: async () => {
							widget.state.s0.set(next())
							await env.vue.nextTick()
						},
					}
				},
			},
		],
	},
	{
		id: 'vue.swap',
		area: 'vue',
		jitless: false,
		perWidget: true,
		summary: 'Replace the `runtime` prop of a mounted WidgetRenderer: a full unmount of the old tree and mount of the new one.',
		inside: 'assigning the prop and awaiting nextTick()',
		outside: 'compiling, creating the two Runtimes, the initial mount',
		note: 'simulated DOM (happy-dom); only comparable to itself',
		variants: [{
			name: 'standard',
			sizes: [100, 1000, 4000],
			async setup(n) {
				const { env, blueprint, Renderer } = await standardSetup(n)
				const { createApp, h, shallowRef } = env.vue
				const a = blueprint.createRuntime()
				const b = blueprint.createRuntime()
				const current = shallowRef(a)
				const app = createApp({ render: () => h(Renderer, { runtime: current.value }) })
				app.mount(container(env))
				let toggle = false
				return {
					async: true,
					run: async () => {
						toggle = !toggle
						current.value = toggle ? b : a
						await env.vue.nextTick()
					},
				}
			},
		}],
	},
]
