/**
 * Config checkers and `resolve` helpers of the workspace settings plugins.
 *
 * Each plugin's `config.validate` calls its checker with Core's `ctx.addDiagnostic`, so a bad config is an
 * `invalid-widget-config` diagnostic with an exact config `path` and a machine-readable `reason`. Checkers are collectors:
 * they report every problem they find and the plugin decides validity from `ctx.hasAnyDiagnostic()`. Unknown keys are
 * rejected. A widget whose config failed validation is compiled with `resolve(null)`; the fallback is marked `recovered: true`.
 *
 * What a config says about ANOTHER widget (`appearance`, `notifier`: the id of a provider) is only a string here; that the id
 * names a widget of the right type is a structure rule (`./plugins/structure.ts`), because only a structure validator sees the
 * Blueprint.
 */

import type { ChoiceOption, Density, I18nText, Mode, Tone } from './domain'
import { DEFAULT_NOTIFIER_LIMIT, DENSITIES, describeValue, isRecord, MODES, TONES } from './domain'

export type ConfigPath = readonly (string | number)[]

/** The machine-readable `reason` of a config diagnostic. */
export type ConfigReason
	= | 'not-an-object'
		| 'unknown-key'
		| 'missing-key'
		| 'invalid-type'
		| 'empty-text'
		| 'unknown-density'
		| 'unknown-mode'
		| 'unknown-tone'
		| 'invalid-limit'
		| 'invalid-max-length'
		| 'too-few-options'
		| 'duplicate-option'
		| 'unknown-option'
		| 'empty-id'

export interface ConfigDiagnostic {
	readonly message: string
	readonly path?: ConfigPath
	readonly reason?: ConfigReason
}

export type Report = (diagnostic: ConfigDiagnostic) => void

export function formatConfigPath(path: ConfigPath): string {
	return path.length === 0
		? 'config'
		: `config.${path.map(String)
			.join('.')}`
}

/** Reports a non-object, unknown keys and missing required keys; returns the object when it is one. */
function checkObject(input: unknown, allowed: readonly string[], required: readonly string[], path: ConfigPath, report: Report): Record<string, unknown> | null {
	if (!isRecord(input)) {
		report({ message: `${formatConfigPath(path)} must be an object, got ${describeValue(input)}.`, path, reason: 'not-an-object' })
		return null
	}
	for (const key of Object.keys(input)) {
		if (!allowed.includes(key))
			report({ message: `${formatConfigPath([...path, key])} is not a known key. Expected: ${allowed.join(', ')}.`, path: [...path, key], reason: 'unknown-key' })
	}
	for (const key of required) {
		if (!Object.hasOwn(input, key))
			report({ message: `${formatConfigPath([...path, key])} is required.`, path: [...path, key], reason: 'missing-key' })
	}
	return input
}

/** Text per language such as `{ "en": "...", "zh-TW": "..." }`; `en` is required. */
function checkText(input: unknown, path: ConfigPath, report: Report): void {
	if (!isRecord(input)) {
		report({ message: `${formatConfigPath(path)} must be text per language such as { "en": "..." }, got ${describeValue(input)}.`, path, reason: 'invalid-type' })
		return
	}
	if (typeof input.en !== 'string' || input.en.trim() === '')
		report({ message: `${formatConfigPath([...path, 'en'])} must be a non-empty string: "en" is the language every other one falls back to.`, path: [...path, 'en'], reason: 'empty-text' })
	for (const [language, value] of Object.entries(input)) {
		if (language !== 'en' && typeof value !== 'string')
			report({ message: `${formatConfigPath([...path, language])} must be a string.`, path: [...path, language], reason: 'invalid-type' })
	}
}

/** The id of another widget: only its shape is checked here, see the file comment. */
function checkId(input: unknown, path: ConfigPath, report: Report): void {
	if (typeof input !== 'string')
		report({ message: `${formatConfigPath(path)} must be the id of a widget, got ${describeValue(input)}.`, path, reason: 'invalid-type' })
	else if (input.trim() === '')
		report({ message: `${formatConfigPath(path)} must not be empty.`, path, reason: 'empty-id' })
}

function checkOneOf(input: unknown, values: readonly string[], reason: ConfigReason, path: ConfigPath, report: Report): void {
	if (typeof input !== 'string' || !values.includes(input)) {
		report({ message: `${formatConfigPath(path)} must be one of ${values.map(value => `"${value}"`)
			.join(', ')}, got ${describeValue(input)}.`, path, reason })
	}
}

// -------------------------------------------------------------------------------------------------
// Raw and resolved configs
// -------------------------------------------------------------------------------------------------

