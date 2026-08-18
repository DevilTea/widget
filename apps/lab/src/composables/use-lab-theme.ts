import type { InjectionKey, Ref } from 'vue'
import type { LabTheme } from '../theme/theme'
import { inject, shallowRef } from 'vue'
import { LAB_THEMES, resolveLabTheme } from '../theme/theme'

const STORAGE_KEY = 'widget-lab:theme'

export interface LabThemeStore {
	readonly theme: Readonly<Ref<LabTheme>>
	readonly themes: readonly LabTheme[]
	setTheme: (theme: LabTheme) => void
}

export const LabThemeKey: InjectionKey<LabThemeStore> = Symbol('widget-lab:theme')

function readStoredTheme(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY)
	}
	catch {
		return null
	}
}

function persistTheme(theme: LabTheme): void {
	try {
		localStorage.setItem(STORAGE_KEY, theme)
	}
	catch {
		// Preference persistence is optional; blocked storage must never stop the Lab from loading.
	}
}

function prefersDarkTheme(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

function applyDocumentTheme(theme: LabTheme): void {
	document.documentElement.dataset.labTheme = theme
	document.documentElement.style.colorScheme = theme
}

/** #44 presentation-only theme store. It never depends on or mutates LabStore/Runtime state. */
export function createLabThemeStore(): LabThemeStore {
	const resolved = resolveLabTheme(readStoredTheme(), prefersDarkTheme())
	const theme = shallowRef<LabTheme>(resolved)
	applyDocumentTheme(resolved)

	return {
		theme,
		themes: LAB_THEMES,
		setTheme: (next) => {
			if (theme.value !== next)
				theme.value = next
			persistTheme(next)
			applyDocumentTheme(next)
		},
	}
}

export function useLabTheme(): LabThemeStore {
	const store = inject(LabThemeKey)
	if (store === undefined)
		throw new Error('useLabTheme() was called outside the LabTheme provider (App.vue).')
	return store
}
