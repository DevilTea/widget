/**
 * `Section`: a titled group of fields (slot `fields`). It has no State and no logic of its own: its Properties are its config.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { SectionConfig, SectionRawConfig } from '../config'
import type { I18nText } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkSectionConfig, resolveSectionConfig } from '../config'
import { sectionConfigDocs, sectionRawConfigDocs } from '../docs'
import { isFieldType } from './structure'

export interface SectionInterfaces extends WidgetInterfaces {
	config: { raw: SectionRawConfig, resolved: SectionConfig }
	slots: {
		fields: 'TextField' | 'Toggle' | 'Choice' | 'DangerAction'
	}
	properties: {
		title: I18nText
		description: I18nText | null
	}
}

export const SectionPlugin = createWidgetPlugin('Section')
	.description('A titled group of fields (slot `fields`: TextField, Toggle, Choice or DangerAction). Properties `title` and `description` are its config.')
	.interfaces<SectionInterfaces>()
	.config({
		description: 'The heading of the section and, optionally, a sentence under it.',
		raw: sectionRawConfigDocs,
		resolved: sectionConfigDocs,
		validate: (input, ctx): input is SectionRawConfig => {
			checkSectionConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveSectionConfig,
	})
	.slots({
		fields: {
			description: 'The fields of the section, in order: TextField, Toggle, Choice or DangerAction.',
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
		.title({ description: 'The heading per language.', compute: ({ config }) => config.title })
		.description({ description: 'The sentence under the heading per language; `null` without one.', compute: ({ config }) => config.description }))
	.done()
