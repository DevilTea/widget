/**
 * The documentation of the document-repair plugins' config and value types, referenced from the builders
 * (`defineTypeDocs` + `ref` for a named type, `defineFieldDocs` for a config). Core keeps it on `plugin.docs`; the
 * widget-skills generator reads it from there.
 */

import type { TypeDocs } from '@deviltea/widget-core'
import type { RepairDeskConfig, RepairDeskRawConfig, SavedDraftConfig, SavedDraftRawConfig } from './config'
import type { FindingDiagnostic, FindingNode, Findings, FindingSlot, I18nText, RepairStep } from './domain'
import { defineFieldDocs, defineTypeDocs } from '@deviltea/widget-core'

const RECOVERED = { description: 'Whether this is the fallback of a config that failed validation.' }

export const repairDeskRawConfigDocs = defineFieldDocs<RepairDeskRawConfig>()({
	description: 'The authored config of a RepairDesk.',
	fields: {
		appVersion: { description: 'The notice-board app version that opens the drafts, such as `3.0` (`^\\d+\\.\\d+$`). It writes format 3.x.' },
	},
})

export const repairDeskConfigDocs = defineFieldDocs<RepairDeskConfig>()({
	description: 'The resolved config of a RepairDesk.',
	fields: {
		appVersion: { description: 'The app version that opens the drafts; the current one when recovered.' },
		recovered: RECOVERED,
	},
})

export const savedDraftRawConfigDocs = defineFieldDocs<SavedDraftRawConfig>()({
	description: 'The authored config of a SavedDraft: the stored document, kept exactly as saved.',
	fields: {
		title: { description: 'What the draft is called in the app\'s draft list: at least one character.' },
		savedWith: { description: 'The format version of the app that saved the draft: `1.x`, `2.x` or `3.x`. The migration plan is chosen by it; Core does not know it.' },
		source: { description: 'The stored legacy document: any JSON value, kept exactly as saved. The widget compiles it with the notice board system and never changes it.' },
	},
})

export const savedDraftConfigDocs = defineFieldDocs<SavedDraftConfig>()({
	description: 'The resolved config of a SavedDraft.',
	fields: {
		title: { description: 'What the draft is called in the app\'s draft list.' },
		savedWith: { description: 'The format version of the app that saved the draft.' },
		source: { description: 'The stored document, exactly as saved; `null` when recovered.' },
		recovered: RECOVERED,
	},
})

export const i18nTextDocs: TypeDocs<I18nText> = defineTypeDocs<I18nText>('I18nText', {
	description: 'Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it.',
})

export const findingDiagnosticDocs: TypeDocs<FindingDiagnostic> = defineTypeDocs<FindingDiagnostic>('FindingDiagnostic', {
	description: 'One diagnostic Core reports for the stored document.',
	fields: {
		code: { description: 'The diagnostic code.' },
		message: { description: 'The diagnostic message.' },
		sourcePath: { description: 'Where the diagnostic\'s node sits in the source (`blueprint.getSourcePath`), or the diagnostic\'s own path for a source-level one.' },
		reason: { description: 'The plugin\'s machine-readable reason, when it gave one.' },
	},
})

export const findingSlotDocs: TypeDocs<FindingSlot> = defineTypeDocs<FindingSlot>('FindingSlot', {
	description: 'One slot of a recovered node.',
	fields: {
		name: { description: 'The slot name.' },
		placement: { description: '`slot`, or `raw-slot`: the source has a slot key the plugin does not declare. Its children are still recovered, and still invalid until moved.' },
		children: { description: 'How many children the slot holds.' },
	},
})

export const findingNodeDocs: TypeDocs<FindingNode> = defineTypeDocs<FindingNode>('FindingNode', {
	description: 'One node Core recovered from the stored document.',
	fields: {
		sourcePath: { description: 'Where the node sits in the source.' },
		resolved: { description: 'Whether the node resolved to a registered plugin.' },
		id: { description: 'The authored `id` when it is a string (an unresolved node still carries this hint), or `null`.' },
		type: { description: 'The authored `type` when it is a string (an unresolved node still carries this hint), or `null`.' },
		slots: { description: 'The node\'s slots.', items: { ref: findingSlotDocs } },
	},
})

export const findingsDocs: TypeDocs<Findings> = defineTypeDocs<Findings>('Findings', {
	description: 'What Core says about a stored draft, compiled with the notice board system.',
	fields: {
		status: { description: 'The Blueprint status: `valid` or `invalid`.' },
		sourceJsonCompatible: { description: 'Whether the stored document is plain JSON.' },
		diagnostics: { description: 'The located diagnostics.', items: { ref: findingDiagnosticDocs } },
		nodes: { description: 'The recovered nodes, in source order.', items: { ref: findingNodeDocs } },
	},
})

export const repairStepDocs: TypeDocs<RepairStep> = defineTypeDocs<RepairStep>('RepairStep', {
	description: 'One step of the application\'s migration plan.',
	fields: {
		id: { description: 'The step id.' },
		title: { description: 'What the step does.', ref: i18nTextDocs },
		why: { description: 'Why the application repairs it this way.', ref: i18nTextDocs },
		patch: {
			description: 'The `SourcePatch` to send. Its first operations are `test` guards for the precondition the step was planned against.',
			items: {
				fields: {
					op: { description: 'The operation: `add`, `remove`, `replace`, `move`, `copy` or `test`.' },
					path: { description: 'The source path the operation applies to.' },
					value: { description: 'The JSON value to add, write or test against.' },
					from: { description: 'Where a `move` or `copy` takes its value from.' },
				},
			},
		},
	},
})
