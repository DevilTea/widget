import type { InjectionKey, Ref } from 'vue'
import { inject } from 'vue'

/**
 * The showcase host contract (issue #230): everything a showcase receives from whoever mounts it.
 *
 * A showcase (`src/showcases/<id>/`, `src/sandbox/`) renders inside the Preview frame and must not import
 * anything of the Lab (stores, i18n tables, CSS tokens, tutorial modules): this directory is the one shared
 * boundary it may import. The host provides a `ShowcaseHost` with `app.provide(ShowcaseHostKey, host)`; the
 * Lab's frame entry (`src/preview-frame-main.ts`) adapts its own theme and locale stores into it, a unit test
 * can provide plain refs. The contract is deliberately only the two things a showcase cannot know for itself:
 * the presentation locale and the colour scheme. Everything else (its messages, its colour tokens, its
 * styling) is the showcase's own.
 */

export const SHOWCASE_LOCALES = ['en', 'zh-TW'] as const

/** A presentation locale the host can ask a showcase to speak. */
export type ShowcaseLocale = typeof SHOWCASE_LOCALES[number]

export const SHOWCASE_THEMES = ['light', 'dark'] as const

/** The colour scheme the host presents the showcase in. */
export type ShowcaseTheme = typeof SHOWCASE_THEMES[number]

export interface ShowcaseHost {
	/** The current presentation locale. Showcase text is selected by it from the showcase's own messages. */
	readonly locale: Readonly<Ref<ShowcaseLocale>>
	/** The current colour scheme. A showcase keys its own colour tokens off it. */
	readonly theme: Readonly<Ref<ShowcaseTheme>>
}

export const ShowcaseHostKey: InjectionKey<ShowcaseHost> = Symbol('widget-lab:showcase-host')

export function useShowcaseHost(): ShowcaseHost {
	const host = inject(ShowcaseHostKey)
	if (host === undefined)
		throw new Error('useShowcaseHost() was called outside a ShowcaseHost provider (the Preview frame entry provides one).')
	return host
}
