// @vitest-environment happy-dom
/**
 * Smoke test for the public entry point: every re-export actually resolves to the real
 * implementation, exercised end to end through the package's own public surface (never an internal
 * module path).
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createWidgetVueRenderer, useWidget, WidgetVueIntegrationError } from './index'
import {
	ContainerRenderer,
	CounterPlugin,
	CounterRenderer,
	createFixtureRuntime,
	EmptyStateRenderer,
	fixtureSystem,
	LabelRenderer,
	LeafRenderer,
} from './test-fixtures'

describe('public entry point', () => {
	it('re-exports a working createWidgetVueRenderer that mounts and renders through the real registry/host tree', () => {
		const WidgetRenderer = createWidgetVueRenderer(fixtureSystem, renderers =>
			renderers
				.Counter(CounterRenderer)
				.Label(LabelRenderer)
				.Container(ContainerRenderer)
				.Leaf(LeafRenderer)
				.EmptyState(EmptyStateRenderer))

		const runtime = createFixtureRuntime({ id: 'root', type: 'Counter' })
		const wrapper = mount(WidgetRenderer, { props: { runtime } })
		expect(wrapper.element.classList.contains('counter'))
			.toBe(true)
	})

	it('re-exports a working useWidget/WidgetVueIntegrationError pair', () => {
		expect(() => useWidget(CounterPlugin))
			.toThrow(WidgetVueIntegrationError)
	})
})
