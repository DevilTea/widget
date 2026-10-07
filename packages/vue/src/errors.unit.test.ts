// @vitest-environment happy-dom
/**
 * Conformance tests for the stable `WidgetVueIntegrationError` codes (#170). Consumers discriminate by
 * class and `code`; these tests never assert message text.
 */

import { createWidgetPlugin } from '@deviltea/widget-core'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { createWidgetVueRenderer, useWidget, WidgetVueIntegrationError } from './index'
import { SharedWidgetSlotComponent } from './renderer'
import {
	ContainerPlugin,
	ContainerRenderer,
	CounterPlugin,
	CounterRenderer,
	createFixtureRuntime,
	createOtherFixtureRuntime,
	EmptyStateRenderer,
	fixtureSystem,
	LabelRenderer,
	LeafRenderer,
	mountWidgetBridge,
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

function expectCode(error: unknown, code: string): asserts error is WidgetVueIntegrationError {
	expect(error)
		.toBeInstanceOf(WidgetVueIntegrationError)
	expect((error as WidgetVueIntegrationError).code)
		.toBe(code)
}

function expectNullRegistryFields(error: WidgetVueIntegrationError): void {
	expect(error.missingTypes)
		.toBeNull()
	expect(error.unknownTypes)
		.toBeNull()
	expect(error.duplicateTypes)
		.toBeNull()
}

const WidgetRenderer = createWidgetVueRenderer(fixtureSystem, renderers =>
	renderers
		.Counter(CounterRenderer)
		.Label(LabelRenderer)
		.Container(ContainerRenderer)
		.Leaf(LeafRenderer)
		.EmptyState(EmptyStateRenderer))

describe('widgetVueIntegrationError codes', () => {
	describe('invalid-renderer-registry', () => {
		function registryError(register: (renderers: Record<string, (component: unknown) => unknown>) => void): WidgetVueIntegrationError {
			const error = capture(() => createWidgetVueRenderer(fixtureSystem, (renderers) => {
				register(renderers as unknown as Record<string, (component: unknown) => unknown>)
				return undefined as never
			}))
			expectCode(error, 'invalid-renderer-registry')
			return error
		}

		it('reports a missing renderer in missingTypes only', () => {
			const error = registryError((r) => {
				r.Counter!(CounterRenderer)
				r.Label!(LabelRenderer)
				r.Container!(ContainerRenderer)
				r.Leaf!(LeafRenderer)
			})

			expect(error.missingTypes)
				.toEqual(['EmptyState'])
			expect(error.unknownTypes)
				.toEqual([])
			expect(error.duplicateTypes)
				.toEqual([])
		})

		it('reports an unknown renderer in unknownTypes only', () => {
			const error = registryError((r) => {
				r.Counter!(CounterRenderer)
				r.Label!(LabelRenderer)
				r.Container!(ContainerRenderer)
				r.Leaf!(LeafRenderer)
				r.EmptyState!(EmptyStateRenderer)
				r.NotReal!(CounterRenderer)
			})

			expect(error.missingTypes)
				.toEqual([])
			expect(error.unknownTypes)
				.toEqual(['NotReal'])
			expect(error.duplicateTypes)
				.toEqual([])
		})

		it('reports a duplicate renderer in duplicateTypes only', () => {
			const error = registryError((r) => {
				r.Counter!(CounterRenderer)
				r.Counter!(CounterRenderer)
				r.Label!(LabelRenderer)
				r.Container!(ContainerRenderer)
				r.Leaf!(LeafRenderer)
				r.EmptyState!(EmptyStateRenderer)
			})

			expect(error.missingTypes)
				.toEqual([])
			expect(error.unknownTypes)
				.toEqual([])
			expect(error.duplicateTypes)
				.toEqual(['Counter'])
		})

		it('reports every defect together, with missing in System plugin order and unknown/duplicate in first-registration order', () => {
			// System plugin order: Counter, Label, Container, Leaf, EmptyState.
			const error = registryError((r) => {
				r.Label!(LabelRenderer)
				r.Zulu!(CounterRenderer)
				r.Counter!(CounterRenderer)
				r.Alpha!(CounterRenderer)
				r.Label!(LabelRenderer)
				r.Counter!(CounterRenderer)
				r.Zulu!(CounterRenderer)
			})

			expect(error.missingTypes)
				.toEqual(['Container', 'Leaf', 'EmptyState'])
			expect(error.unknownTypes)
				.toEqual(['Zulu', 'Alpha'])
			// An unknown type is never also reported as a duplicate; Label precedes Counter here because it
			// was registered first, although Counter precedes Label in the System.
			expect(error.duplicateTypes)
				.toEqual(['Label', 'Counter'])
		})

		it('reports an empty registry as every System plugin type missing', () => {
			const error = registryError(() => {})

			expect(error.missingTypes)
				.toEqual(['Counter', 'Label', 'Container', 'Leaf', 'EmptyState'])
			expect(error.unknownTypes)
				.toEqual([])
			expect(error.duplicateTypes)
				.toEqual([])
		})

		it('exposes frozen arrays, including empty ones', () => {
			const error = registryError((r) => {
				r.Counter!(CounterRenderer)
			})

			for (const list of [error.missingTypes, error.unknownTypes, error.duplicateTypes]) {
				expect(Object.isFrozen(list))
					.toBe(true)
			}
			expect(error.unknownTypes)
				.toEqual([])
		})

		it('keeps the class name stable', () => {
			const error = registryError(() => {})

			expect(error.name)
				.toBe('WidgetVueIntegrationError')
		})
	})

	describe('runtime-system-mismatch', () => {
		it('rejects a Runtime created from a different System instance, with null registry fields', () => {
			const runtime = createOtherFixtureRuntime({ id: 'root', type: 'Counter' })

			const error = capture(() => mount(WidgetRenderer, { props: { runtime } }))

			expectCode(error, 'runtime-system-mismatch')
			expectNullRegistryFields(error)
		})

		it('checks System identity before looking up the root widget', () => {
			const runtime = {
				blueprint: { system: {}, root: { id: 'root' } },
				getWidget: () => null,
			}

			const error = capture(() => mount(WidgetRenderer, { props: { runtime: runtime as never } }))

			expectCode(error, 'runtime-system-mismatch')
		})
	})

	describe('outside-widget-renderer', () => {
		it('is thrown by useWidget() inside a component with no widget host', () => {
			const Rogue = defineComponent({
				setup() {
					useWidget(ContainerPlugin)
					return () => null
				},
			})

			const error = capture(() => mount(Rogue))

			expectCode(error, 'outside-widget-renderer')
			expectNullRegistryFields(error)
		})

		it('is thrown by useWidget() with no active component instance at all', () => {
			const error = capture(() => useWidget(CounterPlugin))

			expectCode(error, 'outside-widget-renderer')
		})

		it('is thrown by the shared WidgetSlot component mounted with no widget host', () => {
			const error = capture(() => mount(SharedWidgetSlotComponent, { props: { name: 'header' } }))

			expectCode(error, 'outside-widget-renderer')
			expectNullRegistryFields(error)
		})
	})

	describe('widget-plugin-mismatch', () => {
		it('is thrown when useWidget() receives a different plugin instance than the current widget', () => {
			const runtime = createFixtureRuntime({ id: 'mismatch', type: 'Counter' })

			const error = capture(() => mountWidgetBridge(runtime, 'mismatch', ContainerPlugin))

			expectCode(error, 'widget-plugin-mismatch')
			expectNullRegistryFields(error)
		})

		it('is thrown for a distinct plugin instance that has the same type string', () => {
			const impostor = createWidgetPlugin('Counter')
				.description('Impostor counter widget')
				.interfaces<Record<never, never>>()
				.done()
			const runtime = createFixtureRuntime({ id: 'impostor', type: 'Counter' })

			const error = capture(() => mountWidgetBridge(runtime, 'impostor', impostor))

			expectCode(error, 'widget-plugin-mismatch')
		})

		it('is surfaced unchanged through a mounted renderer tree', () => {
			const Broken = defineComponent({
				setup() {
					useWidget(ContainerPlugin)
					return () => null
				},
			})
			const Mismatched = createWidgetVueRenderer(fixtureSystem, renderers =>
				renderers
					.Counter(Broken)
					.Label(LabelRenderer)
					.Container(ContainerRenderer)
					.Leaf(LeafRenderer)
					.EmptyState(EmptyStateRenderer))
			const runtime = createFixtureRuntime({ id: 'tree', type: 'Counter' })

			const error = capture(() => mount(Mismatched, { props: { runtime } }))

			expectCode(error, 'widget-plugin-mismatch')
		})
	})

	describe('readonly-projection-write', () => {
		it('is thrown when a Property ref is written', () => {
			const runtime = createFixtureRuntime({ id: 'p', type: 'Counter' })
			const { bridge } = mountWidgetBridge(runtime, 'p', CounterPlugin)
			const { doubled } = bridge.useProperties()

			const error = capture(() => {
				// @ts-expect-error `doubled` is a `ReadonlyRef`; this reaches the runtime guard behind it.
				doubled.value = 1
			})

			expectCode(error, 'readonly-projection-write')
			expectNullRegistryFields(error)
		})

		it('is thrown when a Diagnostics ref is written', () => {
			const runtime = createFixtureRuntime({ id: 'd', type: 'Counter' })
			const { bridge } = mountWidgetBridge(runtime, 'd', CounterPlugin)
			const { count } = bridge.useStateDiagnostics()

			const error = capture(() => {
				// @ts-expect-error `count` is a `ReadonlyRef`; this reaches the runtime guard behind it.
				count.value = []
			})

			expectCode(error, 'readonly-projection-write')
			expectNullRegistryFields(error)
		})

		it('is thrown for the widget-level aggregate Diagnostics ref', () => {
			const runtime = createFixtureRuntime({ id: 'agg', type: 'Counter' })
			const { bridge } = mountWidgetBridge(runtime, 'agg', CounterPlugin)
			const diagnostics = bridge.useDiagnostics()

			const error = capture(() => {
				// @ts-expect-error `diagnostics` is a `ReadonlyRef`; this reaches the runtime guard behind it.
				diagnostics.value = []
			})

			expectCode(error, 'readonly-projection-write')
		})
	})
})
