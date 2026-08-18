import { describe, expect, it } from 'vitest'
import { parseLabTheme, resolveLabTheme, syntaxThemeForLabTheme } from './theme'

describe('lab theme resolution', () => {
	it('accepts only light/dark persisted values', () => {
		expect(parseLabTheme('light'))
			.toBe('light')
		expect(parseLabTheme('dark'))
			.toBe('dark')
		expect(parseLabTheme('system'))
			.toBeNull()
	})

	it('uses an explicit stored preference before the one-time system default', () => {
		expect(resolveLabTheme('light', true))
			.toBe('light')
		expect(resolveLabTheme('dark', false))
			.toBe('dark')
		expect(resolveLabTheme(null, true))
			.toBe('dark')
		expect(resolveLabTheme(null, false))
			.toBe('light')
	})

	it('maps Lab themes to the two bundled syntax themes', () => {
		expect(syntaxThemeForLabTheme('light'))
			.toBe('one-light')
		expect(syntaxThemeForLabTheme('dark'))
			.toBe('one-dark-pro')
	})
})
