import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

interface RootInterfaces extends WidgetInterfaces {
	slots: 'body'
}

interface CounterInterfaces extends WidgetInterfaces {
	state: {
		count: number
	}
	properties: {
		doubled: number
	}
	methods: {
		increment: (step: number) => number
	}
}

const RootPlugin = createWidgetPlugin('DevtoolsRoot')
	.description('DevTools test root')
	.interfaces<RootInterfaces>()
	.slots({ body: { description: 'Body' } })
	.done()

const CounterPlugin = createWidgetPlugin('DevtoolsCounter')
	.description('DevTools test counter')
	.interfaces<CounterInterfaces>()
	.state(state => state.count({
		validate: (input): input is number => typeof input === 'number' && Number.isFinite(input),
		default: () => 1,
	}))
	.properties(properties => properties.doubled({
		registerDeps: ({ dep }) => dep.self.state.get('count'),
		compute: ({ deps }) => {
			const count = deps()
			return (count.ok ? count.value ?? 0 : 0) * 2
		},
	}))
	.methods(methods => methods.increment({
		registerDeps: ({ dep }) => ({
			count: dep.self.state.get('count'),
			setCount: dep.self.state.set('count'),
		}),
		validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
		execute: ({ args: [step], deps }) => {
			const current = deps.count()
			const next = (current.ok ? current.value ?? 0 : 0) + step
			deps.setCount(next)
			return next
		},
	}))
	.done()

export const devtoolsTestSystem = createWidgetSystem({ plugins: [RootPlugin, CounterPlugin] })

export function createDevtoolsTestFixture() {
	const blueprint = devtoolsTestSystem.createBlueprint({
		id: 'root',
		type: 'DevtoolsRoot',
		slots: {
			body: [
				{ id: 'counter', type: 'DevtoolsCounter' },
			],
		},
	})
	if (blueprint.status !== 'valid')
		throw new Error('Expected valid DevTools test Blueprint.')
	const runtime = blueprint.createRuntime()
	const counter = runtime.getWidget('counter')
	if (counter === null || counter.type !== 'DevtoolsCounter')
		throw new Error('Expected counter Runtime widget.')
	return { blueprint, runtime, counter }
}