/** The authored config of a SettingsPage. */
export interface SettingsPageRawConfig {
	/** The title of the settings page. */
	readonly title: I18nText
}
export interface SettingsPageConfig { readonly title: I18nText, readonly recovered: boolean }

/** The authored config of an Appearance. */
export interface AppearanceRawConfig {
	/** The density at the start. Defaults to "comfortable". */
	readonly density?: Density
	/** The colour mode at the start: "auto" follows the host theme. Defaults to "auto". */
	readonly mode?: Mode
}
export interface AppearanceConfig { readonly density: Density, readonly mode: Mode, readonly recovered: boolean }

/** The authored config of a Notifier. */
export interface NotifierRawConfig {
	/**
	 * How many notifications are kept; the oldest is dropped first. Defaults to 4.
	 *
	 * @minimum 1
	 * @maximum 10
	 */
	readonly limit?: number
}
export interface NotifierConfig { readonly limit: number, readonly recovered: boolean }

/** The authored config of a Section. */
export interface SectionRawConfig {
	/** The heading of the section. */
	readonly title: I18nText
	/** A sentence under the heading. */
	readonly description?: I18nText
}
export interface SectionConfig { readonly title: I18nText, readonly description: I18nText | null, readonly recovered: boolean }

/** The authored config of a TextField. */
export interface TextFieldRawConfig {
	/** The label of the field. */
	readonly label: I18nText
	/** The hint shown while the field is empty. */
	readonly placeholder?: I18nText
	/**
	 * How many characters are acceptable. A longer value is stored and gets a validation message; the widget does not
	 * truncate it.
	 *
	 * @minimum 1
	 */
	readonly maxLength: number
	/**
	 * The id of the Appearance widget this one reads its density from. Core has no nearest-ancestor lookup: the provider is
	 * named, and the dependency is declared with dep.widget(id).
	 *
	 * @minLength 1
	 * @widgetRef Appearance
	 */
	readonly appearance: string
	/** The value at the start. Defaults to the empty string. */
	readonly value?: string
}
export interface TextFieldConfig {
	readonly label: I18nText
	readonly placeholder: I18nText | null
	readonly maxLength: number
	readonly appearance: string
	readonly value: string
	readonly recovered: boolean
}

/** The authored config of a Toggle. */
export interface ToggleRawConfig {
	/** The label of the switch. */
	readonly label: I18nText
	/**
	 * The id of the Appearance widget this one reads its density from. Core has no nearest-ancestor lookup: the provider is
	 * named, and the dependency is declared with dep.widget(id).
	 *
	 * @minLength 1
	 * @widgetRef Appearance
	 */
	readonly appearance: string
	/** Whether the switch is on at the start. Defaults to false. */
	readonly on?: boolean
}
export interface ToggleConfig { readonly label: I18nText, readonly appearance: string, readonly on: boolean, readonly recovered: boolean }

/** The authored config of a Choice. */
export interface ChoiceRawConfig {
	/** The label of the choice. */
	readonly label: I18nText
	/**
	 * The id of the Appearance widget this one reads its density from. Core has no nearest-ancestor lookup: the provider is
	 * named, and the dependency is declared with dep.widget(id).
	 *
	 * @minLength 1
	 * @widgetRef Appearance
	 */
	readonly appearance: string
	/**
	 * The options to choose between, at least two.
	 *
	 * @minItems 2
	 */
	readonly options: readonly ChoiceOption[]
	/** The value of the option chosen at the start. Defaults to the first option. */
	readonly value?: string
}
export interface ChoiceConfig {
	readonly label: I18nText
	readonly appearance: string
	readonly options: readonly ChoiceOption[]
	readonly value: string
	readonly recovered: boolean
}

/** The authored config of a DangerAction. */
export interface DangerActionRawConfig {
	/** The label of the button that asks for confirmation. */
	readonly label: I18nText
	/** The question the confirmation shows. */
	readonly confirmText: I18nText
	/** The notification a confirmed action leaves with the Notifier. */
	readonly message: I18nText
	/** The tone of that notification. Defaults to "danger", which the page announces as an alert. */
	readonly tone?: Tone
	/**
	 * The id of the Notifier widget a confirmed action reports to. Core has no nearest-ancestor lookup: the provider is named,
	 * and confirm() invokes its notify Method through dep.widget(id).
	 *
	 * @minLength 1
	 * @widgetRef Notifier
	 */
	readonly notifier: string
	/**
	 * The id of the Appearance widget this one reads its density from. Core has no nearest-ancestor lookup: the provider is
	 * named, and the dependency is declared with dep.widget(id).
	 *
	 * @minLength 1
	 * @widgetRef Appearance
	 */
	readonly appearance: string
}
export interface DangerActionConfig {
	readonly label: I18nText
	readonly confirmText: I18nText
	readonly message: I18nText
	readonly tone: Tone
	readonly notifier: string
	readonly appearance: string
	readonly recovered: boolean
}

