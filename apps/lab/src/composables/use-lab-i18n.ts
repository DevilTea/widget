import type { InjectionKey, Ref } from 'vue'
import type { LabLocale } from '../i18n/locale'
import { inject, shallowRef } from 'vue'
import { LAB_LOCALES, resolveLabLocale } from '../i18n/locale'
import { translateMessage } from '../i18n/messages'

const STORAGE_KEY = 'widget-lab:locale'
const QUERY_KEY = 'lang'

export interface LabI18nStore {
	readonly locale: Readonly<Ref<LabLocale>>
	readonly locales: readonly LabLocale[]
	setLocale: (locale: LabLocale) => void
	/** Translate Lab-owned presentation copy. Unknown strings deliberately fall back to English source. */
	t: (source: string, params?: Readonly<Record<string, string | number>>) => string
}

export const LabI18nKey: InjectionKey<LabI18nStore> = Symbol('widget-lab:i18n')

function readStoredLocale(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY)
	}
	catch {
		return null
	}
}

function persistLocale(locale: LabLocale): void {
	try {
		localStorage.setItem(STORAGE_KEY, locale)
	}
	catch {
		// Persistence is a preference convenience; a blocked storage API must not prevent the Lab loading.
	}
}

function canonicalizeUrl(locale: LabLocale): void {
	const url = new URL(location.href)
	url.searchParams.set(QUERY_KEY, locale)
	history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

function applyDocumentLocale(locale: LabLocale): void {
	document.documentElement.lang = locale
}

function interpolate(message: string, params: Readonly<Record<string, string | number>> | undefined): string {
	if (params === undefined)
		return message
	return message.replace(/\{([\w-]+)\}/g, (match, key: string) => {
		const value = params[key]
		return value === undefined ? match : String(value)
	})
}

/**
 * #43 presentation-preference store. Locale resolution/canonicalization happens once at app creation;
 * later user changes update only locale chrome, URL/localStorage, and `<html lang>` — never LabStore,
 * source/Blueprint/Runtime, focus, or tutorial engine state.
 */
export function createLabI18nStore(): LabI18nStore {
	const url = new URL(location.href)
	const resolved = resolveLabLocale({
		queryLocale: url.searchParams.get(QUERY_KEY),
		storedLocale: readStoredLocale(),
		browserLanguages: navigator.languages.length > 0 ? navigator.languages : [navigator.language],
	})
	const locale = shallowRef<LabLocale>(resolved)

	// A valid query is authoritative and becomes the persisted preference too; when resolution came from
	// storage/browser/fallback, writing the same canonical query makes the current URL deterministic and
	// shareable without a reload. `URL` preserves unrelated query parameters/hash.
	persistLocale(resolved)
	canonicalizeUrl(resolved)
	applyDocumentLocale(resolved)

	return {
		locale,
		locales: LAB_LOCALES,
		setLocale: (next) => {
			if (locale.value !== next)
				locale.value = next
			persistLocale(next)
			canonicalizeUrl(next)
			applyDocumentLocale(next)
		},
		t: (source, params) => interpolate(translateMessage(locale.value, source), params),
	}
}

export function useLabI18n(): LabI18nStore {
	const store = inject(LabI18nKey)
	if (store === undefined)
		throw new Error('useLabI18n() was called outside the LabI18n provider (App.vue).')
	return store
}
