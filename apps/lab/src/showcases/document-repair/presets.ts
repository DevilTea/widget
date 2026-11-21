/**
 * Legacy document repair preset source texts (the repair desk, the OUTER document). Each is plain JSON source text that goes
 * through the same Apply pipeline as manual editing; only Core's recognized widget keys appear. The stored drafts are the
 * `source` config values, built from `./fixtures.ts` (in-memory fixtures; nothing is read from any storage).
 *
 * - `repair-default`: valid. Four saved drafts: `draft-v1` (saved with 1.x, many legacy shapes), `draft-v2` (2.x, an epoch
 *   `until`), `draft-v3` (3.x, already valid) and `draft-poll` (2.x, with a `Poll` the application has no rule for).
 * - `repair-invalid`: the default with four located diagnostics in the OUTER document: an `appVersion` that is not a version,
 *   a draft without `source`, a draft saved with a version the application does not know, and a draft without a title.
 */

import { legacyPoll, legacyV1, legacyV2, legacyV3 } from './fixtures'

export interface RepairPreset {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly sourceText: string
}

interface DraftSource {
	readonly id: string
	readonly type: 'SavedDraft'
	readonly config: Record<string, unknown>
}

function draft(id: string, title: string, savedWith: string, source: unknown): DraftSource {
	return { id, type: 'SavedDraft', config: { title, savedWith, source } }
}

function desk(appVersion: string, drafts: readonly DraftSource[]): string {
	return JSON.stringify({ id: 'desk', type: 'RepairDesk', config: { appVersion }, slots: { drafts } }, null, 2)
}

const DEFAULT_SOURCE = desk('3.0', [
	draft('draft-v1', 'Open-day board (saved with 1.x)', '1.x', legacyV1),
	draft('draft-v2', 'Winter hours (saved with 2.x)', '2.x', legacyV2),
	draft('draft-v3', 'Welcome board (saved with 3.x)', '3.x', legacyV3),
	draft('draft-poll', 'Open-day poll (saved with 2.x)', '2.x', legacyPoll),
])

function withoutKey(config: Record<string, unknown>, key: string): Record<string, unknown> {
	return Object.fromEntries(Object.entries(config)
		.filter(([name]) => name !== key))
}

const INVALID_SOURCE = (() => {
	const noSource = draft('draft-v1', 'Open-day board (saved with 1.x)', '1.x', legacyV1)
	const noTitle = draft('draft-v3', 'Welcome board (saved with 3.x)', '3.x', legacyV3)
	return desk('three', [
		// `draft-v1`: no `source` -> invalid-widget-config at ['source'] (missing-key).
		{ ...noSource, config: withoutKey(noSource.config, 'source') },
		// `draft-v2`: saved with a format the application has never heard of -> invalid-widget-config at ['savedWith'].
		draft('draft-v2', 'Winter hours (saved with 4.x)', '4.x', legacyV2),
		// `draft-v3`: no title -> invalid-widget-config at ['title'] (missing-key).
		{ ...noTitle, config: withoutKey(noTitle.config, 'title') },
	])
})()

export const repairPresets: readonly RepairPreset[] = [
	{
		id: 'repair-default',
		label: 'Default — four drafts from older versions',
		description: 'A valid repair desk with four drafts of the notice board that 1.x, 2.x and 3.x of the app saved, one of them with a widget type the app has no repair rule for. Open one and repair it step by step.',
		sourceText: DEFAULT_SOURCE,
	},
	{
		id: 'repair-invalid',
		label: 'Draft with mistakes — four problems',
		description: 'The repair desk itself is invalid, in its own document: an app version that is not a version, a draft without a stored document, a draft saved with an unknown format version and a draft without a title. Each is a located diagnostic.',
		sourceText: INVALID_SOURCE,
	},
]

export const defaultRepairPreset: RepairPreset = repairPresets[0]!