export const SETTINGS_PAGE_CONFIG_KEYS = ['title'] as const
export const APPEARANCE_CONFIG_KEYS = ['density', 'mode'] as const
export const NOTIFIER_CONFIG_KEYS = ['limit'] as const
export const SECTION_CONFIG_KEYS = ['title', 'description'] as const
export const TEXT_FIELD_CONFIG_KEYS = ['label', 'placeholder', 'maxLength', 'appearance', 'value'] as const
export const TOGGLE_CONFIG_KEYS = ['label', 'appearance', 'on'] as const
export const CHOICE_CONFIG_KEYS = ['label', 'appearance', 'options', 'value'] as const
export const DANGER_ACTION_CONFIG_KEYS = ['label', 'confirmText', 'message', 'tone', 'notifier', 'appearance'] as const

const EMPTY_TEXT: I18nText = { en: '' }

export function checkSettingsPageConfig(input: unknown, report: Report): void {
	const object = checkObject(input, SETTINGS_PAGE_CONFIG_KEYS, ['title'], [], report)
	if (object !== null && Object.hasOwn(object, 'title'))
		checkText(object.title, ['title'], report)
}

export function checkAppearanceConfig(input: unknown, report: Report): void {
	const object = checkObject(input, APPEARANCE_CONFIG_KEYS, [], [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'density'))
		checkOneOf(object.density, DENSITIES, 'unknown-density', ['density'], report)
	if (Object.hasOwn(object, 'mode'))
		checkOneOf(object.mode, MODES, 'unknown-mode', ['mode'], report)
}

export function checkNotifierConfig(input: unknown, report: Report): void {
	const object = checkObject(input, NOTIFIER_CONFIG_KEYS, [], [], report)
	if (object === null || !Object.hasOwn(object, 'limit'))
		return
	const { limit } = object
	if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 10)
		report({ message: `config.limit must be a whole number from 1 to 10, got ${describeValue(limit)}.`, path: ['limit'], reason: 'invalid-limit' })
}

export function checkSectionConfig(input: unknown, report: Report): void {
	const object = checkObject(input, SECTION_CONFIG_KEYS, ['title'], [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'title'))
		checkText(object.title, ['title'], report)
	if (Object.hasOwn(object, 'description'))
		checkText(object.description, ['description'], report)
}

export function checkTextFieldConfig(input: unknown, report: Report): void {
	const object = checkObject(input, TEXT_FIELD_CONFIG_KEYS, ['label', 'maxLength', 'appearance'], [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'label'))
		checkText(object.label, ['label'], report)
	if (Object.hasOwn(object, 'placeholder'))
		checkText(object.placeholder, ['placeholder'], report)
	if (Object.hasOwn(object, 'appearance'))
		checkId(object.appearance, ['appearance'], report)
	if (Object.hasOwn(object, 'maxLength')) {
		const { maxLength } = object
		if (typeof maxLength !== 'number' || !Number.isInteger(maxLength) || maxLength < 1)
			report({ message: `config.maxLength must be a whole number of at least 1, got ${describeValue(maxLength)}.`, path: ['maxLength'], reason: 'invalid-max-length' })
	}
	if (Object.hasOwn(object, 'value') && typeof object.value !== 'string')
		report({ message: `config.value must be a string, got ${describeValue(object.value)}.`, path: ['value'], reason: 'invalid-type' })
}

export function checkToggleConfig(input: unknown, report: Report): void {
	const object = checkObject(input, TOGGLE_CONFIG_KEYS, ['label', 'appearance'], [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'label'))
		checkText(object.label, ['label'], report)
	if (Object.hasOwn(object, 'appearance'))
		checkId(object.appearance, ['appearance'], report)
	if (Object.hasOwn(object, 'on') && typeof object.on !== 'boolean')
		report({ message: `config.on must be true or false, got ${describeValue(object.on)}.`, path: ['on'], reason: 'invalid-type' })
}

