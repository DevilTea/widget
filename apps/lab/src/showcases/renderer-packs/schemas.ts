/**
 * Draft 2020-12 JSON Schemas for the workspace settings plugins' configs. They are passive authoring metadata
 * (handed to the Lab by plugin type as `rendererPacksConfigSchemas`; Core 0.3 carries no config schema): Core never validates
 * against them, and the Catalog and the Structure editor show them. They state shape
 * only; the config checkers (`./config.ts`) enforce the rest and report it as located diagnostics, and the structure rules
 * (`./plugins/structure.ts`) check that an `appearance` or `notifier` id names a widget of the right type.
 *
 * A unit test pins that each schema's top-level `properties` equal the key lists of `./config.ts`.
 */

import type { ConfigJsonSchema, ConfigSchemaMap } from '../../showcase-host'
import { CONFIG_JSON_SCHEMA_DIALECT } from '../../showcase-host'
import { DENSITIES, MODES, TONES } from './domain'

const I18nTextSchema = {
	type: 'object',
	required: ['en'],
	additionalProperties: { type: 'string' },
	description: 'Text per language, such as { "en": "Name", "zh-TW": "名稱" }. "en" is required; a missing language falls back to it. The Preview offers en and zh-TW.',
} as const satisfies ConfigJsonSchema

const appearanceId = {
	type: 'string',
	minLength: 1,
	description: 'The id of the Appearance widget this one reads its density from. Core has no nearest-ancestor lookup: the provider is named, and the dependency is declared with dep.widget(id).',
} as const satisfies ConfigJsonSchema

export const settingsPageConfigSchema = {
	$schema: CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title'],
	properties: {
		title: { ...I18nTextSchema, description: 'The title of the settings page.' },
	},
} as const satisfies ConfigJsonSchema

export const appearanceConfigSchema = {
	$schema: CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	properties: {
		density: { type: 'string', enum: [...DENSITIES], description: 'The density at the start. Defaults to "comfortable".' },
		mode: { type: 'string', enum: [...MODES], description: 'The colour mode at the start: "auto" follows the host theme. Defaults to "auto".' },
	},
} as const satisfies ConfigJsonSchema

export const notifierConfigSchema = {
	$schema: CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 10, description: 'How many notifications are kept; the oldest is dropped first. Defaults to 4.' },
	},
} as const satisfies ConfigJsonSchema

export const sectionConfigSchema = {
	$schema: CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['title'],
	properties: {
		title: { ...I18nTextSchema, description: 'The heading of the section.' },
		description: { ...I18nTextSchema, description: 'A sentence under the heading.' },
	},
} as const satisfies ConfigJsonSchema

export const textFieldConfigSchema = {
	$schema: CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['label', 'maxLength', 'appearance'],
	properties: {
		label: { ...I18nTextSchema, description: 'The label of the field.' },
		placeholder: { ...I18nTextSchema, description: 'The hint shown while the field is empty.' },
		maxLength: { type: 'integer', minimum: 1, description: 'How many characters are acceptable. A longer value is stored and gets a validation message; the widget does not truncate it.' },
		appearance: appearanceId,
		value: { type: 'string', description: 'The value at the start. Defaults to the empty string.' },
	},
} as const satisfies ConfigJsonSchema

export const toggleConfigSchema = {
	$schema: CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['label', 'appearance'],
	properties: {
		label: { ...I18nTextSchema, description: 'The label of the switch.' },
		appearance: appearanceId,
		on: { type: 'boolean', description: 'Whether the switch is on at the start. Defaults to false.' },
	},
} as const satisfies ConfigJsonSchema

export const choiceConfigSchema = {
	$schema: CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['label', 'appearance', 'options'],
	properties: {
		label: { ...I18nTextSchema, description: 'The label of the choice.' },
		appearance: appearanceId,
		options: {
			type: 'array',
			minItems: 2,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['value', 'label'],
				properties: {
					value: { type: 'string', minLength: 1, description: 'The value the State holds when this option is chosen. Unique within the list.' },
					label: { ...I18nTextSchema, description: 'What the option is called.' },
				},
			},
			description: 'The options to choose between, at least two.',
		},
		value: { type: 'string', description: 'The value of the option chosen at the start. Defaults to the first option.' },
	},
} as const satisfies ConfigJsonSchema

export const dangerActionConfigSchema = {
	$schema: CONFIG_JSON_SCHEMA_DIALECT,
	type: 'object',
	additionalProperties: false,
	required: ['label', 'confirmText', 'message', 'notifier', 'appearance'],
	properties: {
		label: { ...I18nTextSchema, description: 'The label of the button that asks for confirmation.' },
		confirmText: { ...I18nTextSchema, description: 'The question the confirmation shows.' },
		message: { ...I18nTextSchema, description: 'The notification a confirmed action leaves with the Notifier.' },
		tone: { type: 'string', enum: [...TONES], description: 'The tone of that notification. Defaults to "danger", which the page announces as an alert.' },
		notifier: { type: 'string', minLength: 1, description: 'The id of the Notifier widget a confirmed action reports to. Core has no nearest-ancestor lookup: the provider is named, and confirm() invokes its notify Method through dep.widget(id).' },
		appearance: appearanceId,
	},
} as const satisfies ConfigJsonSchema

/** Plugin type to config schema, for the Lab's Catalog and Structure editor. */
export const rendererPacksConfigSchemas = {
	SettingsPage: settingsPageConfigSchema,
	Appearance: appearanceConfigSchema,
	Notifier: notifierConfigSchema,
	Section: sectionConfigSchema,
	TextField: textFieldConfigSchema,
	Toggle: toggleConfigSchema,
	Choice: choiceConfigSchema,
	DangerAction: dangerActionConfigSchema,
} as const satisfies ConfigSchemaMap
