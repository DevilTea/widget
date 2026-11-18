import type { ComputedRef } from 'vue'
import { computed, inject } from 'vue'
import { QuoteHostKey } from './quote-host'

/**
 * `true` while the host's latest read of the quote failed because the widget `widgetId` threw. The Property ref of
 * that widget did not change (Core skipped the subscription that threw), so the card would otherwise show the
 * last good amount as if it were current.
 */
export function useThrew(widgetId: string): ComputedRef<boolean> {
	const host = inject(QuoteHostKey, null)
	return computed(() => {
		const outcome = host?.browser.value
		return outcome !== undefined && !outcome.ok && outcome.failure.kind === 'exception' && outcome.failure.widgetId === widgetId
	})
}
