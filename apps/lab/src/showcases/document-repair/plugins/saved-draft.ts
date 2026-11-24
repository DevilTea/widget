/**
 * `SavedDraft`: one draft that an older version of the app saved. Its config is the stored document, kept exactly as saved:
 * `title`, `savedWith` (the format version) and `source` (any JSON).
 *
 * - Properties `title`, `savedWith` and `source` project the config for the renderer (a Property is also how the host reads it).
 * - `findings`: what Core says about `source`, compiled with the INNER notice board system (`./findings.ts`): status,
 *   diagnostics located by `getSourcePath`, and the recovered node topology.
 * - `plan`: the application's migration plan for `savedWith` (`planRepair` in `../domain.ts`): an ordered list of
 *   `SourcePatch` steps guarded by `test` operations. It is policy, not Core: a draft the application has no rule for has a
 *   plan that does not make it valid.
 * - State `revision`, `appRevision` and `repaired` mirror the editing session the host opens on the draft (`-1` and `false`
 *   while no session is open): the document's own revision, the revision the app last read, and whether the document is
 *   valid. The host writes them; nothing persists them.
 *
 * The widget never changes `source`: the host opens a `WidgetDocument` on a copy.
 */

import type { JsonValue, WidgetInterfaces } from '@deviltea/widget-core'
import type { SavedDraftConfig, SavedDraftRawConfig } from '../config'
import type { Findings, RepairStep, SavedWith } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkSavedDraftConfig, resolveSavedDraftConfig } from '../config'
import { findingsDocs, repairStepDocs, savedDraftConfigDocs, savedDraftRawConfigDocs } from '../docs'
import { planRepair } from '../domain'
import { projectFindings } from './findings'

export interface SavedDraftInterfaces extends WidgetInterfaces {
	config: { raw: SavedDraftRawConfig, resolved: SavedDraftConfig }
	state: {
		revision: number
		appRevision: number
		repaired: boolean
	}
	properties: {
		title: string
		savedWith: SavedWith
		source: JsonValue
		findings: Findings
		plan: readonly RepairStep[]
	}
}

function isRevision(input: unknown): input is number {
	return typeof input === 'number' && Number.isInteger(input) && input >= -1
}

export const SavedDraftPlugin = createWidgetPlugin('SavedDraft')
	.description('A draft that an older version of the app saved: config `title`, `savedWith` and `source` (the stored document, any JSON). Properties: `title`, `savedWith`, `source`, `findings` (what Core says about `source`, compiled with the notice board system) and `plan` (the application\'s migration steps). State `revision`, `appRevision` and `repaired` mirror the host\'s editing session.')
	.interfaces<SavedDraftInterfaces>()
	.config({
		description: 'The draft title, the format version that saved it and the stored document.',
		raw: savedDraftRawConfigDocs,
		resolved: savedDraftConfigDocs,
		validate: (input, ctx): input is SavedDraftRawConfig => {
			checkSavedDraftConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveSavedDraftConfig,
	})
	.structure(({ widget, blueprint, addDiagnostic }) => {
		const parent = blueprint.getParent(widget)
		if (parent === null || (parent.resolved && parent.type !== 'RepairDesk'))
			addDiagnostic({ message: 'A SavedDraft must be placed in the drafts of a RepairDesk.', reason: 'outside-desk' })
	})
	.state(state => state
		.revision({ description: 'The revision of the document the host\'s editing session holds; -1 while no session is open.', validate: (input): input is number => isRevision(input), default: () => -1 })
		.appRevision({ description: 'The document revision the app last read; -1 while no session is open.', validate: (input): input is number => isRevision(input), default: () => -1 })
		.repaired({ description: 'Whether the session\'s document is valid; false while no session is open.', validate: (input): input is boolean => typeof input === 'boolean', default: () => false }))
	.properties(properties => properties
		.title({ description: 'The draft title (config `title`).', compute: ({ config }) => config.title })
		.savedWith({ description: 'The format version that saved the draft (config `savedWith`).', compute: ({ config }) => config.savedWith })
		.source({ description: 'The stored document, exactly as saved (config `source`).', compute: ({ config }) => config.source })
		.findings({ description: 'What Core says about `source`, compiled with the notice board system: status, located diagnostics and the recovered nodes.', ref: findingsDocs, compute: ({ config }) => projectFindings(config.source) })
		.plan({ description: 'The application\'s migration plan for `savedWith`: ordered `SourcePatch` steps guarded by `test` operations.', items: { ref: repairStepDocs }, compute: ({ config }) => planRepair(config.source, config.savedWith) }))
	.done()