export function checkChoiceConfig(input: unknown, report: Report): void {
	const object = checkObject(input, CHOICE_CONFIG_KEYS, ['label', 'appearance', 'options'], [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'label'))
		checkText(object.label, ['label'], report)
	if (Object.hasOwn(object, 'appearance'))
		checkId(object.appearance, ['appearance'], report)
	const values: string[] = []
	if (Object.hasOwn(object, 'options')) {
		const { options } = object
		if (!Array.isArray(options)) {
			report({ message: `config.options must be a list of { value, label }, got ${describeValue(options)}.`, path: ['options'], reason: 'invalid-type' })
		}
		else {
			if (options.length < 2)
				report({ message: 'config.options needs at least two options to choose between.', path: ['options'], reason: 'too-few-options' })
			options.forEach((option: unknown, index) => {
				const checked = checkObject(option, ['value', 'label'], ['value', 'label'], ['options', index], report)
				if (checked === null)
					return
				if (Object.hasOwn(checked, 'value')) {
					if (typeof checked.value !== 'string' || checked.value === '') {
						report({ message: `config.options.${index}.value must be a non-empty string, got ${describeValue(checked.value)}.`, path: ['options', index, 'value'], reason: 'invalid-type' })
					}
					else if (values.includes(checked.value)) {
						report({ message: `config.options.${index}.value "${checked.value}" is listed twice.`, path: ['options', index, 'value'], reason: 'duplicate-option' })
					}
					else {
						values.push(checked.value)
					}
				}
				if (Object.hasOwn(checked, 'label'))
					checkText(checked.label, ['options', index, 'label'], report)
			})
		}
	}
	if (Object.hasOwn(object, 'value') && (typeof object.value !== 'string' || (values.length > 0 && !values.includes(object.value)))) {
		report({ message: `config.value must be the value of one of the options (${values.map(value => `"${value}"`)
			.join(', ')}), got ${describeValue(object.value)}.`, path: ['value'], reason: 'unknown-option' })
	}
}

export function checkDangerActionConfig(input: unknown, report: Report): void {
	const object = checkObject(input, DANGER_ACTION_CONFIG_KEYS, ['label', 'confirmText', 'message', 'notifier', 'appearance'], [], report)
	if (object === null)
		return
	for (const key of ['label', 'confirmText', 'message'] as const) {
		if (Object.hasOwn(object, key))
			checkText(object[key], [key], report)
	}
	for (const key of ['notifier', 'appearance'] as const) {
		if (Object.hasOwn(object, key))
			checkId(object[key], [key], report)
	}
	if (Object.hasOwn(object, 'tone'))
		checkOneOf(object.tone, TONES, 'unknown-tone', ['tone'], report)
}

export function resolveSettingsPageConfig(raw: SettingsPageRawConfig | null): SettingsPageConfig {
	return raw === null ? { title: EMPTY_TEXT, recovered: true } : { title: raw.title, recovered: false }
}

export function resolveAppearanceConfig(raw: AppearanceRawConfig | null): AppearanceConfig {
	return { density: raw?.density ?? 'comfortable', mode: raw?.mode ?? 'auto', recovered: raw === null }
}

export function resolveNotifierConfig(raw: NotifierRawConfig | null): NotifierConfig {
	return { limit: raw?.limit ?? DEFAULT_NOTIFIER_LIMIT, recovered: raw === null }
}

export function resolveSectionConfig(raw: SectionRawConfig | null): SectionConfig {
	return raw === null
		? { title: EMPTY_TEXT, description: null, recovered: true }
		: { title: raw.title, description: raw.description ?? null, recovered: false }
}

export function resolveTextFieldConfig(raw: TextFieldRawConfig | null): TextFieldConfig {
	return raw === null
		? { label: EMPTY_TEXT, placeholder: null, maxLength: 1, appearance: '', value: '', recovered: true }
		: { label: raw.label, placeholder: raw.placeholder ?? null, maxLength: raw.maxLength, appearance: raw.appearance, value: raw.value ?? '', recovered: false }
}

export function resolveToggleConfig(raw: ToggleRawConfig | null): ToggleConfig {
	return raw === null
		? { label: EMPTY_TEXT, appearance: '', on: false, recovered: true }
		: { label: raw.label, appearance: raw.appearance, on: raw.on ?? false, recovered: false }
}

export function resolveChoiceConfig(raw: ChoiceRawConfig | null): ChoiceConfig {
	return raw === null
		? { label: EMPTY_TEXT, appearance: '', options: [], value: '', recovered: true }
		: { label: raw.label, appearance: raw.appearance, options: raw.options, value: raw.value ?? raw.options[0]?.value ?? '', recovered: false }
}

export function resolveDangerActionConfig(raw: DangerActionRawConfig | null): DangerActionConfig {
	return raw === null
		? { label: EMPTY_TEXT, confirmText: EMPTY_TEXT, message: EMPTY_TEXT, tone: 'danger', notifier: '', appearance: '', recovered: true }
		: { label: raw.label, confirmText: raw.confirmText, message: raw.message, tone: raw.tone ?? 'danger', notifier: raw.notifier, appearance: raw.appearance, recovered: false }
}
