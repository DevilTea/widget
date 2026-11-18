/**
 * The one place the trip-budget showcase touches its host (the Lab's Preview frame): the two presentation
 * facts a renderer legitimately needs from it, the interface locale and the light/dark theme.
 *
 * Nothing else in this showcase imports a Lab module: the plugins are plain Core, the renderers read only
 * Widget (`useWidget`), `@deviltea/widget-inspector/anchor` and this file, and their styling is their own
 * `--trip-*` custom properties (defined by the root renderer from `theme`), never the chrome's tokens.
 *
 * This file is deliberately thin, so it can later be swapped onto a shared showcase-host contract without
 * touching a renderer: it only adapts the Lab's provide/inject stores to two readonly refs. Outside the Lab
 * (a unit test that provides nothing) it falls back to English and light.
 *
 * `locale` is the host's interface locale. The trip's own language is Widget State (`Trip.language`, so it
 * is part of the Runtime the Lab inspects) and does not follow it; the locale is exposed for the contract.
 */

import type { ComputedRef } from 'vue'
import { computed, inject } from 'vue'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import { LabThemeKey } from '../../composables/use-lab-theme'

export type TripTheme = 'light' | 'dark'

export interface TripShowcaseHost {
	readonly locale: ComputedRef<string>
	readonly theme: ComputedRef<TripTheme>
}

export function useTripShowcaseHost(): TripShowcaseHost {
	const i18n = inject(LabI18nKey, null)
	const themeStore = inject(LabThemeKey, null)
	return {
		locale: computed(() => i18n?.locale.value ?? 'en'),
		theme: computed(() => themeStore?.theme.value === 'dark' ? 'dark' : 'light'),
	}
}
