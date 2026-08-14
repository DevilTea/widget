/**
 * Showcase B ("Interactive Product Prototype") domain model.
 *
 * Normative source: GitHub issue #13 comment "Checkpoint — Showcase B: Interactive Product Prototype
 * (ACCEPTED)". A bounded, offline, in-memory Sales Pipeline CRM dashboard over a fixed synthetic deal
 * dataset — a semantic architecture probe, not a real CRM/sales product. Every constant here is a
 * synthetic Lab-private fixture; there is no network/backend/persistence. All domain
 * calculation/validation lives in plugin semantics under `./plugins/`, never in Vue renderer glue
 * (`./renderers/`).
 */

export type DealStage = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost'

/** Fixed semantic stage order (checkpoint §2/§6): used by `DealQuery.stageSeries` and stage pickers. */
export const dealStageValues: readonly DealStage[] = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost']

export function isDealStage(value: unknown): value is DealStage {
	return typeof value === 'string' && (dealStageValues as readonly string[]).includes(value)
}

/** Fixed semantic stage weighting (checkpoint §1) — used by `DealQuery.weightedValue`. */
export const stageProbability: Readonly<Record<DealStage, number>> = {
	lead: 0.10,
	qualified: 0.30,
	proposal: 0.60,
	negotiation: 0.80,
	won: 1,
	lost: 0,
}

export interface Deal {
	readonly id: string
	readonly company: string
	readonly contact: string
	readonly owner: string
	readonly stage: DealStage
	readonly amount: number
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDeal(value: unknown): value is Deal {
	return isPlainObject(value)
		&& typeof value.id === 'string'
		&& typeof value.company === 'string'
		&& typeof value.contact === 'string'
		&& typeof value.owner === 'string'
		&& isDealStage(value.stage)
		&& typeof value.amount === 'number'
}

export function isDealsArray(value: unknown): value is readonly Deal[] {
	return Array.isArray(value) && value.every(isDeal)
}

/**
 * The canonical Lab-private seed dataset (checkpoint §6: "roughly 6-10 deals spanning several
 * stages/owners/amounts"). Eight synthetic deals across all six stages, three owners, and a wide
 * amount range so search/filter/KPI/chart changes stay visually meaningful. Not real company/contact
 * data — illustrative only, like Showcase A's synthetic travel-cost fixtures.
 */
export const seedDeals: readonly Deal[] = [
	{ id: 'deal-1', company: 'Aurora Systems', contact: 'Mia Chen', owner: 'Alex Rivera', stage: 'lead', amount: 18_000 },
	{ id: 'deal-2', company: 'Borealis Retail', contact: 'Noah Patel', owner: 'Alex Rivera', stage: 'qualified', amount: 32_000 },
	{ id: 'deal-3', company: 'Cobalt Health', contact: 'Grace Kim', owner: 'Jordan Lee', stage: 'proposal', amount: 54_000 },
	{ id: 'deal-4', company: 'Delta Logistics', contact: 'Liam Wong', owner: 'Jordan Lee', stage: 'proposal', amount: 41_000 },
	{ id: 'deal-5', company: 'Everline Media', contact: 'Ava Torres', owner: 'Sam Osei', stage: 'negotiation', amount: 76_000 },
	{ id: 'deal-6', company: 'Fjord Robotics', contact: 'Ethan Novak', owner: 'Sam Osei', stage: 'won', amount: 98_000 },
	{ id: 'deal-7', company: 'Granite Foods', contact: 'Olivia Brooks', owner: 'Alex Rivera', stage: 'lost', amount: 22_000 },
	{ id: 'deal-8', company: 'Halcyon Energy', contact: 'Lucas Fischer', owner: 'Jordan Lee', stage: 'qualified', amount: 63_000 },
]

/**
 * Shared external Property source convention (checkpoint §2 "Shared external Property source
 * convention"): reusable-style read models (`MetricCard`/`Table`/`DetailPanel`/`BarChart`) resolve one
 * external Property dependency from this configured shape at Blueprint compile time, then refine the
 * consumer-visible value shape with the dependency's own `.validate()` — never by inspecting arbitrary
 * Runtime objects or parsing diagnostics.
 */
export interface PropertySourceConfig {
	readonly widgetId: string
	readonly property: string
}

export function isPropertySourceConfig(value: unknown): value is PropertySourceConfig {
	return isPlainObject(value) && typeof value.widgetId === 'string' && typeof value.property === 'string'
}
