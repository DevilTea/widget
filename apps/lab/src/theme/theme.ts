export const LAB_THEMES = ['light', 'dark'] as const

export type LabTheme = typeof LAB_THEMES[number]

export const DEFAULT_LAB_THEME: LabTheme = 'light'

export function parseLabTheme(value: string | null | undefined): LabTheme | null {
	return value === 'light' || value === 'dark' ? value : null
}

/** Explicit persisted preference wins; system color-scheme is only the first-visit default. */
export function resolveLabTheme(storedTheme: string | null | undefined, prefersDark: boolean): LabTheme {
	return parseLabTheme(storedTheme) ?? (prefersDark ? 'dark' : DEFAULT_LAB_THEME)
}

/** Bundled syntax-theme name shared by Monaco and the lazy Shiki viewer. */
export function syntaxThemeForLabTheme(theme: LabTheme): 'one-light' | 'one-dark-pro' {
	return theme === 'light' ? 'one-light' : 'one-dark-pro'
}
