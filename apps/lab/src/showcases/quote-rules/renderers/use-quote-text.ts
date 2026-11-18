/**
 * What every quote renderer needs to speak the host's language: the showcase's own messages, the document's
 * `{ "en", "zh-TW" }` texts and money in the viewer's locale. All of it follows `useShowcaseHost().locale`.
 */

import type { ComputedRef, Ref } from 'vue'
import type { I18nText } from '../domain'
import { computed } from 'vue'
import { useShowcaseHost, useShowcaseMessages } from '../../../showcase-host'
import { formatMoney, formatSignedMoney, localize } from '../domain'
import { fill, quoteMessages as messages } from '../messages'

type Key = keyof typeof messages['en']

export interface QuoteText {
	readonly language: Readonly<Ref<string>>
	readonly t: (key: Key) => string
	/** `t(key)` with its `{name}` markers filled in. */
	readonly tf: (key: Key, values: Readonly<Record<string, string>>) => string
	readonly text: (value: I18nText) => string
	readonly money: (cents: number, currency: string) => string
	readonly signed: (cents: number, currency: string) => string
}

export function useQuoteText(): QuoteText {
	const host = useShowcaseHost()
	const { t } = useShowcaseMessages(messages)
	return {
		language: host.locale,
		t,
		tf: (key, values) => fill(t(key), values),
		text: value => localize(value, host.locale.value),
		money: (cents, currency) => formatMoney(cents, currency, host.locale.value),
		signed: (cents, currency) => formatSignedMoney(cents, currency, host.locale.value),
	}
}

export interface SafeRead<Value> {
	readonly value: Value | null
	/** `true` when reading the Property threw (an implementation exception), as opposed to failing with a diagnostic. */
	readonly threw: boolean
}

/**
 * A Property ref that cannot break the render. A Property projects a diagnostic failure to `null`, but a
 * `compute` that throws makes the ref's getter throw, and an exception in a render function takes the whole
 * component with it. Reading through this keeps the component alive: the ref has subscribed and tracked
 * before it threw, so it recovers when a later recompute succeeds.
 */
export function useSafeRead<Value>(source: Readonly<Ref<Value | null>>): ComputedRef<SafeRead<Value>> {
	return computed(() => {
		try {
			return { value: source.value, threw: false }
		}
		catch {
			return { value: null, threw: true }
		}
	})
}
