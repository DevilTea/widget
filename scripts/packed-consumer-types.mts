import type {
	AnyWidgetPlugin,
	AnyWidgetPluginTuple,
	WidgetId,
	WidgetInterfaces,
	WidgetSystem,
} from '@deviltea/widget-core'
import type {
	BlueprintInspection,
	RuntimeInspection,
} from '@deviltea/widget-core/inspection'
import type { WidgetIntegrationEventEmitter } from '@deviltea/widget-core/integration'
import type {
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
	WidgetVueRenderer,
	WidgetVueRendererEntry,
	WidgetVueRendererProps,
	WidgetVueRendererSection,
	WidgetVueRendererSectionMarker,
} from '@deviltea/widget-vue'

interface PublishedContracts {
	readonly root: {
		id: WidgetId
		plugin: AnyWidgetPlugin
		system: WidgetSystem
	}
	readonly inspection: {
		blueprint: BlueprintInspection
		runtime: RuntimeInspection
	}
	readonly integration: WidgetIntegrationEventEmitter
	readonly vue: {
		readonly ref: ReadonlyRef<unknown>
		readonly renderer: WidgetVueRenderer<AnyWidgetPluginTuple>
		readonly rendererEntry: WidgetVueRendererEntry<AnyWidgetPluginTuple>
		readonly rendererProps: WidgetVueRendererProps<AnyWidgetPluginTuple>
		readonly rendererSection: WidgetVueRendererSection<string>
		readonly rendererSectionMarker: WidgetVueRendererSectionMarker<string>
		readonly diagnosticsAccessor: UseWidgetDiagnosticsAccessor
		readonly eventEmitterAccessor: UseWidgetEventEmitterAccessor<WidgetInterfaces>
		readonly identityAccessor: UseWidgetIdentityAccessor<AnyWidgetPlugin>
		readonly methodDiagnosticsAccessor: UseWidgetMethodDiagnosticsAccessor<WidgetInterfaces>
		readonly methodDiagnosticsSurface: UseWidgetMethodDiagnosticsSurface<WidgetInterfaces>
		readonly methodsAccessor: UseWidgetMethodsAccessor<WidgetInterfaces>
		readonly methodsSurface: UseWidgetMethodsSurface<WidgetInterfaces>
		readonly propertiesAccessor: UseWidgetPropertiesAccessor<WidgetInterfaces>
		readonly propertiesSurface: UseWidgetPropertiesSurface<WidgetInterfaces>
		readonly propertyDiagnosticsAccessor: UseWidgetPropertyDiagnosticsAccessor<WidgetInterfaces>
		readonly propertyDiagnosticsSurface: UseWidgetPropertyDiagnosticsSurface<WidgetInterfaces>
		readonly result: UseWidgetResult<AnyWidgetPlugin>
		readonly slotAccessor: UseWidgetSlotAccessor<WidgetInterfaces>
		readonly slotComponent: WidgetSlotComponent<string>
		readonly stateAccessor: UseWidgetStateAccessor<WidgetInterfaces>
		readonly stateDiagnosticsAccessor: UseWidgetStateDiagnosticsAccessor<WidgetInterfaces>
		readonly stateDiagnosticsSurface: UseWidgetStateDiagnosticsSurface<WidgetInterfaces>
		readonly stateSurface: UseWidgetStateSurface<WidgetInterfaces>
	}
}

const typeWitness: PublishedContracts | undefined = undefined
void typeWitness
