/**
 * Config checkers and `resolve` helpers of the repair desk plugins (the OUTER system), plus the small helpers the notice
 * board checkers (`./board/config.ts`) share.
 *
 * Each plugin's `config.validate` calls its checker with Core's `ctx.addDiagnostic`, so a bad config is an
 * `invalid-widget-config` diagnostic with an exact config `path` and a machine-readable `reason`. Checkers are collectors:
 * they report every problem they find and the plugin decides validity from `ctx.hasAnyDiagnostic()`. Unknown keys are
 * rejected. A widget whose config failed validation is compiled with `resolve(null)`; the fallback is marked `recovered: true`.
 */

import type { JsonValue } from '@deviltea/widget-core'
import type { SavedWith } from './domain'
import { CURRENT_APP_VERSION, describeValue, isRecord, isSavedWith, SAVED_WITH_VERSIONS } from './domain'

export type ConfigPath = readonly (string | number)[]

/** The machine-readable `reason` of a config diagnostic. */
export type ConfigReason
	= | 'not-an-object'
		| 'unknown-key'
		| 'missing-key'
		| 'invalid-type'
		| 'empty-text'
		| 'invalid-version'
		| 'unknown-saved-with'
		| 'not-a-date-string'
		| 'not-a-calendar-date'
		| 'unknown-tone'

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
export function checkObject(input: unknown, allowed: readonly string[], required: readonly string[], path: ConfigPath, report: Report): Record<string, unknown> | null {
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

/** A non-empty string. */
export function checkString(input: unknown, path: ConfigPath, report: Report): void {
	if (typeof input !== 'string')
		report({ message: `${formatConfigPath(path)} must be a string, got ${describeValue(input)}.`, path, reason: 'invalid-type' })
	else if (input.trim() === '')
		report({ message: `${formatConfigPath(path)} must not be empty.`, path, reason: 'empty-text' })
}

/** Text per language such as `{ "en": "...", "zh-TW": "..." }`; `en` is required. */
export function checkText(input: unknown, path: ConfigPath, report: Report): void {
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

// -------------------------------------------------------------------------------------------------
// Raw and resolved configs of the repair desk
// -------------------------------------------------------------------------------------------------

/** The authored config of a RepairDesk. */
export interface RepairDeskRawConfig {
	/**
	 * The notice-board app version that opens the drafts, such as `3.0`. It writes format 3.x.
	 *
	 * @pattern ^\d+\.\d+$
	 */
	readonly appVersion: string
}

/** The authored config of a SavedDraft: the stored document, kept exactly as saved. */
export interface SavedDraftRawConfig {
	/**
	 * What the draft is called in the app's draft list.
	 *
	 * @minLength 1
	 */
	readonly title: string
	/** The format version of the app that saved the draft. The migration plan is chosen by it; Core does not know it. */
	readonly savedWith: SavedWith
	/** The stored legacy document: any JSON value, kept exactly as saved. The widget compiles it with the notice board system and never changes it. */
	readonly source: JsonValue
}

export interface RepairDeskConfig {
	readonly appVersion: string
	readonly recovered: boolean
}

export interface SavedDraftConfig {
	readonly title: string
	readonly savedWith: SavedWith
	readonly source: JsonValue
	readonly recovered: boolean
}

export const REPAIR_DESK_CONFIG_KEYS = ['appVersion'] as const
export const SAVED_DRAFT_CONFIG_KEYS = ['title', 'savedWith', 'source'] as const

const VERSION_PATTERN = /^\d+\.\d+$/

export function checkRepairDeskConfig(input: unknown, report: Report): void {
	const object = checkObject(input, REPAIR_DESK_CONFIG_KEYS, REPAIR_DESK_CONFIG_KEYS, [], report)
	if (object === null || !Object.hasOwn(object, 'appVersion'))
		return
	if (typeof object.appVersion !== 'string' || !VERSION_PATTERN.test(object.appVersion))
		report({ message: `config.appVersion must be a version such as "3.0", got ${describeValue(object.appVersion)}.`, path: ['appVersion'], reason: 'invalid-version' })
}

export function checkSavedDraftConfig(input: unknown, report: Report): void {
	const object = checkObject(input, SAVED_DRAFT_CONFIG_KEYS, SAVED_DRAFT_CONFIG_KEYS, [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'title'))
		checkString(object.title, ['title'], report)
	if (Object.hasOwn(object, 'savedWith') && !isSavedWith(object.savedWith)) {
		report({ message: `config.savedWith must be one of ${SAVED_WITH_VERSIONS.map(version => `"${version}"`)
			.join(', ')}, got ${describeValue(object.savedWith)}: the application knows no format of that version.`, path: ['savedWith'], reason: 'unknown-saved-with' })
	}
	// `source` may be any JSON value, `null` included: what it holds is the application's business, and Core is asked about it later.
}

export function resolveRepairDeskConfig(raw: RepairDeskRawConfig | null): RepairDeskConfig {
	return raw === null
		? { appVersion: CURRENT_APP_VERSION, recovered: true }
		: { appVersion: raw.appVersion, recovered: false }
}

export function resolveSavedDraftConfig(raw: SavedDraftRawConfig | null): SavedDraftConfig {
	return raw === null
		? { title: '', savedWith: '3.x', source: null, recovered: true }
		: { title: raw.title, savedWith: raw.savedWith, source: raw.source, recovered: false }
}
