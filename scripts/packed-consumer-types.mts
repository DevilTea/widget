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
import type { CreateInspectorAgentOptions, InspectorAgent } from '@deviltea/widget-inspector/agent'
import type { InspectAnchorAttributes } from '@deviltea/widget-inspector/anchor'
import type { MessagePortChannelHub } from '@deviltea/widget-inspector/channel'
import type { InspectorClient } from '@deviltea/widget-inspector/client'
import type { InspectorFrameBootstrapRequest } from '@deviltea/widget-inspector/frame-bootstrap'
import type { InspectorProtocolError, InspectorRequestMessage, WidgetRef } from '@deviltea/widget-inspector/protocol'
import type { InspectorTransport } from '@deviltea/widget-inspector/transport'
import type { InspectableValue } from '@deviltea/widget-inspector/value'
import type {
	ReadonlyRef,
	UseWidgetConfigAccessor,
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
	WidgetSlotChildComponent,
	WidgetSlotComponent,
	WidgetSlotScope,
	WidgetVueIntegrationError,
	WidgetVueRenderer,
	WidgetVueRendererEntry,
	WidgetVueRendererProps,
	WidgetVueRendererSection,
	WidgetVueRendererSectionMarker,
} from '@deviltea/widget-vue'
import type { WidgetTestRenderers } from '@deviltea/widget-vue/testing'

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
	readonly inspector: {
		readonly agent: InspectorAgent
		readonly agentOptions: CreateInspectorAgentOptions
		readonly anchor: InspectAnchorAttributes
		readonly channel: MessagePortChannelHub
		readonly client: InspectorClient
		readonly frameBootstrap: InspectorFrameBootstrapRequest
		readonly protocolError: InspectorProtocolError
		readonly request: InspectorRequestMessage
		readonly transport: InspectorTransport
		readonly value: InspectableValue
		readonly widgetRef: WidgetRef
	}
	readonly vue: {
		readonly ref: ReadonlyRef<unknown>
		readonly renderer: WidgetVueRenderer<AnyWidgetPluginTuple>
		readonly rendererEntry: WidgetVueRendererEntry<AnyWidgetPluginTuple>
		readonly rendererProps: WidgetVueRendererProps<AnyWidgetPluginTuple>
		readonly rendererSection: WidgetVueRendererSection<string>
		readonly rendererSectionMarker: WidgetVueRendererSectionMarker<string>
		readonly configAccessor: UseWidgetConfigAccessor<WidgetInterfaces>
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
		readonly slotChildComponent: WidgetSlotChildComponent
		readonly slotComponent: WidgetSlotComponent<string>
		readonly slotScope: WidgetSlotScope
		readonly stateAccessor: UseWidgetStateAccessor<WidgetInterfaces>
		readonly stateDiagnosticsAccessor: UseWidgetStateDiagnosticsAccessor<WidgetInterfaces>
		readonly stateDiagnosticsSurface: UseWidgetStateDiagnosticsSurface<WidgetInterfaces>
		readonly stateSurface: UseWidgetStateSurface<WidgetInterfaces>
	}
	readonly vueTesting: {
		readonly host: typeof import('@deviltea/widget-vue/testing').createWidgetTestHost
		readonly renderers: WidgetTestRenderers<AnyWidgetPluginTuple>
	}
}

const typeWitness: PublishedContracts | undefined = undefined
void typeWitness

// The Inspector has no root entry and its internal modules are not importable.
// @ts-expect-error -- `@deviltea/widget-inspector` exposes no root entry.
type RootEntry = typeof import('@deviltea/widget-inspector')
// @ts-expect-error -- `geometry` is internal.
type InternalGeometry = typeof import('@deviltea/widget-inspector/geometry')
// @ts-expect-error -- `projection` is internal.
type InternalProjection = typeof import('@deviltea/widget-inspector/projection')
// @ts-expect-error -- `validation` is internal.
type InternalValidation = typeof import('@deviltea/widget-inspector/validation')
// @ts-expect-error -- `overlay` is internal.
type InternalOverlay = typeof import('@deviltea/widget-inspector/overlay')
// @ts-expect-error -- `test-fixture` is internal.
type InternalTestFixture = typeof import('@deviltea/widget-inspector/test-fixture')
const unreachableBoundaryWitness: [RootEntry?, InternalGeometry?, InternalProjection?, InternalValidation?, InternalOverlay?, InternalTestFixture?] | undefined = undefined
void unreachableBoundaryWitness

// The registry defect lists are `readonly string[] | null`: non-null exactly for `invalid-renderer-registry`.
export function readRegistryDefects(error: WidgetVueIntegrationError): number {
	if (error.code === 'invalid-renderer-registry')
		return (error.missingTypes?.length ?? 0) + (error.unknownTypes?.length ?? 0) + (error.duplicateTypes?.length ?? 0) + (error.invalidTypes?.length ?? 0)
	return 0
}

// The private injection context and the internal modules are not importable.
// @ts-expect-error -- `context` is internal.
type InternalContext = typeof import('@deviltea/widget-vue/context')
// @ts-expect-error -- `runtime-guard` is internal.
type InternalRuntimeGuard = typeof import('@deviltea/widget-vue/runtime-guard')
const unreachableVueWitness: [InternalContext?, InternalRuntimeGuard?] | undefined = undefined
void unreachableVueWitness
