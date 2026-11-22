/**
 * The pure domain of the settings page: the colour scheme a pack draws in, the validation message, the notification list and
 * what the page announces. No Runtime, no Vue.
 */

import { describe, expect, it } from 'vitest'
import { announcementsOf, appendNotification, fill, isNotifierItems, localize, resolveScheme, textLength, textProblem } from './domain'

describe('resolveScheme', () => {
	it('is the mode itself, or the host theme for `auto`', () => {
		expect(resolveScheme('auto', 'light'))
			.toBe('light')
		expect(resolveScheme('auto', 'dark'))
			.toBe('dark')
		expect(resolveScheme('light', 'dark'))
			.toBe('light')
		expect(resolveScheme('dark', 'light'))
			.toBe('dark')
	})
})

describe('textProblem', () => {
	it('is null up to the limit and a two-language message beyond it', () => {
		expect(textProblem('abcd', 4))
			.toBeNull()
		expect(textProblem('abcde', 4))
			.toEqual({ 'en': 'Too long: 5 of 4 characters allowed.', 'zh-TW': '太長了：最多 4 個字元，目前 5 個。' })
	})

	it('counts code points, so an emoji or a CJK character is one', () => {
		expect(textLength('🌊🌊'))
			.toBe(2)
		expect(textLength('港灣'))
			.toBe(2)
		expect(textProblem('🌊🌊🌊', 3))
			.toBeNull()
	})
})

describe('notifications', () => {
	const message = { en: 'x' }

	it('appends with the next free id and keeps the newest `limit`', () => {
		let items = appendNotification([], message, 'info', 2)
		expect(items)
			.toEqual({ items: [{ id: 1, message, tone: 'info' }], id: 1 })
		items = appendNotification(items.items, message, 'info', 2)
		items = appendNotification(items.items, message, 'info', 2)
		expect(items.items.map(item => item.id))
			.toEqual([2, 3])
	})

	it('announces the newest danger notification as the alert and the newest other one as the status', () => {
		const items = [
			{ id: 1, message: { en: 'a' }, tone: 'danger' },
			{ id: 2, message: { en: 'b' }, tone: 'success' },
			{ id: 3, message: { en: 'c' }, tone: 'danger' },
			{ id: 4, message: { en: 'd' }, tone: 'info' },
		] as const
		expect(announcementsOf(items))
			.toEqual({ alert: items[2], status: items[3] })
		expect(announcementsOf([]))
			.toEqual({ alert: null, status: null })
	})

	it('accepts only a list of well-formed notifications with distinct ids', () => {
		expect(isNotifierItems([{ id: 1, message: { en: 'x' }, tone: 'info' }]))
			.toBe(true)
		expect(isNotifierItems([{ id: 1, message: { en: 'x' }, tone: 'info' }, { id: 1, message: { en: 'y' }, tone: 'info' }]))
			.toBe(false)
		expect(isNotifierItems([{ id: 0, message: { en: 'x' }, tone: 'info' }]))
			.toBe(false)
		expect(isNotifierItems([{ id: 1, message: { en: 'x' }, tone: 'loud' }]))
			.toBe(false)
		expect(isNotifierItems([{ id: 1, message: { en: 'x' }, tone: 'info', extra: true }]))
			.toBe(false)
		expect(isNotifierItems('items'))
			.toBe(false)
	})
})

describe('text helpers', () => {
	it('falls back to English for a missing language and fills known markers only', () => {
		expect(localize({ 'en': 'Hello', 'zh-TW': '哈囉' }, 'zh-TW'))
			.toBe('哈囉')
		expect(localize({ en: 'Hello' }, 'zh-TW'))
			.toBe('Hello')
		expect(fill('{a} of {b} {c}', { a: 1, b: 2 }))
			.toBe('1 of 2 {c}')
	})
})
