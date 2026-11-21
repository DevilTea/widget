/**
 * What every repair desk renderer needs to speak the host's language: the showcase's own messages, the application's
 * `{ "en", "zh-TW" }` plan texts, dates in the viewer's locale and the explanation of a refused patch. All of it follows
 * `useShowcaseHost().locale`.
 */

import type { I18nText } from '../domain'
import type { AlertNote } from './repair-host'
import { useShowcaseHost, useShowcaseMessages } from '../../../showcase-host'
import { fill, formatDate, localize } from '../domain'
import { ALERT_MESSAGE_KEYS, repairMessages as messages } from '../messages'

type Key = keyof typeof messages['en']

export interface RepairText {
	readonly locale: () => string
	readonly t: (key: Key) => string
	/** `t(key)` with its `{name}` markers filled in. */
	readonly tf: (key: Key, values: Readonly<Record<string, string | number>>) => string
	readonly text: (value: I18nText) => string
	readonly date: (value: string) => string
	/** The viewer-language explanation of a refused patch by its failure `code`, or Core's own message for a code this page does not know. */
	readonly explain: (alert: AlertNote) => string
}

export function useRepairText(): RepairText {
	const host = useShowcaseHost()
	const { t } = useShowcaseMessages(messages)
	const tf = (key: Key, values: Readonly<Record<string, string | number>>): string => fill(t(key), values)
	return {
		locale: () => host.locale.value,
		t,
		tf,
		text: value => localize(value, host.locale.value),
		date: value => formatDate(value, host.locale.value),
		explain: (alert) => {
			const key = Object.hasOwn(ALERT_MESSAGE_KEYS, alert.code) ? ALERT_MESSAGE_KEYS[alert.code] : undefined
			if (key === undefined)
				return alert.message
			return tf(key, { expected: alert.expectedRevision ?? '', actual: alert.actualRevision ?? '', index: alert.operationIndex ?? '' })
		},
	}
}
