import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { resolvePreviewInspectResolution, resolveWidgetFocus } from './inspect-focus'
import { LabSession } from './session'

const validSource = sandboxPresets.find(preset => preset.id === 'valid-interactive')!.sourceText

describe('resolveWidgetFocus', () => {
	it('resolves the widget-level focus (no member) for the root widget id', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const blueprint = session.active.blueprint
		const inspection = inspectBlueprint(blueprint)

		const focus = resolveWidgetFocus(blueprint, 'root')

		expect(focus)
			.toEqual({ nodeId: inspection.rootNodeId })
		expect(focus?.member)
			.toBeUndefined()
	})

	it('resolves a non-root widget id to the exact node inspection independently reports for it', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const blueprint = session.active.blueprint
		const inspection = inspectBlueprint(blueprint)

		const focus = resolveWidgetFocus(blueprint, 'counter-1')

		expect(focus)
			.not.toBeNull()
		const node = inspection.getNode(focus!.nodeId)
		expect(node?.resolved)
			.toBe(true)
		expect(node!.resolved && node!.node.id)
			.toBe('counter-1')
		expect(node!.resolved && node!.node.type)
			.toBe('Counter')
	})

	it('returns null for a widget id that does not exist in this Blueprint snapshot', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const blueprint = session.active.blueprint

		expect(resolveWidgetFocus(blueprint, 'does-not-exist'))
			.toBeNull()
	})
})

describe('resolvePreviewInspectResolution', () => {
	it('keeps linked Preview inspection in the shared Blueprint navigation path', () => {
		const blueprint = sandboxSystem.createBlueprint(JSON.parse(validSource))
		const resolution = resolvePreviewInspectResolution(blueprint, 'counter-1', true)

		expect(resolution?.scope)
			.toBe('preview')
		expect(resolution?.targetTab)
			.toBe('blueprint')
		expect(resolution?.focus)
			.toEqual(resolveWidgetFocus(blueprint, 'counter-1'))
	})

	it('keeps diverged Preview inspection in Runtime and never asks for Document focus', () => {
		const blueprint = sandboxSystem.createBlueprint(JSON.parse(validSource))
		const resolution = resolvePreviewInspectResolution(blueprint, 'counter-1', false)

		expect(resolution)
			.toEqual({
				focus: resolveWidgetFocus(blueprint, 'counter-1'),
				scope: 'preview',
				targetTab: 'runtime',
			})
	})

	it('returns null for an anchor that is not present in the Preview Blueprint', () => {
		const blueprint = sandboxSystem.createBlueprint(JSON.parse(validSource))
		expect(resolvePreviewInspectResolution(blueprint, 'missing', false))
			.toBeNull()
	})
})
