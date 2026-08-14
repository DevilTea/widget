import type { RuntimeWidgetFor, WidgetSystemRuntime } from '@deviltea/widget-core'
import type { CounterPlugin, SandboxPlugins, SummaryPlugin } from './plugins'
import { describe, expect, it } from 'vitest'
import { sandboxPresets } from './presets'
import { sandboxSystem } from './system'

function narrowWidget<Plugin extends SandboxPlugins[number]>(
	runtime: WidgetSystemRuntime<SandboxPlugins>,
	id: string,
	type: Plugin['type'],
): RuntimeWidgetFor<Plugin, SandboxPlugins> {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== type)
		throw new Error(`fixture setup error: expected widget "${id}" of type "${type}"`)
	return widget as unknown as RuntimeWidgetFor<Plugin, SandboxPlugins>
}

describe('sandbox presets', () => {
	it.each(sandboxPresets)('$id: parses as JSON and compiles to the documented Blueprint status', (preset) => {
		const definition: unknown = JSON.parse(preset.sourceText)
		const blueprint = sandboxSystem.createBlueprint(definition)
		const expectedStatus = preset.id === 'valid-interactive' ? 'valid' : 'invalid'
		expect(blueprint.status)
			.toBe(expectedStatus)
	})

	it('valid-interactive preset creates a working Runtime with a live cross-widget dependency (Summary -> Counter)', () => {
		const preset = sandboxPresets.find(candidate => candidate.id === 'valid-interactive')!
		const blueprint = sandboxSystem.createBlueprint(JSON.parse(preset.sourceText))
		if (blueprint.status !== 'valid')
			throw new Error('fixture setup error: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		try {
			const counter = narrowWidget<typeof CounterPlugin>(runtime, 'counter-1', 'Counter')
			const summary = narrowWidget<typeof SummaryPlugin>(runtime, 'summary-1', 'Summary')

			expect(summary.properties.total.get())
				.toEqual({ success: true, value: 0 })

			counter.methods.increment(3)

			expect(summary.properties.total.get())
				.toEqual({ success: true, value: 6 })
		}
		finally {
			runtime.dispose()
		}
	})

	it('invalid-semantic preset resolves every node but reports an invalid dependency on Summary', () => {
		const preset = sandboxPresets.find(candidate => candidate.id === 'invalid-semantic')!
		const blueprint = sandboxSystem.createBlueprint(JSON.parse(preset.sourceText))
		expect(blueprint.status)
			.toBe('invalid')

		const summaryNode = blueprint.getWidget('summary-1')
		expect(summaryNode).not.toBeNull()
		expect(summaryNode!.resolved)
			.toBe(true)
		expect(summaryNode!.getIssues().length)
			.toBeGreaterThan(0)
	})

	it('raw-slot-recovery preset recovers an unresolved node and a raw-slot placement', () => {
		const preset = sandboxPresets.find(candidate => candidate.id === 'raw-slot-recovery')!
		const blueprint = sandboxSystem.createBlueprint(JSON.parse(preset.sourceText))
		expect(blueprint.status)
			.toBe('invalid')

		const mystery = blueprint.getWidget('mystery-1')
		expect(mystery).not.toBeNull()
		expect(mystery!.resolved)
			.toBe(false)

		const orphan = blueprint.getWidget('orphan-1')
		expect(orphan).not.toBeNull()
		const location = blueprint.getLocation(orphan!)
		expect(location).not.toBeNull()
		expect(location!.type)
			.toBe('raw-slot')
	})
})
