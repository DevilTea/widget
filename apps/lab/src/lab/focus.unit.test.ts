import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { createInspectorFocusStore } from './focus'
import { LabSession } from './session'

const validSource = sandboxPresets.find(preset => preset.id === 'valid-interactive')!.sourceText
const invalidSource = sandboxPresets.find(preset => preset.id === 'invalid-semantic')!.sourceText

describe('createInspectorFocusStore', () => {
	it('initializes focus at the current active Blueprint root', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)

		expect(store.getFocus())
			.toEqual({ nodeId: inspectBlueprint(session.active.blueprint).rootNodeId })
	})

	it('resets focus to the new root after a successful Apply, discarding a prior member focus', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)

		store.setFocus({ nodeId: store.getFocus()!.nodeId, member: { type: 'property', name: 'doubled' } })

		await session.applyPreset(invalidSource)

		expect(store.getFocus())
			.toEqual({ nodeId: inspectBlueprint(session.active.blueprint).rootNodeId })
	})

	it('resets focus even when the newly applied Blueprint is invalid (Runtime null)', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const store = createInspectorFocusStore(session)
		// A non-root member focus, so a reset is actually observable — `InspectionNodeId` allocation
		// restarts per Blueprint snapshot, so a bare root-vs-root comparison across snapshots would be
		// coincidental (the type's own contract: no cross-snapshot equality guarantee).
		store.setFocus({ nodeId: store.getFocus()!.nodeId, member: { type: 'state', name: 'count' } })

		await session.applyPreset(invalidSource)

		expect(session.active.runtime)
			.toBeNull()
		expect(store.getFocus())
			.toEqual({ nodeId: inspectBlueprint(session.active.blueprint).rootNodeId })
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
