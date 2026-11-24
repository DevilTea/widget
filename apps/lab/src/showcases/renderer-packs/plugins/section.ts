/**
 * `Section`: a titled group of fields (slot `fields`). It has no State and no logic of its own: its Properties are its config.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { SectionConfig, SectionRawConfig } from '../config'
import type { I18nText } from '../domain'
import { createWidgetPlugin, undocumented } from '@deviltea/widget-core'
import { checkSectionConfig, resolveSectionConfig } from '../config'
import { isFieldType } from './structure'

/**
 * A titled group of fields (slot `fields`: TextField, Toggle, Choice or DangerAction). Properties `title` and `description`
 * are its config.
 */
export interface SectionInterfaces extends WidgetInterfaces {
	/** The heading of the section and, optionally, a sentence under it. */
	config: { raw: SectionRawConfig, resolved: SectionConfig }
	slots: {
		/** The fields of the section, in order: TextField, Toggle, Choice or DangerAction. */
		fields: 'TextField' | 'Toggle' | 'Choice' | 'DangerAction'
	}
	properties: {
		/** The heading per language. */
		title: I18nText
		/** The sentence under the heading per language; `null` without one. */
		description: I18nText | null
	}
}

export const SectionPlugin = createWidgetPlugin('Section')
	.description(undocumented)
	.interfaces<SectionInterfaces>()
	.config({
		description: undocumented,
		validate: (input, ctx): input is SectionRawConfig => {
			checkSectionConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveSectionConfig,
	})
	.slots({
		fields: {
			description: undocumented,
			validateStructure: ({ children, addDiagnostic }) => {
				children.forEach((child, index) => {
					if (child.resolved && !isFieldType(child.type))
						addDiagnostic({ message: `"${child.type}" is not a field type.`, index, reason: 'not-a-field' })
				})
			},
		},
	})
	.structure(({ widget, blueprint, addDiagnostic }) => {
		const parent = blueprint.getParent(widget)
		if (parent === null || (parent.resolved && parent.type !== 'SettingsPage'))
			addDiagnostic({ message: 'A Section must be placed in the sections of a SettingsPage.', reason: 'outside-settings-page' })
	})
	.properties(properties => properties
		.title({ description: undocumented, compute: ({ config }) => config.title })
		.description({ description: undocumented, compute: ({ config }) => config.description }))
	.done()
