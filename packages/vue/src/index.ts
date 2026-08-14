/**
 * `@deviltea/widget-vue` public contract.
 *
 * A thin Vue 3 integration over `@deviltea/widget-core` Runtime semantics. The normative semantic
 * contract lives in GitHub issue #13 ("Widget Vue integration — Phase 3 decision log"); issue #10
 * ("Widget composition core architecture — canonical decision log") remains the core semantic
 * authority and is never reimplemented or reinterpreted here.
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
	UseWidgetIssuesAccessor,
	UseWidgetMethodIssuesAccessor,
	UseWidgetMethodIssuesSurface,
	UseWidgetMethodsAccessor,
	UseWidgetMethodsSurface,
	UseWidgetPropertiesAccessor,
	UseWidgetPropertiesSurface,
	UseWidgetPropertyIssuesAccessor,
	UseWidgetPropertyIssuesSurface,
	UseWidgetResult,
	UseWidgetSlotAccessor,
	UseWidgetStateAccessor,
	UseWidgetStateIssuesAccessor,
	UseWidgetStateIssuesSurface,
	UseWidgetStateSurface,
	WidgetSlotComponent,
} from './types'

export { useWidget } from './use-widget'
