/**
 * `@deviltea/widget-vue` public contract.
 *
 * A thin Vue 3 integration over `@deviltea/widget-core` Runtime semantics. Current Widget architecture
 * authority lives in `DevilTea/widget` Discussion #12, including the migrated historical Vue integration
 * and Core decision logs. Core semantics remain authoritative and are never reimplemented or reinterpreted here.
 */

export { WidgetVueIntegrationError } from './errors'

export { createWidgetVueRenderer } from './renderer'

export type {
	WidgetVueRenderer,
	WidgetVueRendererEntry,
	WidgetVueRendererProps,
	WidgetVueRendererSection,
	WidgetVueRendererSectionMarker,
} from './renderer'

export type {
	ReadonlyRef,
	UseWidgetDiagnosticsAccessor,
	UseWidgetEventEmitterAccessor,
	UseWidgetIdentityAccessor,
	UseWidgetMethodDiagnosticsAccessor,
	UseWidgetMethodDiagnosticsSurface,
	UseWidgetMethodsAccessor,
	UseWidgetMethodsSurface,
	UseWidgetPropertiesAccessor,
	UseWidgetPropertiesSurface,
	UseWidgetPropertyDiagnosticsAccessor,
	UseWidgetPropertyDiagnosticsSurface,
	UseWidgetResult,
	UseWidgetSlotAccessor,
	UseWidgetStateAccessor,
	UseWidgetStateDiagnosticsAccessor,
	UseWidgetStateDiagnosticsSurface,
	UseWidgetStateSurface,
	WidgetSlotComponent,
} from './types'

export { useWidget } from './use-widget'
