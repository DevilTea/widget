import type { InspectorBlueprintSnapshot } from '@deviltea/widget-inspector/protocol'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { replaceConfigScalar } from './author'
import { createInspectorFocusStore, uniqueRemoteNodeIdForIdentity } from './focus'
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

describe('uniqueRemoteNodeIdForIdentity', () => {
	const node = (nodeId: number, widgetId: string, widgetType: string, resolved = true) => ({ nodeId, resolved, ...(resolved ? { widgetId, widgetType } : {}), sourceSlots: [], diagnostics: [] })
	const snapshot = (nodes: ReturnType<typeof node>[]): InspectorBlueprintSnapshot => ({ runtimeId: 'r', rootNodeId: 0, nodes, invalidCycles: [] }) as unknown as InspectorBlueprintSnapshot

	it('finds the one resolved widget with this id and type', () => {
		expect(uniqueRemoteNodeIdForIdentity(snapshot([node(0, 'root', 'Stack'), node(1, 'mode', 'SingleChoice'), node(2, 'mode', 'Text')]), 'mode', 'SingleChoice'))
			.toBe(1)
	})

	it('is null when there is none, or when the identity is ambiguous (a duplicate id and type)', () => {
		expect(uniqueRemoteNodeIdForIdentity(snapshot([node(0, 'root', 'Stack')]), 'mode', 'SingleChoice'))
			.toBeNull()
		expect(uniqueRemoteNodeIdForIdentity(snapshot([node(1, 'mode', 'SingleChoice'), node(2, 'mode', 'SingleChoice')]), 'mode', 'SingleChoice'))
			.toBeNull()
		expect(uniqueRemoteNodeIdForIdentity(snapshot([node(1, 'mode', 'SingleChoice', false)]), 'mode', 'SingleChoice'))
			.toBeNull()
	})
})

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

	it('keeps the root selected after a preset when the root was the selection, and drops the member focus', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)

		store.setFocus({ nodeId: store.getFocus()!.nodeId, member: { type: 'property', name: 'doubled' } })

		await session.applyPreset(invalidSource)

		expect(store.getFocus())
			.toEqual({ nodeId: inspectBlueprint(session.documentSnapshot.blueprint).rootNodeId })
	})

	it('keeps the root selected (the selection was the root) when the new Document Blueprint is invalid and Preview retains an older Runtime', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		// The root with a member focus, so dropping the member is observable — `InspectionNodeId` allocation
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

	it('tells a chosen widget from the root it starts at and falls back to (Lab UX phase 2, Explain)', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		expect(store.isDocumentFocusChosen(), 'the starting root was not chosen')
			.toBe(false)

		const title = inspectBlueprint(session.documentState.blueprint).nodes.find(entry => entry.node.resolved && entry.node.id === 'title')!
		store.setFocus('document', { nodeId: title.nodeId })
		expect(store.isDocumentFocusChosen())
			.toBe(true)

		// A commit that keeps the widget keeps it chosen.
		const edited = JSON.parse(validSource) as { slots: { items: { id: string, config?: Record<string, unknown> }[] } }
		edited.slots.items.find(item => item.id === 'title')!.config = { text: 'edited in JSON' }
		session.setDraftSourceText(JSON.stringify(edited, null, 2))
		await session.apply()
		expect(store.isDocumentFocusChosen())
			.toBe(true)

		// A commit that removes it falls back to the root, which nobody chose.
		edited.slots.items = edited.slots.items.filter(item => item.id !== 'title')
		session.setDraftSourceText(JSON.stringify(edited, null, 2))
		await session.apply()
		expect(store.getFocus())
			.toEqual({ nodeId: inspectBlueprint(session.documentState.blueprint).rootNodeId })
		expect(store.isDocumentFocusChosen())
			.toBe(false)

		// Choosing the root itself counts, and clearing the focus does not.
		store.setFocus('document', { nodeId: inspectBlueprint(session.documentState.blueprint).rootNodeId })
		expect(store.isDocumentFocusChosen())
			.toBe(true)
		store.setFocus('document', null)
		expect(store.isDocumentFocusChosen())
			.toBe(false)
	})

	it('counts an Inspect selection in a linked Preview as chosen, and not one made while the revisions diverge', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		store.setPreviewSnapshot(0, remoteSnapshotOf(session))
		const counter = inspectBlueprint(session.preview!.blueprint).nodes.find(node => node.resolved && node.node.id === 'counter-1')!
		store.setFocus('preview', { nodeId: Number(counter.nodeId) })
		expect(store.isDocumentFocusChosen())
			.toBe(true)

		const diverged = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const divergedStore = createInspectorFocusStore(diverged)
		divergedStore.setPreviewSnapshot(0, remoteSnapshotOf(diverged))
		await diverged.applyPreset(invalidSource)
		divergedStore.setFocus('preview', { nodeId: Number(counter.nodeId) })
		expect(divergedStore.isDocumentFocusChosen(), 'a diverged Preview selection does not move the Document focus')
			.toBe(false)
	})

	it('goes back to the root when the selected widget\'s id and type were not unique in the old Document, even if they are in the new one', async () => {
		const duplicated = {
			id: 'root',
			type: 'Stack',
			slots: { items: [
				{ id: 'same', type: 'Text', config: { text: 'a' } },
				{ id: 'same', type: 'Text', config: { text: 'b' } },
			] },
		}
		const session = new LabSession({ system: sandboxSystem, initialSourceText: JSON.stringify(duplicated) })
		const store = createInspectorFocusStore(session)
		// The second "same" is selected; the Apply removes it and keeps the first, which is then the only "same".
		const second = inspectBlueprint(session.documentState.blueprint).nodes.filter(entry => entry.node.resolved && entry.node.id === 'same')[1]!
		store.setFocus({ nodeId: second.nodeId })

		session.setDraftSourceText(JSON.stringify({ ...duplicated, slots: { items: [duplicated.slots.items[0]] } }))
		const outcome = await session.apply()

		expect(outcome.status)
			.toBe('applied')
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
