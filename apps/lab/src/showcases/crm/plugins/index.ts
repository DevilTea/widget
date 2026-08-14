/**
 * The fourteen Showcase B ("Interactive Product Prototype") plugins (checkpoint §2), as one tuple for
 * `createWidgetSystem` (see `../system.ts`). Split into reusable-style Lab-private primitives
 * (`structural.ts`, `inputs.ts`, `read-models.ts`, `actions.ts`) and CRM-domain semantic widgets
 * (`deal-store.ts`, `deal-query.ts`, `deal-stage-form.ts`) — design evidence only, no public
 * shared-widget contract (checkpoint §2).
 */

import { ButtonPlugin, ModalPlugin } from './actions'
import { DealQueryPlugin } from './deal-query'
import { DealStageFormPlugin } from './deal-stage-form'
import { DealStorePlugin } from './deal-store'
import { SelectInputPlugin, TextInputPlugin } from './inputs'
import { BarChartPlugin, DetailPanelPlugin, MetricCardPlugin, TablePlugin } from './read-models'
import { AppShellPlugin, CardPlugin, ToolbarPlugin } from './structural'

export * from './actions'
export * from './deal-query'
export * from './deal-stage-form'
export * from './deal-store'
export * from './inputs'
export * from './read-models'
export * from './structural'

export const crmPlugins = [
	AppShellPlugin,
	ToolbarPlugin,
	CardPlugin,
	TextInputPlugin,
	SelectInputPlugin,
	MetricCardPlugin,
	TablePlugin,
	DetailPanelPlugin,
	BarChartPlugin,
	ButtonPlugin,
	ModalPlugin,
	DealStorePlugin,
	DealQueryPlugin,
	DealStageFormPlugin,
] as const

export type CrmPlugins = typeof crmPlugins
