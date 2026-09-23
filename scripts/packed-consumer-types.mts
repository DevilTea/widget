import type {
	AnyWidgetPlugin,
	AnyWidgetPluginTuple,
	WidgetId,
	WidgetSystem,
} from '@deviltea/widget-core'
import type {
	BlueprintInspection,
	RuntimeInspection,
} from '@deviltea/widget-core/inspection'
import type { WidgetIntegrationEventEmitter } from '@deviltea/widget-core/integration'
import type {
	UseWidgetResult,
	WidgetVueRenderer,
	WidgetVueRendererProps,
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
		renderer: WidgetVueRenderer<AnyWidgetPluginTuple>
		props: WidgetVueRendererProps<AnyWidgetPluginTuple>
		widget: UseWidgetResult<AnyWidgetPlugin>
	}
}

const typeWitness: PublishedContracts | undefined = undefined
void typeWitness
