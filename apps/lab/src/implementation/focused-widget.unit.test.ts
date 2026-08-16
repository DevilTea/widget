import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { defaultSandboxPreset } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { resolveFocusedWidget } from './focused-widget'

function createBlueprint() {
	const definition: unknown = JSON.parse(defaultSandboxPreset.sourceText)
	const blueprint = sandboxSystem.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error('Expected the default sandbox preset to compile to a valid Blueprint.')
	return blueprint
}

describe('resolveFocusedWidget', () => {
	it('returns null when there is no focus', () => {
		const blueprint = createBlueprint()
		expect(resolveFocusedWidget(blueprint, null))
			.toBeNull()
	})

	it('resolves the root node id/type', () => {
		const blueprint = createBlueprint()
		const inspection = inspectBlueprint(blueprint)
		const focused = resolveFocusedWidget(blueprint, { nodeId: inspection.rootNodeId })
		expect(focused)
			.toEqual({ id: 'root', type: 'Stack' })
	})

	it('resolves a nested node id/type', () => {
		const blueprint = createBlueprint()
		const inspection = inspectBlueprint(blueprint)
		const counterNode = inspection.nodes.find(node => node.resolved && node.node.id === 'counter-1')
		expect(counterNode)
			.toBeDefined()
		const focused = resolveFocusedWidget(blueprint, { nodeId: counterNode!.nodeId })
		expect(focused)
			.toEqual({ id: 'counter-1', type: 'Counter' })
	})
})
