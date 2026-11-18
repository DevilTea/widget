import type { ShowcaseLocale } from './host'
import { useShowcaseHost } from './host'

/**
 * A showcase's own text, one table per locale of the host contract. Every locale must carry every key
 * (the type enforces it), so a showcase never falls back to another locale's text.
 */
export type ShowcaseMessages<Key extends string> = Readonly<Record<ShowcaseLocale, Readonly<Record<Key, string>>>>

/** Identity helper that infers the key union from the tables. */
export function defineShowcaseMessages<const Key extends string>(messages: ShowcaseMessages<Key>): ShowcaseMessages<Key> {
	return messages
}

export function translateShowcaseMessage<Key extends string>(messages: ShowcaseMessages<Key>, locale: ShowcaseLocale, key: Key): string {
	return messages[locale][key]
}

/**
 * `t(key)` for the host's current locale. It reads `host.locale` on every call, so calling it in a template or
 * a computed re-renders on a locale switch.
 */
export function useShowcaseMessages<Key extends string>(messages: ShowcaseMessages<Key>): { readonly t: (key: Key) => string } {
	const host = useShowcaseHost()
	return { t: key => translateShowcaseMessage(messages, host.locale.value, key) }
}
