/**
 * `useGraphEdgeSelection()` regression tests (PR #18 review 4939584651, finding 1): Graph edge
 * selection is a panel-local *snapshot-bound* selection (diagnostic #13 Phase 5 "inspector panel interaction
 * contract") and must reset when the applied Blueprint identity changes, but must not reset for any
 * `LabSession` mutation that never crosses the applied-snapshot boundary. Exercised against a real
 * `LabSession` over the real sandbox `WidgetSystem` (no mocked core) plus real Vue reactivity — mirrors
 * how `use-lab-store.ts` itself bridges `LabSession.subscribe()` into a `computed()` ref, so this test
 * observes the exact same reactive wiring the real `LabStore.active` ref uses.
 */

import type { GraphEdgeData } from '../graph/vue-flow'
import { describe, expect, it } from 'vitest'
import { computed, nextTick, shallowRef } from 'vue'
import { LabSession } from '../lab/session'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { useGraphEdgeSelection } from './use-graph-edge-selection'

const validSource = sandboxPresets.find(preset => preset.id === 'valid-interactive')!.sourceText
const invalidSource = sandboxPresets.find(preset => preset.id === 'invalid-semantic')!.sourceText

const fakeEdge: GraphEdgeData = {
	operation: 'reads',
	path: ['pricing', 'base'],
	reference: {
		target: { type: 'widget', widgetId: 'counter-1', optional: false },
		operation: { type: 'property-get', name: 'doubled' },
	},
}

/** Mirrors `use-lab-store.ts`'s own `session.subscribe()` -> `computed()` bridge, real reactivity included. */
function createActiveRef(session: LabSession) {
	const tick = shallowRef(0)
	session.subscribe(() => tick.value++)
	return computed(() => {
		void tick.value
		return session.active
	})
}

describe('useGraphEdgeSelection', () => {
	it('starts with no selection', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const selection = useGraphEdgeSelection({ active: createActiveRef(session) })

		expect(selection.selected.value)
			.toBeNull()
	})

	it('resets the selection once a successful Apply installs a new Blueprint', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const selection = useGraphEdgeSelection({ active: createActiveRef(session) })

		selection.select(fakeEdge)
		expect(selection.selected.value)
			.toEqual(fakeEdge)

		session.setDraftSourceText(invalidSource)
		await session.apply()
		await nextTick()

		expect(selection.selected.value)
			.toBeNull()
	})

	it('resets the selection even when the newly applied Blueprint is invalid (Runtime null)', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const selection = useGraphEdgeSelection({ active: createActiveRef(session) })

		selection.select(fakeEdge)
		await session.applyPreset(invalidSource)
		await nextTick()

		expect(session.active.runtime)
			.toBeNull()
		expect(selection.selected.value)
			.toBeNull()
	})

	it('does not reset the selection for a draft edit that never crosses the applied-snapshot boundary', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const selection = useGraphEdgeSelection({ active: createActiveRef(session) })

		selection.select(fakeEdge)
		session.setDraftSourceText('{ "id": "root", "type": "Text", "config": { "text": "draft only" } }')
		await nextTick()

		expect(selection.selected.value)
			.toEqual(fakeEdge)
	})

	it('does not reset the selection when apply() fails to parse (active snapshot unchanged)', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const selection = useGraphEdgeSelection({ active: createActiveRef(session) })

		selection.select(fakeEdge)
		session.setDraftSourceText('not json')
		await session.apply()
		await nextTick()

		expect(selection.selected.value)
			.toEqual(fakeEdge)
	})

	it('lets a fresh selection replace an existing one without needing a clear first', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const selection = useGraphEdgeSelection({ active: createActiveRef(session) })
		const otherEdge: GraphEdgeData = { ...fakeEdge, operation: 'writes' }

		selection.select(fakeEdge)
		selection.select(otherEdge)

		expect(selection.selected.value)
			.toEqual(otherEdge)
	})
})
