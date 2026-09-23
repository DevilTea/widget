import { describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'
import { inspectBlueprint, inspectRuntime } from './index'

interface EventInspectionInterfaces {
	methods: {
		fire: (value: string) => void
	}
	events: {
		change: [value: string]
		ping: []
	}
}

const plugin = createWidgetPlugin('inspection-events')
	.description('Inspection event fixture')
	.interfaces<EventInspectionInterfaces>()
	.methods(methods => methods.fire({
		validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
		execute: ({ args, emit }) => emit.change(args[0]),
	}))
	.events(events => events
		.change({ description: 'Changed value' })
		.ping({ description: 'Ping occurrence' }))
	.done()

const noEventsPlugin = createWidgetPlugin('inspection-no-events')
	.description('Inspection event-less fixture')
	.interfaces<{ state: { value: number } }>()
	.state(state => state.value({
		validate: (input): input is number => typeof input === 'number',
	}))
	.done()

function createHarness() {
	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'inspection-events' })
	if (blueprint.status !== 'valid')
		throw new Error('Expected valid blueprint')
	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')
	if (widget === null)
		throw new Error('Expected runtime widget')
	return { blueprint, runtime, widget }
}

describe('event inventory and readonly Runtime inspection', () => {
	it('projects event capability, names and descriptions without inventing parameter metadata', () => {
		const { blueprint } = createHarness()
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)
		if (root === null || !root.resolved)
			throw new Error('Expected resolved inspection root')
		expect(root.capabilities.events)
			.toBe(true)
		expect(root.events)
			.toEqual([
				{ type: 'event', name: 'change', description: 'Changed value' },
				{ type: 'event', name: 'ping', description: 'Ping occurrence' },
			])
		expect(root.events[0]).not.toHaveProperty('args')
		expect(root.events[0]).not.toHaveProperty('schema')
	})

	it('projects no Events declaration as an empty event inventory', () => {
		const system = createWidgetSystem({ plugins: [noEventsPlugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'inspection-no-events' })
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)
		if (root === null || !root.resolved)
			throw new Error('Expected resolved inspection root')

		expect(root.capabilities.events)
			.toBe(false)
		expect(root.events)
			.toEqual([])
	})

	it('exposes occurrence subscription only and no emit authority', () => {
		const { runtime } = createHarness()
		const inspection = inspectRuntime(runtime)
		const widgetInspection = inspection.getWidget(inspection.blueprint.rootNodeId)!
		const event = widgetInspection.getEvent('change')
		expect(event).not.toBeNull()
		expect(event)
			.toHaveProperty('subscribe')
		expect(event).not.toHaveProperty('emit')
		expect(event).not.toHaveProperty('getSnapshot')
		expect(widgetInspection.getEvent('missing'))
			.toBeNull()
	})

	it('observes each actual event occurrence with a frozen tuple envelope', () => {
		const { runtime, widget } = createHarness()
		const inspection = inspectRuntime(runtime)
		const event = inspection.getWidget(inspection.blueprint.rootNodeId)!.getEvent('change')!
		const occurrences: readonly unknown[][] = []
		const listener = vi.fn((args: readonly unknown[]) => {
			;(occurrences as unknown as (readonly unknown[])[]).push(args)
		})
		event.subscribe(listener)
		widget.methods.fire('hello')
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(occurrences[0])
			.toEqual(['hello'])
		expect(Object.isFrozen(occurrences[0]))
			.toBe(true)
	})

	it('observes nested emissions in depth-first call order', () => {
		const { runtime, widget } = createHarness()
		const inspection = inspectRuntime(runtime)
		const event = inspection.getWidget(inspection.blueprint.rootNodeId)!.getEvent('change')!
		const order: string[] = []
		event.subscribe(([value]) => {
			order.push(String(value))
			if (value === 'outer')
				widget.methods.fire('inner')
		})
		widget.methods.fire('outer')
		expect(order)
			.toEqual(['outer', 'inner'])
	})

	it('keeps occurrence subscriptions Runtime-scoped and rejects new subscriptions after dispose', () => {
		const { runtime } = createHarness()
		const inspection = inspectRuntime(runtime)
		const event = inspection.getWidget(inspection.blueprint.rootNodeId)!.getEvent('change')!
		const unsubscribe = event.subscribe(() => {})
		runtime.dispose()
		expect(() => unsubscribe()).not.toThrow()
		expect(() => event.subscribe(() => {}))
			.toThrow(WidgetSystemRuntimeDisposedError)
	})
})
