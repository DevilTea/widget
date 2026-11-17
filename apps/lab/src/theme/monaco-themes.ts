/**
 * The Monaco editor's colour themes (audit U18): the bundled `one-light` and `one-dark-pro` TextMate themes with the
 * few colours that fall below WCAG 2.1 AA text contrast (4.5:1) replaced by ones that meet it. Measured against the
 * editor background with axe-core on the JSON editor: the light line numbers were 2.59:1, the light string green 3.07:1
 * and the light property-name red 3.51:1; the dark line numbers 1.75:1 and the dark property-name red 4.38:1. Nothing
 * else is changed, so the editor still looks like One Light and One Dark Pro. The replacement is by colour, over every rule of
 * the base theme that uses it, so no token of that colour keeps the low-contrast one. The Shiki viewer of the Implementation
 * panel reads the unmodified themes (it is a separate surface and was not part of that finding).
 */

import oneDarkProTheme from 'tm-themes/themes/one-dark-pro.json'
import oneLightTheme from 'tm-themes/themes/one-light.json'

interface TextMateRule {
	readonly scope?: string | readonly string[]
	readonly settings: Readonly<Record<string, string>>
}

interface TextMateTheme {
	readonly name?: string
	readonly colors: Readonly<Record<string, string>>
	readonly tokenColors: readonly TextMateRule[]
	readonly [key: string]: unknown
}

/** Colours replaced in each theme (value-for-value, wherever a rule uses them). Every new colour is at least 4.5:1 against that theme's `editor.background`. */
export const LIGHT_CONTRAST_FIXES = {
	lineNumber: '#696c77',
	/** One Light's string green, `#50a14f` (3.07:1). */
	string: '#2e7d32',
	/** JSON property names, `#e45649` (3.51:1). */
	propertyName: '#c0392b',
	/** `true`, `false`, `null` and other teal tokens, `#0184bc` (4.0:1). */
	teal: '#0073ab',
} as const

export const DARK_CONTRAST_FIXES = {
	lineNumber: '#8a93a8',
	/** JSON property names, `#e06c75` (4.38:1). */
	propertyName: '#e87a83',
} as const

function withFixes(base: TextMateTheme, colors: Record<string, string>, recolor: Readonly<Record<string, string>>): TextMateTheme {
	return {
		...base,
		colors: { ...base.colors, ...colors },
		tokenColors: base.tokenColors.map((rule) => {
			const foreground = rule.settings.foreground?.toLowerCase()
			const replacement = foreground === undefined ? undefined : recolor[foreground]
			return replacement === undefined ? rule : { ...rule, settings: { ...rule.settings, foreground: replacement } }
		}),
	}
}

export const labOneLightTheme: TextMateTheme = withFixes(oneLightTheme as unknown as TextMateTheme, {
	'editorLineNumber.foreground': LIGHT_CONTRAST_FIXES.lineNumber,
}, {
	'#50a14f': LIGHT_CONTRAST_FIXES.string,
	'#e45649': LIGHT_CONTRAST_FIXES.propertyName,
	'#0184bc': LIGHT_CONTRAST_FIXES.teal,
})

export const labOneDarkProTheme: TextMateTheme = withFixes(oneDarkProTheme as unknown as TextMateTheme, {
	'editorLineNumber.foreground': DARK_CONTRAST_FIXES.lineNumber,
}, {
	'#e06c75': DARK_CONTRAST_FIXES.propertyName,
})
