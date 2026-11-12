// @vitest-environment happy-dom
/**
 * Root `runtime` prop validation: a Runtime must be a Runtime produced by the same
 * `@deviltea/widget-core` instance this package imports (a foreign copy fails at mount, not at the
 * first `emit`), and a non-object `runtime` is a coded error, never a raw `TypeError`.
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { WidgetVueIntegrationError } from './errors'
import { createWidgetVueRenderer, useWidget } from './index'
import {
	ContainerRenderer,
	CounterRenderer,
	createFixtureRuntime,
	createOtherFixtureRuntime,
	EmptyStateRenderer,
	fixtureSystem,
	LabelRenderer,
	LeafRenderer,
} from './test-fixtures'

function capture(run: () => unknown): unknown {
	try {
		run()
	}
	catch (error) {
		return error
	}
	return undefined
}

const WidgetRenderer = createWidgetVueRenderer(fixtureSystem, renderers =>
	renderers
		.Counter(CounterRenderer)
		.Label(LabelRenderer)
		.Container(ContainerRenderer)
		.Leaf(LeafRenderer)
		.EmptyState(EmptyStateRenderer))

describe('root renderer runtime validation', () => {
	it('fails at mount with foreign-runtime when the Runtime comes from another @deviltea/widget-core copy', async () => {
		vi.resetModules()
		const foreignCore = await import('@deviltea/widget-core')
		const foreignPlugin = foreignCore.createWidgetPlugin('eventful')
			.description('Eventful')
			.interfaces<{ events: { change: [value: string] } }>()
			.events(events => events.change({ description: 'Changed' }))
			.done()
		const foreignSystem = foreignCore.createWidgetSystem({ plugins: [foreignPlugin] as const })
		const blueprint = foreignSystem.createBlueprint({ id: 'root', type: 'eventful' })
		if (blueprint.status !== 'valid')
			throw new Error('Expected valid blueprint')
		const foreignRuntime = blueprint.createRuntime()

		const ForeignRenderer = createWidgetVueRenderer(foreignSystem, renderers =>
			renderers.eventful(defineComponent({
				setup() {
					useWidget(foreignPlugin)
					return () => h('div')
				},
			})))

		const thrown = capture(() => mount(ForeignRenderer, { props: { runtime: foreignRuntime } }))

		expect(thrown)
			.toBeInstanceOf(WidgetVueIntegrationError)
		expect((thrown as WidgetVueIntegrationError).code)
			.toBe('foreign-runtime')
		expect((thrown as WidgetVueIntegrationError).message)
			.toContain('two copies of @deviltea/widget-core')
	})

	it('rejects a structural look-alike Runtime with foreign-runtime before reading it', () => {
		const real = createFixtureRuntime({ id: 'root', type: 'Counter' })
		const lookAlike = { blueprint: real.blueprint, getWidget: real.getWidget }

		const thrown = capture(() => mount(WidgetRenderer, { props: { runtime: lookAlike as never } }))

		expect(thrown)
			.toBeInstanceOf(WidgetVueIntegrationError)
		expect((thrown as WidgetVueIntegrationError).code)
			.toBe('foreign-runtime')
	})

	it.each([null, undefined, 'runtime', 42])('rejects the non-object runtime %j with the invalid-runtime code', (runtime) => {
		const warn = vi.spyOn(console, 'warn')
			.mockImplementation(() => {})
		const thrown = capture(() => mount(WidgetRenderer, { props: { runtime: runtime as never } }))
		warn.mockRestore()

		expect(thrown)
			.toBeInstanceOf(WidgetVueIntegrationError)
		expect((thrown as WidgetVueIntegrationError).code)
			.toBe('invalid-runtime')
		expect((thrown as WidgetVueIntegrationError).missingTypes)
			.toBeNull()
	})

	it('still reports runtime-system-mismatch for a genuine Runtime of another System', () => {
		const runtime = createOtherFixtureRuntime({ id: 'root', type: 'Counter' })

		const thrown = capture(() => mount(WidgetRenderer, { props: { runtime } }))

		expect((thrown as WidgetVueIntegrationError).code)
			.toBe('runtime-system-mismatch')
	})
})
