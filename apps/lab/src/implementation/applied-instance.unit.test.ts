import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { sandboxSystem } from '../sandbox/system'
import { extractAppliedInstance } from './applied-instance'

const authored = {
	id: 'root',
	type: 'Stack',
	slots: {
		items: [
			{ id: 'title', type: 'Text', config: { text: 'hello' } },
			{
				id: 'section-1',
				type: 'Section',
				config: { title: 'Details' },
				slots: {
					body: [
						{ id: 'note', type: 'Text', config: { text: 'nested' } },
					],
				},
			},
		],
	},
}

function nodeIdOf(blueprint: ReturnType<typeof sandboxSystem.createBlueprint>, id: string) {
	return inspectBlueprint(blueprint).nodes.find(node => node.resolved && node.node.id === id)!.nodeId
}

describe('extractAppliedInstance', () => {
	const blueprint = sandboxSystem.createBlueprint(structuredClone(authored))

	it('finds the root widget and pretty-prints its exact authored fragment', () => {
		const result = extractAppliedInstance(blueprint, inspectBlueprint(blueprint).rootNodeId)
		expect(result.status)
			.toBe('found')
		expect(result.status === 'found' && JSON.parse(result.json))
			.toEqual(authored)
	})

	it('finds a widget nested several slots deep', () => {
		const result = extractAppliedInstance(blueprint, nodeIdOf(blueprint, 'note'))
		expect(result.status === 'found' && JSON.parse(result.json))
			.toEqual({ id: 'note', type: 'Text', config: { text: 'nested' } })
	})

	it('includes a widget\'s own slots without sibling content', () => {
		const result = extractAppliedInstance(blueprint, nodeIdOf(blueprint, 'section-1'))
		expect(result.status === 'found' && JSON.parse(result.json))
			.toEqual(authored.slots.items[1])
	})

	it('pretty-prints with 2-space indentation', () => {
		const result = extractAppliedInstance(blueprint, nodeIdOf(blueprint, 'title'))
		expect(result)
			.toEqual({ status: 'found', json: JSON.stringify({ id: 'title', type: 'Text', config: { text: 'hello' } }, null, 2) })
	})

	it('selects the focused node, not the first widget that shares its id', () => {
		const duplicated = sandboxSystem.createBlueprint({
			id: 'root',
			type: 'Stack',
			slots: { items: [
				{ id: 'same', type: 'Text', config: { text: 'first' } },
				{ id: 'same', type: 'Text', config: { text: 'second' } },
			] },
		})
		const second = inspectBlueprint(duplicated).nodes.filter(node => node.resolved && node.node.id === 'same')[1]!

		const result = extractAppliedInstance(duplicated, second.nodeId)

		expect(result.status === 'found' && JSON.parse(result.json))
			.toEqual({ id: 'same', type: 'Text', config: { text: 'second' } })
	})

	it('returns not-found for a node id that is not in this Blueprint snapshot', () => {
		const foreign = inspectBlueprint(sandboxSystem.createBlueprint({ id: 'x', type: 'Text', config: { text: 'x' } })).rootNodeId
		const missing = (foreign + 1000) as typeof foreign

		expect(extractAppliedInstance(blueprint, missing))
			.toEqual({ status: 'not-found' })
	})
})
