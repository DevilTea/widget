/**
 * The documentation of the renderer-packs plugins' config and value types, written once and referenced from the
 * builders (`defineTypeDocs` + `ref` for a type several members use, `defineFieldDocs` for a config). Core keeps it on
 * `plugin.docs`; the docs generator (`@deviltea/widget-docs-generator`) reads it from there.
 */

import type { TypeDocs } from '@deviltea/widget-core'
import type { AppearanceConfig, AppearanceRawConfig, ChoiceConfig, ChoiceRawConfig, DangerActionConfig, DangerActionRawConfig, NotifierConfig, NotifierRawConfig, SectionConfig, SectionRawConfig, SettingsPageConfig, SettingsPageRawConfig, TextFieldConfig, TextFieldRawConfig, ToggleConfig, ToggleRawConfig } from './config'
import type { ChoiceOption, I18nText, NotifierItem } from './domain'
import type { ConfirmedAction } from './plugins/danger-action'
import type { PageAppearance } from './plugins/settings-page'
import { defineFieldDocs, defineTypeDocs } from '@deviltea/widget-core'

// -------------------------------------------------------------------------------------------------
// Shared types
// -------------------------------------------------------------------------------------------------

export const i18nTextDocs: TypeDocs<I18nText> = defineTypeDocs<I18nText>('I18nText', {
	description: 'Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it.',
	values: { description: 'The text in one language. `en` is the English text, which a missing language falls back to.' },
})

export const choiceOptionDocs: TypeDocs<ChoiceOption> = defineTypeDocs<ChoiceOption>('ChoiceOption', {
	description: 'One option of a Choice.',
	fields: {
		value: { description: 'The value the State holds when this option is chosen: at least one character. Unique within the list.' },
		label: { description: 'What the option is called.', ref: i18nTextDocs },
	},
})

export const notifierItemDocs: TypeDocs<NotifierItem> = defineTypeDocs<NotifierItem>('NotifierItem', {
	description: 'One notification the Notifier keeps.',
	fields: {
		id: { description: 'The notification\'s id: a whole number from 1, unique among the kept notifications.' },
		message: { description: 'The text of the notification.', ref: i18nTextDocs },
		tone: { description: 'The tone: `info`, `success` or `danger` (the page announces `danger` as an alert).' },
	},
})

export const confirmedActionDocs: TypeDocs<ConfirmedAction> = defineTypeDocs<ConfirmedAction>('ConfirmedAction', {
	description: 'What a DangerAction\'s `confirmed` Event carries: the notification it left with the Notifier.',
	fields: {
		tone: { description: 'The tone of the notification.' },
		message: { description: 'The text of the notification.', ref: i18nTextDocs },
	},
})

export const pageAppearanceDocs: TypeDocs<PageAppearance> = defineTypeDocs<PageAppearance>('PageAppearance', {
	description: 'How the page is drawn: the colour mode and the density of the root Appearance.',
	fields: {
		mode: { description: 'The colour mode: `auto` (the host theme), `light` or `dark`.' },
		density: { description: 'The density: `comfortable` or `compact`.' },
	},
})

// -------------------------------------------------------------------------------------------------
// Configs
// -------------------------------------------------------------------------------------------------

const RECOVERED = { description: 'Whether this is the fallback of a config that failed validation.' }
const APPEARANCE = 'The id of the Appearance widget this one reads its density from: at least one character. Core has no nearest-ancestor lookup: the provider is named, and the dependency is declared with dep.widget(id).'

export const settingsPageRawConfigDocs = defineFieldDocs<SettingsPageRawConfig>()({
	description: 'The authored config of a SettingsPage.',
	fields: { title: { description: 'The title of the settings page.', ref: i18nTextDocs } },
})

export const settingsPageConfigDocs = defineFieldDocs<SettingsPageConfig>()({
	description: 'The resolved config of a SettingsPage.',
	fields: { title: { description: 'The title of the settings page.', ref: i18nTextDocs }, recovered: RECOVERED },
})

export const appearanceRawConfigDocs = defineFieldDocs<AppearanceRawConfig>()({
	description: 'The authored config of an Appearance.',
	fields: {
		density: { description: 'The density at the start: `comfortable` or `compact`. Defaults to "comfortable".' },
		mode: { description: 'The colour mode at the start: "auto" follows the host theme. Defaults to "auto".' },
	},
})

export const appearanceConfigDocs = defineFieldDocs<AppearanceConfig>()({
	description: 'The resolved config of an Appearance.',
	fields: {
		density: { description: 'The density at the start.' },
		mode: { description: 'The colour mode at the start.' },
		recovered: RECOVERED,
	},
})

export const notifierRawConfigDocs = defineFieldDocs<NotifierRawConfig>()({
	description: 'The authored config of a Notifier.',
	fields: {
		limit: { description: 'How many notifications are kept, a whole number from 1 to 10; the oldest is dropped first. Defaults to 4.' },
	},
})

export const notifierConfigDocs = defineFieldDocs<NotifierConfig>()({
	description: 'The resolved config of a Notifier.',
	fields: { limit: { description: 'How many notifications are kept.' }, recovered: RECOVERED },
})

