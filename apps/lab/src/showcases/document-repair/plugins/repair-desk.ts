/**
 * `RepairDesk`: the root of the outer system, the notice-board app's draft list. It holds the saved drafts in its slot
 * `drafts` and says which app version opens them (config `appVersion`, also a Property). It has no State and no logic:
 * what to do with an old draft is the application's policy, written in `../domain.ts` (`planRepair`) and carried out by the
 * frame host (`../renderers/repair-host.ts`), never by Core.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { RepairDeskConfig, RepairDeskRawConfig } from '../config'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkRepairDeskConfig, resolveRepairDeskConfig } from '../config'
import { repairDeskConfigDocs, repairDeskRawConfigDocs } from '../docs'

export interface RepairDeskInterfaces extends WidgetInterfaces {
	config: { raw: RepairDeskRawConfig, resolved: RepairDeskConfig }
	slots: {
		drafts: 'SavedDraft'
	}
	properties: {
		appVersion: string
	}
}

export const RepairDeskPlugin = createWidgetPlugin('RepairDesk')
	.description('The root of the repair desk: the notice-board app\'s list of saved drafts (slot `drafts`). Property `appVersion` is the app version that opens them. Core does not migrate or repair a stored document; the application does, with the plan each SavedDraft computes.')
	.interfaces<RepairDeskInterfaces>()
	.config({
		description: 'The app version that opens the drafts, such as "3.0".',
		raw: repairDeskRawConfigDocs,
		resolved: repairDeskConfigDocs,
		validate: (input, ctx): input is RepairDeskRawConfig => {
			checkRepairDeskConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveRepairDeskConfig,
	})
	.slots({
		drafts: {
			description: 'The saved drafts, in order. Only SavedDraft widgets.',
			validateStructure: ({ children, addDiagnostic }) => {
				children.forEach((child, index) => {
					if (child.resolved && child.type !== 'SavedDraft')
						addDiagnostic({ message: `"${child.type}" is not a saved draft.`, index, reason: 'not-a-draft' })
				})
			},
		},
	})
	.structure(({ widget, blueprint, addDiagnostic }) => {
		if (blueprint.getParent(widget) !== null)
			addDiagnostic({ message: 'A RepairDesk must be the root widget.', reason: 'desk-not-root' })
	})
	.properties(properties => properties
		.appVersion({ description: 'The app version that opens the drafts (config `appVersion`).', compute: ({ config }) => config.appVersion }))
	.done()
