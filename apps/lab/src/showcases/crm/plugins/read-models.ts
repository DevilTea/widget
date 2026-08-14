/**
 * `MetricCard`, `Table`, `DetailPanel`, `BarChart` (checkpoint §2 "Reusable-style primitives"): the
 * four "shared external Property source convention" read models. Each registers exactly one configured
 * external Property dependency (`PropertySourceConfig`, `../domain.ts`) at Blueprint compile time and
 * refines the consumer-visible shape with the dependency's own `.validate()` — never by inspecting
 * arbitrary Runtime objects or parsing diagnostics. None of these plugins know about deals/stages;
 * every CRM-specific search/filter/aggregation semantic lives in `DealQuery` (`./deal-query.ts`).
 *
 * `Table`/`DetailPanel`/`BarChart` declare no `properties` projection of their own *display* config
 * (`columns`/`fields`/`title`/`emptyText`) — `@deviltea/widget-vue`'s public `useWidget()` contract has
 * no resolved-config accessor (see `./structural.ts`'s file header for the same boundary) — each is a
 * single preset instance, so its renderer safely hardcodes fixed copy matching the preset's own config
 * (checkpoint §6: "Exact display labels ... are implementation details").
 *
 * `MetricCard` is the one exception, and it is a deliberate, narrow deviation from the checkpoint's
 * literal capability list: it additionally declares `properties: { label, format }`, a pure
 * presentation-only projection of its own resolved config (same rationale/precedent as `Button` in
 * `./actions.ts` — see that file's header). `MetricCard` is instantiated three times in this showcase
 * (`visible-deal-count`/`pipeline-value`/`weighted-value`) with no other distinguishing slot/state, so
 * without this projection every instance would render identically.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { PropertySourceConfig } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isPlainObject, isPropertySourceConfig } from '../domain'

function isNumber(value: unknown): value is number {
	return typeof value === 'number'
}

// -------------------------------------------------------------------------------------------------
// MetricCard
// -------------------------------------------------------------------------------------------------

export type MetricCardFormat = 'number' | 'currency'

export interface MetricCardRawConfig {
	readonly label: string
	readonly source: PropertySourceConfig
	readonly format: MetricCardFormat
}

export interface MetricCardInterfaces extends WidgetInterfaces {
	config: {
		raw: MetricCardRawConfig
		resolved: MetricCardRawConfig
	}
	properties: {
		value: number
		label: string
		format: MetricCardFormat
	}
}

function isMetricCardFormat(value: unknown): value is MetricCardFormat {
	return value === 'number' || value === 'currency'
}

export const MetricCardPlugin = createWidgetPlugin('MetricCard')
	.interfaces<MetricCardInterfaces>()
	.config({
		validate: (input): input is MetricCardRawConfig =>
			isPlainObject(input)
			&& typeof input.label === 'string'
			&& isPropertySourceConfig(input.source)
			&& isMetricCardFormat(input.format),
		resolve: raw => ({
			label: raw?.label ?? '',
			source: raw?.source ?? { widgetId: '', property: '' },
			format: raw?.format ?? 'number',
		}),
	})
	.properties(properties =>
		properties
			.value({
				registerDeps: ({ dep, config }) => dep.widget(config.source.widgetId).properties.get(config.source.property)
					.validate(isNumber),
				compute: ({ deps }) => {
					const result = deps()
					return result.success ? result.value : 0
				},
			})
			.label({ compute: ({ config }) => config.label })
			.format({ compute: ({ config }) => config.format }))
	.done()

// -------------------------------------------------------------------------------------------------
// Table
// -------------------------------------------------------------------------------------------------

export interface TableColumn {
	readonly key: string
	readonly label: string
	readonly format?: 'text' | 'currency' | 'badge'
}

export interface TableRawConfig {
	readonly source: PropertySourceConfig
	readonly rowIdKey: string
	readonly columns: readonly TableColumn[]
}

export interface TableInterfaces extends WidgetInterfaces {
	config: {
		raw: TableRawConfig
		resolved: TableRawConfig
	}
	state: {
		selectedRowId: string | null
	}
	properties: {
		rows: readonly Record<string, unknown>[]
		selectedRow: Record<string, unknown> | null
		empty: boolean
	}
	methods: {
		selectRow: (id: string) => void
	}
}

function isTableColumn(value: unknown): value is TableColumn {
	return isPlainObject(value)
		&& typeof value.key === 'string'
		&& typeof value.label === 'string'
		&& (value.format === undefined || value.format === 'text' || value.format === 'currency' || value.format === 'badge')
}

function isTableRawConfig(input: unknown): input is TableRawConfig {
	return isPlainObject(input)
		&& isPropertySourceConfig(input.source)
		&& typeof input.rowIdKey === 'string'
		&& Array.isArray(input.columns) && input.columns.every(isTableColumn)
}

export const TablePlugin = createWidgetPlugin('Table')
	.interfaces<TableInterfaces>()
	.config({
		validate: (input): input is TableRawConfig => isTableRawConfig(input),
		resolve: raw => ({
			source: raw?.source ?? { widgetId: '', property: '' },
			rowIdKey: raw?.rowIdKey ?? 'id',
			columns: raw?.columns ?? [],
		}),
	})
	.state(state =>
		state.selectedRowId({
			validate: (input): input is string | null => input === null || typeof input === 'string',
			default: () => null,
		}))
	.properties(properties =>
		properties
			.rows({
				registerDeps: ({ dep, config }) => dep.widget(config.source.widgetId).properties.get(config.source.property)
					.validate((value): value is readonly Record<string, unknown>[] =>
						Array.isArray(value) && value.every(row => isPlainObject(row) && typeof row[config.rowIdKey] === 'string')),
				compute: ({ deps }) => {
					const result = deps()
					return result.success ? result.value : []
				},
			})
			.selectedRow({
				// Filtering a selected row out of `rows` does not mutate `selectedRowId` (checkpoint §2):
				// this Property alone goes `null` while the retained id survives in State, and reappears
				// automatically once the id is visible again — no renderer-owned "was it filtered" logic.
				registerDeps: ({ dep }) => ({
					rows: dep.self.properties.get('rows'),
					selectedRowId: dep.self.state.get('selectedRowId'),
				}),
				compute: ({ deps, config }) => {
					const rowsResult = deps.rows()
					const selectedRowIdResult = deps.selectedRowId()
					if (!rowsResult.success)
						return null
					const selectedRowId = selectedRowIdResult.success ? selectedRowIdResult.value : null
					if (selectedRowId === null)
						return null
					return (rowsResult.value ?? []).find(row => row[config.rowIdKey] === selectedRowId) ?? null
				},
			})
			.empty({
				registerDeps: ({ dep }) => dep.self.properties.get('rows'),
				compute: ({ deps }) => {
					const result = deps()
					return !result.success || (result.value ?? []).length === 0
				},
			}))
	.methods(methods =>
		methods.selectRow({
			// Validation boundary is locked (checkpoint §2): `validateArgs` only checks tuple shape/`id`
			// is a string. Current-row existence is an `execute()`-time semantic check against the
			// registered `rows` Property dependency — never a `validateArgs` concern.
			registerDeps: ({ dep }) => ({
				rows: dep.self.properties.get('rows'),
				setSelectedRowId: dep.self.state.set('selectedRowId'),
			}),
			validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
			execute: ({ deps, args, addIssue, config }) => {
				const [id] = args
				const rowsResult = deps.rows()
				if (!rowsResult.success)
					return
				const exists = (rowsResult.value ?? []).some(row => row[config.rowIdKey] === id)
				if (!exists) {
					addIssue({ message: `No visible row with id "${id}".` })
					return
				}
				deps.setSelectedRowId(id)
			},
		}))
	.done()

// -------------------------------------------------------------------------------------------------
// DetailPanel
// -------------------------------------------------------------------------------------------------

export interface DetailPanelField {
	readonly key: string
	readonly label: string
	readonly format?: 'text' | 'currency' | 'badge'
}

export interface DetailPanelRawConfig {
	readonly title: string
	readonly source: PropertySourceConfig
	readonly fields: readonly DetailPanelField[]
	readonly emptyText: string
}

export interface DetailPanelInterfaces extends WidgetInterfaces {
	config: {
		raw: DetailPanelRawConfig
		resolved: DetailPanelRawConfig
	}
	slots: 'actions'
	properties: {
		record: Record<string, unknown> | null
		empty: boolean
	}
}

function isDetailPanelField(value: unknown): value is DetailPanelField {
	return isPlainObject(value)
		&& typeof value.key === 'string'
		&& typeof value.label === 'string'
		&& (value.format === undefined || value.format === 'text' || value.format === 'currency' || value.format === 'badge')
}

function isDetailPanelRawConfig(input: unknown): input is DetailPanelRawConfig {
	return isPlainObject(input)
		&& typeof input.title === 'string'
		&& isPropertySourceConfig(input.source)
		&& Array.isArray(input.fields) && input.fields.every(isDetailPanelField)
		&& typeof input.emptyText === 'string'
}

export const DetailPanelPlugin = createWidgetPlugin('DetailPanel')
	.interfaces<DetailPanelInterfaces>()
	.config({
		validate: (input): input is DetailPanelRawConfig => isDetailPanelRawConfig(input),
		resolve: raw => ({
			title: raw?.title ?? '',
			source: raw?.source ?? { widgetId: '', property: '' },
			fields: raw?.fields ?? [],
			emptyText: raw?.emptyText ?? '',
		}),
	})
	.slots({ actions: {} })
	.properties(properties =>
		properties
			.record({
				registerDeps: ({ dep, config }) => dep.widget(config.source.widgetId).properties.get(config.source.property)
					.validate((value): value is Record<string, unknown> | null => value === null || isPlainObject(value)),
				compute: ({ deps }) => {
					const result = deps()
					return result.success ? result.value : null
				},
			})
			.empty({
				registerDeps: ({ dep }) => dep.self.properties.get('record'),
				compute: ({ deps }) => {
					const result = deps()
					return !result.success || result.value === null
				},
			}))
	.done()

// -------------------------------------------------------------------------------------------------
// BarChart
// -------------------------------------------------------------------------------------------------

export interface BarChartSeriesPoint {
	readonly label: string
	readonly value: number
}

export interface BarChartRawConfig {
	readonly title: string
	readonly source: PropertySourceConfig
}

export interface BarChartInterfaces extends WidgetInterfaces {
	config: {
		raw: BarChartRawConfig
		resolved: BarChartRawConfig
	}
	properties: {
		series: readonly BarChartSeriesPoint[]
	}
}

function isBarChartSeriesPoint(value: unknown): value is BarChartSeriesPoint {
	return isPlainObject(value) && typeof value.label === 'string' && typeof value.value === 'number'
}

export const BarChartPlugin = createWidgetPlugin('BarChart')
	.interfaces<BarChartInterfaces>()
	.config({
		validate: (input): input is BarChartRawConfig =>
			isPlainObject(input) && typeof input.title === 'string' && isPropertySourceConfig(input.source),
		resolve: raw => ({
			title: raw?.title ?? '',
			source: raw?.source ?? { widgetId: '', property: '' },
		}),
	})
	.properties(properties =>
		properties.series({
			registerDeps: ({ dep, config }) => dep.widget(config.source.widgetId).properties.get(config.source.property)
				.validate((value): value is readonly BarChartSeriesPoint[] => Array.isArray(value) && value.every(isBarChartSeriesPoint)),
			compute: ({ deps }) => {
				const result = deps()
				return result.success ? result.value : []
			},
		}))
	.done()