export const sectionRawConfigDocs = defineFieldDocs<SectionRawConfig>()({
	description: 'The authored config of a Section.',
	fields: {
		title: { description: 'The heading of the section.', ref: i18nTextDocs },
		description: { description: 'A sentence under the heading.', ref: i18nTextDocs },
	},
})

export const sectionConfigDocs = defineFieldDocs<SectionConfig>()({
	description: 'The resolved config of a Section.',
	fields: {
		title: { description: 'The heading of the section.', ref: i18nTextDocs },
		description: { description: 'A sentence under the heading, or `null` for none.', ref: i18nTextDocs },
		recovered: RECOVERED,
	},
})

export const textFieldRawConfigDocs = defineFieldDocs<TextFieldRawConfig>()({
	description: 'The authored config of a TextField.',
	fields: {
		label: { description: 'The label of the field.', ref: i18nTextDocs },
		placeholder: { description: 'The hint shown while the field is empty.', ref: i18nTextDocs },
		maxLength: { description: 'How many characters are acceptable: a whole number, at least 1. A longer value is stored and gets a validation message; the widget does not truncate it.' },
		appearance: { description: APPEARANCE },
		value: { description: 'The value at the start. Defaults to the empty string.' },
	},
})

export const textFieldConfigDocs = defineFieldDocs<TextFieldConfig>()({
	description: 'The resolved config of a TextField.',
	fields: {
		label: { description: 'The label of the field.', ref: i18nTextDocs },
		placeholder: { description: 'The hint shown while the field is empty, or `null` for none.', ref: i18nTextDocs },
		maxLength: { description: 'How many characters are acceptable.' },
		appearance: { description: 'The id of the Appearance widget this one reads its density from.' },
		value: { description: 'The value at the start.' },
		recovered: RECOVERED,
	},
})

export const toggleRawConfigDocs = defineFieldDocs<ToggleRawConfig>()({
	description: 'The authored config of a Toggle.',
	fields: {
		label: { description: 'The label of the switch.', ref: i18nTextDocs },
		appearance: { description: APPEARANCE },
		on: { description: 'Whether the switch is on at the start. Defaults to false.' },
	},
})

export const toggleConfigDocs = defineFieldDocs<ToggleConfig>()({
	description: 'The resolved config of a Toggle.',
	fields: {
		label: { description: 'The label of the switch.', ref: i18nTextDocs },
		appearance: { description: 'The id of the Appearance widget this one reads its density from.' },
		on: { description: 'Whether the switch is on at the start.' },
		recovered: RECOVERED,
	},
})

export const choiceRawConfigDocs = defineFieldDocs<ChoiceRawConfig>()({
	description: 'The authored config of a Choice.',
	fields: {
		label: { description: 'The label of the choice.', ref: i18nTextDocs },
		appearance: { description: APPEARANCE },
		options: { description: 'The options to choose between, at least two.', items: { ref: choiceOptionDocs } },
		value: { description: 'The value of the option chosen at the start. Defaults to the first option.' },
	},
})

export const choiceConfigDocs = defineFieldDocs<ChoiceConfig>()({
	description: 'The resolved config of a Choice.',
	fields: {
		label: { description: 'The label of the choice.', ref: i18nTextDocs },
		appearance: { description: 'The id of the Appearance widget this one reads its density from.' },
		options: { description: 'The options to choose between.', items: { ref: choiceOptionDocs } },
		value: { description: 'The value of the option chosen at the start.' },
		recovered: RECOVERED,
	},
})

export const dangerActionRawConfigDocs = defineFieldDocs<DangerActionRawConfig>()({
	description: 'The authored config of a DangerAction.',
	fields: {
		label: { description: 'The label of the button that asks for confirmation.', ref: i18nTextDocs },
		confirmText: { description: 'The question the confirmation shows.', ref: i18nTextDocs },
		message: { description: 'The notification a confirmed action leaves with the Notifier.', ref: i18nTextDocs },
		tone: { description: 'The tone of that notification: `info`, `success` or `danger`. Defaults to "danger", which the page announces as an alert.' },
		notifier: { description: 'The id of the Notifier widget a confirmed action reports to: at least one character. Core has no nearest-ancestor lookup: the provider is named, and confirm() invokes its notify Method through dep.widget(id).' },
		appearance: { description: APPEARANCE },
	},
})

export const dangerActionConfigDocs = defineFieldDocs<DangerActionConfig>()({
	description: 'The resolved config of a DangerAction.',
	fields: {
		label: { description: 'The label of the button that asks for confirmation.', ref: i18nTextDocs },
		confirmText: { description: 'The question the confirmation shows.', ref: i18nTextDocs },
		message: { description: 'The notification a confirmed action leaves with the Notifier.', ref: i18nTextDocs },
		tone: { description: 'The tone of that notification.' },
		notifier: { description: 'The id of the Notifier widget a confirmed action reports to.' },
		appearance: { description: 'The id of the Appearance widget this one reads its density from.' },
		recovered: RECOVERED,
	},
})
