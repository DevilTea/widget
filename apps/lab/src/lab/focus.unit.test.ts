import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { createInspectorFocusStore } from './focus'
import { resolveWidgetFocus } from './inspect-focus'
import { LabSession } from './session'

const validSource = sandboxPresets.find(preset => preset.id === 'valid-interactive')!.sourceText
const invalidSource = sandboxPresets.find(preset => preset.id === 'invalid-semantic')!.sourceText

describe('createInspectorFocusStore', () => {
	it('synchronizes Document and Preview focus only while their revisions are linked', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		const focus = resolveWidgetFocus(session.preview!.blueprint, 'counter-1')!

		store.setFocus('document', focus)

		expect(store.getScopedFocus('document'))
			.toMatchObject({ scope: 'document', revision: 0, ...focus })
		expect(store.getScopedFocus('preview'))
			.toMatchObject({ scope: 'preview', revision: 0, ...focus })
	})

	it('isolates Preview focus from current Document focus after an invalid commit diverges revisions', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		const previewFocus = resolveWidgetFocus(session.preview!.blueprint, 'counter-1')!
		store.setFocus('preview', previewFocus)

		await session.applyPreset(invalidSource)

		expect(store.getScopedFocus('preview'))
			.toMatchObject({ scope: 'preview', revision: 0, ...previewFocus })
		expect(store.getScopedFocus('document'))
			.toMatchObject({
				scope: 'document',
				revision: 1,
				nodeId: inspectBlueprint(session.documentState.blueprint).rootNodeId,
			})

		const documentFocusBefore = store.getFocus('document')
		store.setFocus('preview', { nodeId: previewFocus.nodeId, member: { type: 'state', name: 'count' } })
		expect(store.getFocus('document'))
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
		expect(session.preview?.runtime.isDisposed)
			.toBe(false)
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
