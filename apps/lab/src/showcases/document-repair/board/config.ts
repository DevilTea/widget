/**
 * Config checkers and `resolve` helpers of the notice board plugins (the INNER system, the app's document format v3).
 * Same conventions as the repair desk's (`../config.ts`): located `invalid-widget-config` diagnostics with a machine-readable
 * `reason`, unknown keys rejected, `resolve(null)` for a config that failed.
 */

import type { Report } from '../config'
import type { I18nText, Tone } from '../domain'
import { checkObject, checkString, checkText, formatConfigPath } from '../config'
import { describeValue, isIsoDate, isTone, TONES } from '../domain'

export interface BoardRawConfig {
	readonly title: I18nText
}

export interface NoticeRawConfig {
	readonly title: string
	readonly body: string
	/** `YYYY-MM-DD`. */
	readonly until: string
	readonly tone: Tone
}

export interface BoardConfig {
	readonly title: I18nText
	readonly recovered: boolean
}

export interface NoticeConfig extends NoticeRawConfig {
	readonly recovered: boolean
}

export const BOARD_CONFIG_KEYS = ['title'] as const
export const NOTICE_CONFIG_KEYS = ['title', 'body', 'until', 'tone'] as const

export function checkBoardConfig(input: unknown, report: Report): void {
	const object = checkObject(input, BOARD_CONFIG_KEYS, BOARD_CONFIG_KEYS, [], report)
	if (object !== null && Object.hasOwn(object, 'title'))
		checkText(object.title, ['title'], report)
}

export function checkNoticeConfig(input: unknown, report: Report): void {
	const object = checkObject(input, NOTICE_CONFIG_KEYS, NOTICE_CONFIG_KEYS, [], report)
	if (object === null)
		return
	if (Object.hasOwn(object, 'title'))
		checkString(object.title, ['title'], report)
	if (Object.hasOwn(object, 'body') && typeof object.body !== 'string')
		report({ message: `config.body must be a string, got ${describeValue(object.body)}.`, path: ['body'], reason: 'invalid-type' })
	if (Object.hasOwn(object, 'until')) {
		if (typeof object.until !== 'string')
			report({ message: `config.until must be a date string written YYYY-MM-DD, got ${describeValue(object.until)}.`, path: ['until'], reason: 'not-a-date-string' })
		else if (!isIsoDate(object.until))
			report({ message: `${formatConfigPath(['until'])} must be a real calendar date written YYYY-MM-DD, got ${JSON.stringify(object.until)}.`, path: ['until'], reason: 'not-a-calendar-date' })
	}
	if (Object.hasOwn(object, 'tone') && !isTone(object.tone)) {
		report({ message: `config.tone must be one of ${TONES.map(tone => `"${tone}"`)
			.join(', ')}, got ${describeValue(object.tone)}.`, path: ['tone'], reason: 'unknown-tone' })
	}
}

export function resolveBoardConfig(raw: BoardRawConfig | null): BoardConfig {
	return raw === null ? { title: { en: '' }, recovered: true } : { title: raw.title, recovered: false }
}

export function resolveNoticeConfig(raw: NoticeRawConfig | null): NoticeConfig {
	return raw === null
		? { title: '', body: '', until: '1970-01-01', tone: 'info', recovered: true }
		: { ...raw, recovered: false }
}
