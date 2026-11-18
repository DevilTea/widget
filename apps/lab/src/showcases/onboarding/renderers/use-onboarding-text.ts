/**
 * What every onboarding renderer needs to speak the host's language: the showcase's own messages, the document's
 * `{ "en", "zh-TW" }` texts, dates in the viewer's locale and the explanation of a Method refusal. All of it follows
 * `useShowcaseHost().locale`.
 */

import type { I18nText } from '../domain'
import { useShowcaseHost, useShowcaseMessages } from '../../../showcase-host'
import { fill, formatDate, localize } from '../domain'
import { onboardingMessages as messages, PROBLEM_MESSAGE_KEYS } from '../messages'

type Key = keyof typeof messages['en']

export interface OnboardingText {
	readonly locale: () => string
	readonly t: (key: Key) => string
	/** `t(key)` with its `{name}` markers filled in. */
	readonly tf: (key: Key, values: Readonly<Record<string, string | number>>) => string
	readonly text: (value: I18nText) => string
	readonly date: (value: string) => string
	/** The viewer-language explanation of a refusal by its `reason`, or `fallback` (the Core message) for a reason this page does not know. */
	readonly problem: (reason: string | undefined, fallback: string) => string
}

export function useOnboardingText(): OnboardingText {
	const host = useShowcaseHost()
	const { t } = useShowcaseMessages(messages)
	return {
		locale: () => host.locale.value,
		t,
		tf: (key, values) => fill(t(key), values),
		text: value => localize(value, host.locale.value),
		date: value => formatDate(value, host.locale.value),
		problem: (reason, fallback) => {
			const key = reason === undefined || !Object.hasOwn(PROBLEM_MESSAGE_KEYS, reason) ? undefined : PROBLEM_MESSAGE_KEYS[reason]
			return key === undefined ? fallback : t(key)
		},
	}
}
