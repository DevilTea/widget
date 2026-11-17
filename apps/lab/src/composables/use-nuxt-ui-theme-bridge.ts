import type { Ref } from 'vue'
import type { LabTheme } from '../theme/theme'
import { watchEffect } from 'vue'

/**
 * Theme bridge, Lab -> Nuxt UI. The Lab theme store (`use-lab-theme.ts`, `data-lab-theme` on `<html>`) is the
 * single source of truth for light/dark. Nuxt UI keys its `dark:` variants and its dark token block on a
 * `.dark` class, so this mirrors the store onto that class. Nuxt UI's own colour-mode plugin
 * (`useDark()` with its `vueuse-color-scheme` localStorage entry) is deliberately not installed
 * (`colorMode: false` in `nuxt-ui.ts`), so nothing else can set the class and the two cannot disagree.
 *
 * Lab shell only: `App.vue` calls it, the Preview frame does not (it loads no Tailwind/Nuxt UI CSS).
 * The `--ui-*` colour tokens need no per-theme handling, they are `var(--lab-color-*)` references
 * (`styles/lab-ui.css`).
 */
export const NUXT_UI_DARK_CLASS = 'dark'

export function applyNuxtUiThemeClass(root: HTMLElement, theme: LabTheme): void {
	root.classList.toggle(NUXT_UI_DARK_CLASS, theme === 'dark')
}

export function useNuxtUiThemeBridge(theme: Readonly<Ref<LabTheme>>, root: HTMLElement = document.documentElement): void {
	// `sync` keeps the class and `data-lab-theme` flipping in the same task, so no frame paints them apart.
	watchEffect(() => applyNuxtUiThemeClass(root, theme.value), { flush: 'sync' })
}
