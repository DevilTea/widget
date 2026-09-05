/**
 * Unit tests for `projectRelations()`:
 * - Empty state with no usable focus, null focus, or root focus without member.
 * - Member focus with incoming (usedBy) and outgoing (dependsOn) dependencies.
 * - Widget focus with cross-widget incoming/outgoing and internal same-widget split.
 * - Outgoing unresolved stubs (absent and invalid references).
 * - Exact member identity, operation (`reads`/`writes`/`invokes`), path, reference preservation.
 */

import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { SemanticGraph } from './types'
import { describe, expect, it } from 'vitest'
import { projectRelations } from './relations'

function createFixtureGraph(): SemanticGraph {
	return {
		clusters: [
			{ id: 'cluster:0', nodeId: 0 as InspectionNodeId, widgetId: 'root', widgetType: 'AppShell', label: 'root : AppShell' },
			{ id: 'cluster:1', nodeId: 1 as InspectionNodeId, widgetId: 'producer', widgetType: 'ProducerWidget', label: 'producer : ProducerWidget' },
			{ id: 'cluster:2', nodeId: 2 as InspectionNodeId, widgetId: 'consumer', widgetType: 'ConsumerWidget', label: 'consumer : ConsumerWidget' },
			{ id: 'cluster:3', nodeId: 3 as InspectionNodeId, widgetId: 'other', widgetType: 'OtherWidget', label: 'other : OtherWidget' },
		],
		vertices: [
			// Producer members
			{ id: '1:state:count', clusterId: 'cluster:1', nodeId: 1 as InspectionNodeId, kind: 'state', name: 'count' },
			{ id: '1:property:doubled', clusterId: 'cluster:1', nodeId: 1 as InspectionNodeId, kind: 'property', name: 'doubled' },
			{ id: '1:method:reset', clusterId: 'cluster:1', nodeId: 1 as InspectionNodeId, kind: 'method', name: 'reset', transitivelyWrites: true },
			// Consumer members
			{ id: '2:property:view', clusterId: 'cluster:2', nodeId: 2 as InspectionNodeId, kind: 'property', name: 'view' },
			{ id: '2:method:trigger', clusterId: 'cluster:2', nodeId: 2 as InspectionNodeId, kind: 'method', name: 'trigger' },
			// Other members
			{ id: '3:property:summary', clusterId: 'cluster:3', nodeId: 3 as InspectionNodeId, kind: 'property', name: 'summary' },
		],
		edges: [
			// Internal dependency in producer: doubled reads count
			{
				id: '1:property:doubled#dep0',
				sourceVertexId: '1:property:doubled',
				targetVertexId: '1:state:count',
				operation: 'reads',
				path: ['config', 'multiplier'],
				reference: { target: { type: 'self' }, operation: { type: 'state-get', key: 'count' } },
				invalidCycle: false,
			},
			// Cross-widget: consumer.view reads producer.count
			{
				id: '2:property:view#dep0',
				sourceVertexId: '2:property:view',
				targetVertexId: '1:state:count',
				operation: 'reads',
				path: ['deps', 'source'],
				reference: { target: { type: 'widget', widgetId: 'producer', optional: false }, operation: { type: 'state-get', key: 'count' } },
				invalidCycle: false,
			},
			// Cross-widget: other.summary reads producer.doubled
			{
				id: '3:property:summary#dep0',
				sourceVertexId: '3:property:summary',
				targetVertexId: '1:property:doubled',
				operation: 'reads',
				path: ['metrics'],
				reference: { target: { type: 'widget', widgetId: 'producer', optional: false }, operation: { type: 'property-get', name: 'doubled' } },
				invalidCycle: false,
			},
			// Cross-widget: consumer.trigger invokes producer.reset
			{
				id: '2:method:trigger#dep0',
				sourceVertexId: '2:method:trigger',
				targetVertexId: '1:method:reset',
				operation: 'invokes',
				path: ['actions'],
				reference: { target: { type: 'widget', widgetId: 'producer', optional: false }, operation: { type: 'method-invoke', name: 'reset' } },
				invalidCycle: false,
			},
			// Internal: producer.reset writes producer.count
			{
				id: '1:method:reset#dep0',
				sourceVertexId: '1:method:reset',
				targetVertexId: '1:state:count',
				operation: 'writes',
				path: ['mutate'],
				reference: { target: { type: 'self' }, operation: { type: 'state-set', key: 'count' } },
				invalidCycle: false,
			},
		],
		stubs: [
			// Outgoing stub from consumer.view to an unresolved widget
			{
				id: '2:property:view#stub0',
				ownerVertexId: '2:property:view',
				status: 'absent',
				operation: 'reads',
				path: ['optionalRef'],
				reference: { target: { type: 'widget', widgetId: 'missing-optional', optional: true }, operation: { type: 'property-get', name: 'missingProp' } },
			},
			// Outgoing stub from producer.doubled to an invalid widget
			{
				id: '1:property:doubled#stub0',
				ownerVertexId: '1:property:doubled',
				status: 'invalid',
				operation: 'reads',
				path: ['invalidRef'],
				reference: { target: { type: 'widget', widgetId: 'broken', optional: false }, operation: { type: 'state-get', key: 'missingState' } },
				targetNodeId: 99 as InspectionNodeId,
			},
		],
		invalidCycleVertexIds: new Set(['1:property:doubled']),
	}
}

