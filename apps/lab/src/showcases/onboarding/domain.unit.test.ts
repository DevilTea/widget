/**
 * The pure helpers: calendar-real dates, times, e-mail addresses, text lookup and the booking office's answers.
 */

import { describe, expect, it } from 'vitest'
import { bookingReference, officeAnswer } from './booking-office'
import { fill, formatDate, isBookingOutcome, isEmail, isIsoDate, isTime, localize } from './domain'

describe('dates and times', () => {
	it('accepts only real calendar dates written YYYY-MM-DD', () => {
		for (const date of ['2026-12-05', '2028-02-29']) {
			expect(isIsoDate(date), date)
				.toBe(true)
		}
		for (const date of ['2026-02-30', '2026-13-01', '2026-12-5', '', 'tomorrow', null, 20261205]) {
			expect(isIsoDate(date), String(date))
				.toBe(false)
		}
	})

	it('accepts only times of day written HH:MM', () => {
		for (const time of ['00:00', '09:30', '23:59']) {
			expect(isTime(time), time)
				.toBe(true)
		}
		for (const time of ['24:00', '9:30', '12:60', '10:00:00', '']) {
			expect(isTime(time), time)
				.toBe(false)
		}
	})

	it('formats a date in the viewer\'s language in UTC, so no time zone moves it', () => {
		expect(formatDate('2026-12-05', 'en'))
			.toBe('Dec 5, 2026')
		expect(formatDate('2026-12-05', 'zh-TW'))
			.toBe('2026年12月5日')
		expect(formatDate('nonsense', 'en'))
			.toBe('nonsense')
	})
})

describe('text', () => {
	it('picks the language and falls back to English', () => {
		expect(localize({ 'en': 'Hello', 'zh-TW': '哈囉' }, 'zh-TW'))
			.toBe('哈囉')
		expect(localize({ en: 'Hello' }, 'zh-TW'))
			.toBe('Hello')
		expect(localize({ 'en': 'Hello', 'zh-TW': '' }, 'zh-TW'))
			.toBe('Hello')
	})

	it('fills {markers} and leaves an unknown one as written', () => {
		expect(fill('{a} and {b}', { a: 1 }))
			.toBe('1 and {b}')
	})

	it('knows an e-mail address when it sees one', () => {
		expect(isEmail(' sam@example.org '))
			.toBe(true)
		expect(isEmail('sam@'))
			.toBe(false)
		expect(isEmail('sam example.org'))
			.toBe(false)
	})
})

describe('the booking office', () => {
	it('confirms every slot except 17:00 with a reference made from the slot, and always declines 17:00', () => {
		expect(officeAnswer({ ticket: 1, date: '2026-12-05', time: '10:00' }))
			.toEqual({ status: 'confirmed', reference: 'TM-20261205-1000' })
		expect(officeAnswer({ ticket: 9, date: '2026-12-19', time: '14:00' }))
			.toEqual({ status: 'confirmed', reference: bookingReference('2026-12-19', '14:00') })
		expect(officeAnswer({ ticket: 1, date: '2026-12-05', time: '17:00' }))
			.toEqual({ status: 'declined', reason: 'fully-booked' })
	})

	it('answers with a shape settleBooking accepts', () => {
		for (const time of ['10:00', '17:00']) {
			expect(isBookingOutcome(officeAnswer({ ticket: 1, date: '2026-12-05', time })), time)
				.toBe(true)
		}
	})
})
