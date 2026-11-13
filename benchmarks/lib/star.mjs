/**
 * A "star" document: one `src` widget with a State `v`, and K `follower` widgets whose Property `p` depends
 * on it. One write to `src.state.v` therefore touches K dependents. Shared by the Runtime and Vue scenarios.
 */

import { loadCore } from './load.mjs'

const { createWidgetPlugin, createWidgetSystem } = await loadCore()

export const rootPlugin = createWidgetPlugin('root')
	.description('root')
	.interfaces()
	.slots({ children: { description: 'children' } })
	.done()

export const srcPlugin = createWidgetPlugin('src')
	.description('source')
	.interfaces()
	.state(s => s.v({ validate: v => typeof v === 'number', default: () => 0 }))
	.done()

export const followerPlugin = createWidgetPlugin('follower')
	.description('follower')
	.interfaces()
	.properties(p => p.p({
		registerDeps: ({ dep }) => ({ v: dep.widget('src').state.get('v') }),
		compute: ({ deps }) => {
			const r = deps.v()
			return r.ok ? r.value : 0
		},
	}))
	.done()

export const starSystem = createWidgetSystem({ plugins: [rootPlugin, srcPlugin, followerPlugin] })

export function starSource(followers) {
	const children = [{ id: 'src', type: 'src' }]
	for (let i = 0; i < followers; i++)
		children.push({ id: `f${i}`, type: 'follower' })
	return { id: 'root', type: 'root', slots: { children } }
}

export function createStar(followers) {
	const blueprint = starSystem.createBlueprint(starSource(followers))
	if (blueprint.status !== 'valid')
		throw new Error('star fixture invalid')
	const runtime = blueprint.createRuntime()
	const props = []
	for (let i = 0; i < followers; i++)
		props.push(runtime.getWidget(`f${i}`).properties.p)
	return { system: starSystem, blueprint, runtime, src: runtime.getWidget('src'), followerProps: props }
}
