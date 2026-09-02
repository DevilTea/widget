import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { inspectionNodeIdOfDiagnostic, inspectionNodeIdOfLocation } from './diagnostics'
import { createInspectorFocusStore } from './focus'
import { LabSession } from './session'

const validSource = sandboxPresets.find(preset => preset.id === 'valid-interactive')!.sourceText
const invalidSource = sandboxPresets.find(preset => preset.id === 'invalid-semantic')!.sourceText
const recoverySource = sandboxPresets.find(preset => preset.id === 'raw-slot-recovery')!.sourceText

function sourceIdOf(node: { readonly node: { readonly source: unknown } }): string | null {
	const source = node.node.source
	return typeof source === 'object' && source !== null && !Array.isArray(source) && typeof (source as Record<string, unknown>).id === 'string'
		? (source as Record<string, string>).id
		: null
}

describe('blueprint diagnostic navigation', () => {
	it('navigates a recovery diagnostic to the unresolved inspection node and keeps raw-slot children in topology', () => {
		const blueprint = sandboxSystem.createBlueprint(JSON.parse(recoverySource))
		const inspection = inspectBlueprint(blueprint)
		const mystery = inspection.nodes.find(node => sourceIdOf(node) === 'mystery-1')!
		const orphan = inspection.nodes.find(node => sourceIdOf(node) === 'orphan-1')!
		const diagnostic = blueprint.diagnostics.find(candidate => candidate.location.type === 'widget'
			&& inspection.getNodeId(candidate.location.node) === mystery.nodeId)

		expect(mystery.resolved)
			.toBe(false)
		expect(diagnostic)
			.toBeDefined()
		expect(inspectionNodeIdOfDiagnostic(diagnostic!, inspection))
			.toBe(mystery.nodeId)
		expect(inspection.getNode(inspection.rootNodeId)!.sourceSlots)
			.toEqual(expect.arrayContaining([
				expect.objectContaining({
					name: 'sidebar',
					placement: 'raw-slot',
					children: expect.arrayContaining([orphan.nodeId]),
				}),
			]))
		const rawSlotDiagnostic = blueprint.diagnostics.find(candidate => 'path' in candidate
			&& candidate.path.join('.') === 'slots.sidebar')
		expect(rawSlotDiagnostic)
			.toBeDefined()
		expect(inspectionNodeIdOfDiagnostic(rawSlotDiagnostic!, inspection))
			.toBe(inspection.rootNodeId)
	})

	it('does not invent a node for a source-level Core diagnostic', () => {
		const blueprint = sandboxSystem.createBlueprint(Symbol('incompatible-source'))
		const inspection = inspectBlueprint(blueprint)
		const diagnostic = blueprint.diagnostics.find(candidate => candidate.location.type === 'source')

		expect(blueprint.sourceJsonCompatible)
			.toBe(false)
		expect(diagnostic)
			.toBeDefined()
		expect(inspectionNodeIdOfDiagnostic(diagnostic!, inspection))
			.toBeNull()
		expect(inspectionNodeIdOfLocation(diagnostic!.location, inspection))
			.toBeNull()
	})

	it('navigates a semantic invalid diagnostic to its current Document node only', () => {
		const blueprint = sandboxSystem.createBlueprint(JSON.parse(invalidSource))
		const inspection = inspectBlueprint(blueprint)
		const diagnostic = blueprint.diagnostics.find(candidate => candidate.location.type === 'property')

		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.sourceJsonCompatible)
			.toBe(true)
		expect(diagnostic)
			.toBeDefined()
		expect(inspectionNodeIdOfDiagnostic(diagnostic!, inspection))
			.toBe(
				inspection.nodes.find(node => sourceIdOf(node) === 'summary-1')!.nodeId,
			)
	})
})

describe('lab-owned syntax state versus Core Blueprint state', () => {
	it('keeps JSON.parse syntax errors separate from semantic diagnostics and Core JSON compatibility', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		session.setDraftSourceText('{')
		const parseOutcome = await session.apply()

		expect(parseOutcome.status)
			.toBe('parse-error')
		expect(session.parseError).not.toBeNull()
		expect(session.documentState.blueprint.sourceJsonCompatible)
			.toBe(true)
		expect(session.documentState.blueprint.diagnostics)
			.toEqual([])

		await session.applyPreset(invalidSource)

		expect(session.parseError)
			.toBeNull()
		expect(session.documentState.blueprint.sourceJsonCompatible)
			.toBe(true)
		expect(session.documentState.blueprint.status)
			.toBe('invalid')
		expect(session.documentState.blueprint.diagnostics.length)
			.toBeGreaterThan(0)
	})

	it('moves diagnostic navigation through Document focus without leaking into retained Preview focus', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const focusStore = createInspectorFocusStore(session)
		const initialPreviewFocus = focusStore.getScopedFocus('preview')
		await session.applyPreset(recoverySource)

		const inspection = inspectBlueprint(session.documentState.blueprint)
		const diagnostic = session.documentState.blueprint.diagnostics.find(candidate => candidate.location.type === 'widget'
			&& inspection.getNodeId(candidate.location.node) === inspection.nodes.find(node => sourceIdOf(node) === 'mystery-1')!.nodeId)!
		const nodeId = inspectionNodeIdOfDiagnostic(diagnostic, inspection)!
		focusStore.setFocus('document', { nodeId })

		expect(focusStore.getScopedFocus('document')?.scope)
			.toBe('document')
		expect(focusStore.getScopedFocus('document')?.nodeId)
			.toBe(nodeId)
		expect(focusStore.getScopedFocus('preview'))
			.toEqual(initialPreviewFocus)
		focusStore.dispose()
		session.preview?.runtime.dispose()
	})
})
