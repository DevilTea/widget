/**
 * CRM ("Interactive Product Prototype") Vue renderer registry, registered against `crmSystem` through
 * the public `@deviltea/widget-vue` contract only (`createWidgetVueRenderer`). Every plugin has a
 * renderer registration (the registry is exhaustive by construction) — `DealStoreRenderer`/
 * `DealQueryRenderer` render nothing (checkpoint §3: "presentationless in effect" but "real Vue
 * component values whose render output is empty/null DOM output"; the registration itself is never
 * `null`/omitted/optional).
 */

import { createWidgetVueRenderer } from '@deviltea/widget-vue'
import { crmSystem } from '../system'
import AppShellRenderer from './AppShellRenderer.vue'
import BarChartRenderer from './BarChartRenderer.vue'
import ButtonRenderer from './ButtonRenderer.vue'
import CardRenderer from './CardRenderer.vue'
import DealQueryRenderer from './DealQueryRenderer.vue'
import DealStageFormRenderer from './DealStageFormRenderer.vue'
import DealStoreRenderer from './DealStoreRenderer.vue'
import DetailPanelRenderer from './DetailPanelRenderer.vue'
import MetricCardRenderer from './MetricCardRenderer.vue'
import ModalRenderer from './ModalRenderer.vue'
import SelectInputRenderer from './SelectInputRenderer.vue'
import TableRenderer from './TableRenderer.vue'
import TextInputRenderer from './TextInputRenderer.vue'
import ToolbarRenderer from './ToolbarRenderer.vue'

export const CrmRenderer = createWidgetVueRenderer(crmSystem, renderers =>
	renderers
		.AppShell(AppShellRenderer)
		.Toolbar(ToolbarRenderer)
		.Card(CardRenderer)
		.TextInput(TextInputRenderer)
		.SelectInput(SelectInputRenderer)
		.MetricCard(MetricCardRenderer)
		.Table(TableRenderer)
		.DetailPanel(DetailPanelRenderer)
		.BarChart(BarChartRenderer)
		.Button(ButtonRenderer)
		.Modal(ModalRenderer)
		.DealStore(DealStoreRenderer)
		.DealQuery(DealQueryRenderer)
		.DealStageForm(DealStageFormRenderer))
