import { describe, expect, it } from 'vitest'
import { DARK_CONTRAST_FIXES, labOneDarkProTheme, labOneLightTheme, LIGHT_CONTRAST_FIXES } from './monaco-themes'

function luminance(hex: string): number {
	const channel = (offset: number): number => {
		const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(foreground: string, background: string): number {
	const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
	return (lighter! + 0.05) / (darker! + 0.05)
}

/** The foreground the theme gives a scope: the last rule that names it wins, as TextMate resolves equal specificity. */
function foregroundOf(theme: typeof labOneLightTheme, scope: string): string | undefined {
	let found: string | undefined
	for (const rule of theme.tokenColors) {
		const scopes = typeof rule.scope === 'string' ? [rule.scope] : rule.scope ?? []
		if (scopes.includes(scope))
			found = rule.settings.foreground
	}
	return found
}

describe('monaco themes (audit U18)', () => {
	it('keep the names Monaco is asked for', () => {
		expect(labOneLightTheme.name)
			.toBe('one-light')
		expect(labOneDarkProTheme.name)
			.toBe('one-dark-pro')
	})

	for (const [name, theme] of [['light', labOneLightTheme], ['dark', labOneDarkProTheme]] as const) {
		it(`${name}: line numbers and JSON property names reach 4.5:1 on the editor background`, () => {
			const background = theme.colors['editor.background']!
			expect(contrast(theme.colors['editorLineNumber.foreground']!, background))
				.toBeGreaterThanOrEqual(4.5)
			expect(contrast(foregroundOf(theme, 'support.type.property-name.json')!, background))
				.toBeGreaterThanOrEqual(4.5)
		})
	}

	it('light: strings reach 4.5:1 too, and every replaced colour is the documented one', () => {
		const background = labOneLightTheme.colors['editor.background']!
		expect(contrast(foregroundOf(labOneLightTheme, 'string')!, background))
			.toBeGreaterThanOrEqual(4.5)
		expect([...Object.values(LIGHT_CONTRAST_FIXES), ...Object.values(DARK_CONTRAST_FIXES)])
			.toHaveLength(6)
	})

	it('change nothing else of the base theme', () => {
		expect(Object.keys(labOneLightTheme.colors))
			.toContain('editor.background')
		expect(labOneLightTheme.colors['editor.background'])
			.toBe('#FAFAFA')
		expect(labOneDarkProTheme.colors['editor.background'])
			.toBe('#282c34')
	})
})
