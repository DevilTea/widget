export const LAB_LOCALES = ['en', 'zh-TW'] as const

export type LabLocale = typeof LAB_LOCALES[number]

export const DEFAULT_LAB_LOCALE: LabLocale = 'en'

export function parseLabLocale(value: string | null | undefined): LabLocale | null {
	return value === 'en' || value === 'zh-TW' ? value : null
}

export function localeFromBrowserLanguages(languages: readonly string[]): LabLocale | null {
	for (const language of languages) {
		const normalized = language.trim()
			.toLowerCase()
		if (normalized === '')
			continue
		if (normalized === 'zh-tw' || normalized.startsWith('zh-hant'))
			return 'zh-TW'
		if (normalized === 'en' || normalized.startsWith('en-'))
			return 'en'
	}
	return null
}

export interface ResolveLabLocaleInput {
	readonly queryLocale?: string | null
	readonly storedLocale?: string | null
	readonly browserLanguages?: readonly string[]
}

/** Normative #43 precedence: valid query > persisted preference > browser language > English. */
export function resolveLabLocale(input: ResolveLabLocaleInput): LabLocale {
	return parseLabLocale(input.queryLocale)
		?? parseLabLocale(input.storedLocale)
		?? localeFromBrowserLanguages(input.browserLanguages ?? [])
		?? DEFAULT_LAB_LOCALE
}
