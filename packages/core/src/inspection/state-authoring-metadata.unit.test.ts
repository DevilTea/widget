import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectBlueprint } from './index'

interface FixtureInterfaces {
	state: {
		authorVisible: number
		internal: number
		explicitFalse: number
	}
}

const plugin = createWidgetPlugin('state-authoring-metadata')
	.description('State authoring metadata fixture')
	.interfaces<FixtureInterfaces>()
	.state(state => state
		.authorVisible({
			authorWritable: true,
			validate: (input): input is number => typeof input === 'number',
		})
		.internal({
			validate: (input): input is number => typeof input === 'number',
		})
		.explicitFalse({
			authorWritable: false,
			validate: (input): input is number => typeof input === 'number',
		}))
	.done()

const system = createWidgetSystem({ plugins: [plugin] })

function createValidBlueprint() {
	const blueprint = system.createBlueprint({ id: 'root', type: 'state-authoring-metadata' })
	if (blueprint.status !== 'valid')
		throw new Error('test fixture: expected a valid blueprint')
	return blueprint
}

describe('state authoring metadata', () => {
	it('projects an explicit author-writable opt-in and fails closed when omitted', () => {
		const blueprint = createValidBlueprint()
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)
		if (root === null || !root.resolved)
			throw new Error('test fixture: expected a resolved root')

		expect(root.state)
			.toEqual([
				{ type: 'state', name: 'authorVisible', authorWritable: true },
				{ type: 'state', name: 'internal', authorWritable: false },
				{ type: 'state', name: 'explicitFalse', authorWritable: false },
			])
		expect(Object.isFrozen(root.state))
			.toBe(true)
		for (const member of root.state) {
			expect(Object.isFrozen(member))
				.toBe(true)
		}
	})

	it('does not change the lower-level overrideStateDefaults runtime contract', () => {
		const blueprint = createValidBlueprint()
		const runtime = blueprint.createRuntime({
			overrideStateDefaults: {
				root: {
					internal: 42,
				},
			},
		})
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected runtime root')

		expect(widget.state.internal.get())
			.toBe(42)
	})
})