describe('projectRelations', () => {
	const rootNodeId = 0 as InspectionNodeId
	const graph = createFixtureGraph()

	it('returns empty mode when focus is null, undefined, or missing nodeId', () => {
		expect(projectRelations(graph, null, rootNodeId))
			.toEqual({
				mode: 'empty',
				message: expect.stringContaining('Select a widget or member'),
			})
		expect(projectRelations(graph, undefined, rootNodeId))
			.toEqual({
				mode: 'empty',
				message: expect.stringContaining('Select a widget or member'),
			})
		expect(projectRelations(graph, { nodeId: undefined as unknown as InspectionNodeId }, rootNodeId))
			.toEqual({
				mode: 'empty',
				message: expect.stringContaining('Select a widget or member'),
			})
	})

	it('returns empty mode when focus is on the rootNodeId without a member', () => {
		const result = projectRelations(graph, { nodeId: rootNodeId }, rootNodeId)
		expect(result.mode)
			.toBe('empty')
	})

	it('returns empty mode when focused member or widget does not exist in graph', () => {
		const nonexistentMember = projectRelations(graph, { nodeId: 1 as InspectionNodeId, member: { type: 'state', name: 'notExist' } }, rootNodeId)
		expect(nonexistentMember.mode)
			.toBe('empty')

		const nonexistentWidget = projectRelations(graph, { nodeId: 999 as InspectionNodeId }, rootNodeId)
		expect(nonexistentWidget.mode)
			.toBe('empty')
	})

	describe('member focus mode', () => {
		it('projects incoming and outgoing relations for a focused member', () => {
			// Focus on producer's State 'count' (nodeId: 1)
			const model = projectRelations(graph, {
				nodeId: 1 as InspectionNodeId,
				member: { type: 'state', name: 'count' },
			}, rootNodeId)

			expect(model.mode)
				.toBe('member')
			if (model.mode !== 'member')
				return

			expect(model.selectedMember)
				.toEqual({
					nodeId: 1,
					clusterId: 'cluster:1',
					widgetId: 'producer',
					widgetType: 'ProducerWidget',
					kind: 'state',
					name: 'count',
					transitivelyWrites: undefined,
					invalidCycle: false,
				})

			// State 'count' is read by producer.doubled, consumer.view, and written by producer.reset
			// Total incoming = 3
			expect(model.totalUsedByCount)
				.toBe(3)

			// Incoming grouped by remote widget: 'producer' (internal) and 'consumer'
			expect(model.usedBy.map(g => g.widgetId))
				.toContain('producer')
			expect(model.usedBy.map(g => g.widgetId))
				.toContain('consumer')

			const consumerGroup = model.usedBy.find(g => g.widgetId === 'consumer')!
			expect(consumerGroup)
				.toBeDefined()
			expect(consumerGroup.isResolved)
				.toBe(true)
			expect(consumerGroup.isSameWidget)
				.toBe(false)
			expect(consumerGroup.rows)
				.toHaveLength(1)
			expect(consumerGroup.rows[0])
				.toMatchObject({
					operation: 'reads',
					localMember: { nodeId: 1, kind: 'state', name: 'count' },
					remoteMember: { nodeId: 2, widgetId: 'consumer', kind: 'property', name: 'view' },
					path: ['deps', 'source'],
					resolved: true,
				})

			const producerGroup = model.usedBy.find(g => g.widgetId === 'producer')!
			expect(producerGroup)
				.toBeDefined()
			expect(producerGroup.isSameWidget)
				.toBe(true)
			expect(producerGroup.rows)
				.toHaveLength(2) // doubled (reads) & reset (writes)

			// State 'count' does not depend on anything
			expect(model.totalDependsOnCount)
				.toBe(0)
			expect(model.dependsOn)
				.toHaveLength(0)
		})

		it('projects outgoing dependencies including unresolved stubs and flags invalidCycle', () => {
			// Focus on producer's Property 'doubled'
			const model = projectRelations(graph, {
				nodeId: 1 as InspectionNodeId,
				member: { type: 'property', name: 'doubled' },
			}, rootNodeId)

			expect(model.mode)
				.toBe('member')
			if (model.mode !== 'member')
				return

			expect(model.selectedMember.invalidCycle)
				.toBe(true)

			// Used by: other.summary reads producer.doubled -> 1 incoming
			expect(model.totalUsedByCount)
				.toBe(1)
			expect(model.usedBy[0]?.widgetId)
				.toBe('other')
			expect(model.usedBy[0]?.rows[0]?.remoteMember?.name)
				.toBe('summary')

			// Depends on:
			// 1) producer.count (resolved edge)
			// 2) broken (unresolved invalid stub)
			expect(model.totalDependsOnCount)
				.toBe(2)

			const resolvedGroup = model.dependsOn.find(g => g.widgetId === 'producer')!
			expect(resolvedGroup)
				.toBeDefined()
			expect(resolvedGroup.rows[0]?.remoteMember?.name)
				.toBe('count')

			const stubGroup = model.dependsOn.find(g => g.widgetId === 'broken')!
			expect(stubGroup)
				.toBeDefined()
			expect(stubGroup.isResolved)
				.toBe(false)
			expect(stubGroup.rows[0])
				.toMatchObject({
					resolved: false,
					stubStatus: 'invalid',
					stubTarget: {
						memberKind: 'state',
						memberName: 'missingState',
					},
				})
		})
	})

	describe('widget focus mode', () => {
		it('separates cross-widget incoming/outgoing from same-widget internal dependencies', () => {
			// Focus on producer widget (nodeId: 1)
			const model = projectRelations(graph, {
				nodeId: 1 as InspectionNodeId,
			}, rootNodeId)

			expect(model.mode)
				.toBe('widget')
			if (model.mode !== 'widget')
				return

			expect(model.selectedWidget)
				.toMatchObject({
					nodeId: 1,
					clusterId: 'cluster:1',
					widgetId: 'producer',
					widgetType: 'ProducerWidget',
					memberCounts: {
						state: 1,
						property: 1,
						method: 1,
						total: 3,
					},
				})

			// Cross-widget incoming:
			// - consumer.view -> producer.count
			// - consumer.trigger -> producer.reset
			// - other.summary -> producer.doubled
			// Total cross-widget incoming = 3
			expect(model.totalUsedByCount)
				.toBe(3)
			expect(model.usedBy.map(g => g.widgetId)
				.sort())
				.toEqual(['consumer', 'other'])

			// Cross-widget outgoing:
			// - producer.doubled -> broken (stub)
			// (producer.doubled -> producer.count and producer.reset -> producer.count are internal, not outgoing!)
			expect(model.totalDependsOnCount)
				.toBe(1)
			expect(model.dependsOn[0]?.widgetId)
				.toBe('broken')

			// Same-widget internal dependencies:
			// 1) doubled -> reads count
			// 2) reset -> writes count
			expect(model.totalInternalCount)
				.toBe(2)
			expect(model.internal)
				.toHaveLength(2)
			expect(model.internal[0])
				.toMatchObject({
					sourceMember: { name: 'doubled', kind: 'property' },
					targetMember: { name: 'count', kind: 'state' },
					operation: 'reads',
				})
			expect(model.internal[1])
				.toMatchObject({
					sourceMember: { name: 'reset', kind: 'method' },
					targetMember: { name: 'count', kind: 'state' },
					operation: 'writes',
				})
		})

		it('projects consumer widget with outgoing dependencies and absent stub', () => {
			const model = projectRelations(graph, {
				nodeId: 2 as InspectionNodeId,
			}, rootNodeId)

			expect(model.mode)
				.toBe('widget')
			if (model.mode !== 'widget')
				return

			// Cross-widget incoming: none
			expect(model.totalUsedByCount)
				.toBe(0)

			// Cross-widget outgoing:
			// 1) consumer.view -> producer.count
			// 2) consumer.trigger -> producer.reset
			// 3) consumer.view -> missing-optional (stub)
			expect(model.totalDependsOnCount)
				.toBe(3)

			const producerGroup = model.dependsOn.find(g => g.widgetId === 'producer')!
			expect(producerGroup.rows)
				.toHaveLength(2)

			const stubGroup = model.dependsOn.find(g => g.widgetId === 'missing-optional')!
			expect(stubGroup.isResolved)
				.toBe(false)
			expect(stubGroup.rows[0]?.stubStatus)
				.toBe('absent')
			expect(stubGroup.rows[0]?.stubTarget?.memberName)
				.toBe('missingProp')

			// Internal: none
			expect(model.totalInternalCount)
				.toBe(0)
		})
	})
	it('classifies unresolved self and same-widget-id stubs as same-widget relations', () => {
		const graphWithInternalStubs: SemanticGraph = {
			...graph,
			stubs: [
				...graph.stubs,
				{
					id: '1:property:doubled#stub-self',
					ownerVertexId: '1:property:doubled',
					status: 'invalid',
					operation: 'reads',
					path: ['selfMissing'],
					reference: { target: { type: 'self' }, operation: { type: 'property-get', name: 'missingInternal' } },
				},
				{
					id: '1:method:reset#stub-widget-self',
					ownerVertexId: '1:method:reset',
					status: 'invalid',
					operation: 'invokes',
					path: ['sameWidgetMissing'],
					reference: { target: { type: 'widget', widgetId: 'producer', optional: false }, operation: { type: 'method-invoke', name: 'missingMethod' } },
				},
			],
		}

		const memberModel = projectRelations(graphWithInternalStubs, {
			nodeId: 1 as InspectionNodeId,
			member: { type: 'method', name: 'reset' },
		}, rootNodeId)
		expect(memberModel.mode)
			.toBe('member')
		if (memberModel.mode !== 'member')
			return
		const sameWidgetStubGroup = memberModel.dependsOn.find(group => !group.isResolved && group.isSameWidget)
		expect(sameWidgetStubGroup)
			.toMatchObject({ widgetId: 'producer', widgetType: 'ProducerWidget', isSameWidget: true })
		expect(sameWidgetStubGroup?.rows[0]?.stubTarget?.memberName)
			.toBe('missingMethod')

		const widgetModel = projectRelations(graphWithInternalStubs, { nodeId: 1 as InspectionNodeId }, rootNodeId)
		expect(widgetModel.mode)
			.toBe('widget')
		if (widgetModel.mode !== 'widget')
			return

		// Only the external `broken` stub remains in Depends on. Same-widget unresolved references
		// belong beside resolved same-widget facts in the Internal dependencies section.
		expect(widgetModel.totalDependsOnCount)
			.toBe(1)
		expect(widgetModel.totalInternalCount)
			.toBe(4)
		const unresolvedInternal = widgetModel.internal.filter(item => !item.resolved)
		expect(unresolvedInternal)
			.toHaveLength(2)
		expect(unresolvedInternal.map(item => item.stubTarget?.memberName)
			.sort())
			.toEqual(['missingInternal', 'missingMethod'])
		expect(unresolvedInternal.every(item => item.targetMember === undefined))
			.toBe(true)
	})
})
