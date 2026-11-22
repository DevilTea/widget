import type { InspectorBlueprintSnapshot } from '@deviltea/widget-inspector/protocol'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { replaceConfigScalar } from './author'
import { createInspectorFocusStore } from './focus'
import { LabSession } from './session'

const validSource = sandboxPresets.find(preset => preset.id === 'valid-interactive')!.sourceText
const invalidSource = sandboxPresets.find(preset => preset.id === 'invalid-semantic')!.sourceText

function remoteSnapshotOf(session: LabSession, runtimeId = 'runtime-test'): InspectorBlueprintSnapshot {
	const inspection = inspectBlueprint(session.preview!.blueprint)
	return {
		runtimeId,
		rootNodeId: Number(inspection.rootNodeId),
		nodes: inspection.nodes.map(entry => ({
			nodeId: Number(entry.nodeId),
			resolved: entry.node.resolved,
			...(entry.node.resolved ? { widgetId: entry.node.id, widgetType: entry.node.type } : {}),
			sourceSlots: [],
			diagnostics: [],
		})),
		invalidCycles: [],
	}
}

describe('createInspectorFocusStore', () => {
	it('synchronizes Document and Preview focus only while their revisions are linked', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		store.setPreviewSnapshot(0, remoteSnapshotOf(session))
		const counterNode = inspectBlueprint(session.preview!.blueprint).nodes
			.find(node => node.resolved && node.node.id === 'counter-1')
		if (counterNode === undefined)
			throw new Error('Expected counter-1 in Preview inspection.')
		const focus = { nodeId: counterNode.nodeId }

		store.setFocus('document', focus)

		expect(store.getScopedFocus('document'))
			.toMatchObject({ scope: 'document', revision: 0, ...focus })
		expect(store.getScopedFocus('preview'))
			.toMatchObject({ scope: 'preview', revision: 0, runtimeId: 'runtime-test', nodeId: Number(counterNode.nodeId) })
	})

	it('isolates Preview focus from current Document focus after an invalid commit diverges revisions', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		store.setPreviewSnapshot(0, remoteSnapshotOf(session))
		const counterNode = inspectBlueprint(session.preview!.blueprint).nodes
			.find(node => node.resolved && node.node.id === 'counter-1')
		if (counterNode === undefined)
			throw new Error('Expected counter-1 in Preview inspection.')
		const previewFocus = { nodeId: Number(counterNode.nodeId) }
		store.setFocus('preview', previewFocus)

		await session.applyPreset(invalidSource)

		expect(store.getScopedFocus('preview'))
			.toMatchObject({ scope: 'preview', revision: 0, ...previewFocus })
		// The Document keeps the widget the user had selected (counter-1, found again by id and type in the new revision).
		const counterAfter = inspectBlueprint(session.documentState.blueprint).nodes
			.find(node => node.resolved && node.node.id === 'counter-1')!
		expect(store.getScopedFocus('document'))
			.toMatchObject({
				scope: 'document',
				revision: 1,
				nodeId: counterAfter.nodeId,
			})

		const documentFocusBefore = store.getScopedFocus('document')
		store.setFocus('preview', { nodeId: previewFocus.nodeId, member: { type: 'state', name: 'count' } })
		expect(store.getScopedFocus('document'))
			.toEqual(documentFocusBefore)
	})

	it('initializes focus at the current committed Document Blueprint root', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)

		expect(store.getFocus())
			.toEqual({ nodeId: inspectBlueprint(session.documentSnapshot.blueprint).rootNodeId })
	})

	it('resets focus to the new root after a committed Document change, discarding a prior member focus', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)

		store.setFocus({ nodeId: store.getFocus()!.nodeId, member: { type: 'property', name: 'doubled' } })

		await session.applyPreset(invalidSource)

		expect(store.getFocus())
			.toEqual({ nodeId: inspectBlueprint(session.documentSnapshot.blueprint).rootNodeId })
	})

	it('resets focus even when the newly applied Document Blueprint is invalid and Preview retains an older Runtime', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		// A non-root member focus, so a reset is actually observable — `InspectionNodeId` allocation
		// restarts per Blueprint snapshot, so a bare root-vs-root comparison across snapshots would be
		// coincidental (the type's own contract: no cross-snapshot equality guarantee).
		store.setFocus({ nodeId: store.getFocus()!.nodeId, member: { type: 'state', name: 'count' } })

		await session.applyPreset(invalidSource)

		expect(session.documentState.blueprint.status)
			.toBe('invalid')
		expect(session.preview?.revision)
			.toBe(0)
		expect(store.getFocus())
			.toEqual({ nodeId: inspectBlueprint(session.documentSnapshot.blueprint).rootNodeId })
	})

	it('does not reset focus for session mutations that never cross the applied-snapshot boundary', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		const custom = { nodeId: store.getFocus()!.nodeId, member: { type: 'state' as const, name: 'count' } }
		store.setFocus(custom)

		session.setDraftSourceText('{ "id": "root", "type": "Text", "config": { "text": "draft only" } }')

		expect(store.getFocus())
			.toEqual(custom)
	})

	it('does not reset focus for a structural no-op Apply with different JSON text representation', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		const custom = { nodeId: store.getFocus()!.nodeId, member: { type: 'state' as const, name: 'count' } }
		store.setFocus(custom)

		session.setDraftSourceText(JSON.stringify(JSON.parse(validSource)))
		await session.apply()

		expect(session.documentSnapshot.revision)
			.toBe(0)
		expect(store.getFocus())
			.toEqual(custom)
	})

	it('does not reset focus when apply() fails to parse (active snapshot unchanged)', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		const custom = { nodeId: store.getFocus()!.nodeId, member: { type: 'property' as const, name: 'doubled' } }
		store.setFocus(custom)

		session.setDraftSourceText('not json')
		await session.apply()

		expect(store.getFocus())
			.toEqual(custom)
	})

	it('keeps focus on the same widget and member after a Structure command, so edits can follow each other', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		const inspection = inspectBlueprint(session.documentState.blueprint)
		const title = inspection.nodes.find(entry => entry.node.resolved && entry.node.id === 'title')!
		store.setFocus({ nodeId: title.nodeId, member: { type: 'property', name: 'text' } })

		const outcome = await session.author(replaceConfigScalar(0, title.nodeId, 'text', 'edited'))

		expect(outcome.status)
			.toBe('applied')
		const after = inspectBlueprint(session.documentState.blueprint)
		const titleAfter = after.nodes.find(entry => entry.node.resolved && entry.node.id === 'title')!
		expect(store.getFocus())
			.toEqual({ nodeId: titleAfter.nodeId, member: { type: 'property', name: 'text' } })
		expect(store.getScopedFocus('document'))
			.toMatchObject({ revision: 1 })
	})

	it('keeps the selected widget (not its member) after a JSON Apply when the new Document still has it', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		const title = inspectBlueprint(session.documentState.blueprint).nodes.find(entry => entry.node.resolved && entry.node.id === 'title')!
		store.setFocus({ nodeId: title.nodeId, member: { type: 'property', name: 'text' } })

		const edited = JSON.parse(validSource) as { slots: { items: { id: string, config?: Record<string, unknown> }[] } }
		edited.slots.items.find(item => item.id === 'title')!.config = { text: 'edited in JSON' }
		session.setDraftSourceText(JSON.stringify(edited, null, 2))
		const outcome = await session.apply()

		expect(outcome.status)
			.toBe('applied')
		const titleAfter = inspectBlueprint(session.documentState.blueprint).nodes.find(entry => entry.node.resolved && entry.node.id === 'title')!
		expect(store.getFocus())
			.toEqual({ nodeId: titleAfter.nodeId })
		expect(store.getScopedFocus('document'))
			.toMatchObject({ revision: 1 })
	})

	it('goes back to the root after a JSON Apply that removed the selected widget', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		const title = inspectBlueprint(session.documentState.blueprint).nodes.find(entry => entry.node.resolved && entry.node.id === 'title')!
		store.setFocus({ nodeId: title.nodeId })

		const edited = JSON.parse(validSource) as { slots: { items: { id: string }[] } }
		edited.slots.items = edited.slots.items.filter(item => item.id !== 'title')
		session.setDraftSourceText(JSON.stringify(edited, null, 2))
		await session.apply()

		expect(store.getFocus())
			.toEqual({ nodeId: inspectBlueprint(session.documentState.blueprint).rootNodeId })
	})

	it('goes back to the root when the widget cannot be found again by its id and type', async () => {
		const duplicated = JSON.stringify({
			id: 'root',
			type: 'Stack',
			slots: { items: [
				{ id: 'same', type: 'Text', config: { text: 'a' } },
				{ id: 'same', type: 'Text', config: { text: 'b' } },
			] },
		})
		const session = new LabSession({ system: sandboxSystem, initialSourceText: duplicated })
		const store = createInspectorFocusStore(session)
		const first = inspectBlueprint(session.documentState.blueprint).nodes.filter(entry => entry.node.resolved && entry.node.id === 'same')[0]!
		store.setFocus({ nodeId: first.nodeId })

		await session.author(replaceConfigScalar(0, first.nodeId, 'text', 'edited'))

		expect(store.getFocus())
			.toEqual({ nodeId: inspectBlueprint(session.documentState.blueprint).rootNodeId })
	})

	it('notifies subscribers on focus change and stops after unsubscribing', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		const rootId = store.getFocus()!.nodeId
		let calls = 0
		const unsubscribe = store.subscribe(() => {
			calls++
		})

		store.setFocus({ nodeId: rootId, member: { type: 'state', name: 'count' } })
		expect(calls)
			.toBe(1)

		unsubscribe()
		store.setFocus({ nodeId: rootId })
		expect(calls)
			.toBe(1)
	})

	it('dispose() stops resetting focus on later Apply calls', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		const custom = { nodeId: store.getFocus()!.nodeId, member: { type: 'property' as const, name: 'doubled' } }
		store.setFocus(custom)

		store.dispose()
		await session.applyPreset(invalidSource)

		expect(store.getFocus())
			.toEqual(custom)
	})
})
