import type { ComputedRef } from 'vue'
import type { SafeRead } from './use-quote-text'
import { computed, inject } from 'vue'
import { QuoteHostKey } from './quote-host'

/**
 * How a rule failed, if it did: `own` when its own code threw, `input` when it only read something that threw (a
 * Property that reads one that threw rethrows the same exception, so "my read threw" does not mean "my code threw").
 */
export type RuleFailure = 'own' | 'input'

/**
 * The failure of the rule `widgetId`. `own` while the host's latest read of the quote failed because this widget's code
 * threw: the Property ref of that widget did not change (Core skipped the subscription that threw), so the card would
 * otherwise show the last good amount as if it were current. `input` when only this rule's own read threw.
 */
export function useRuleFailure(widgetId: string, read: Readonly<{ value: SafeRead<unknown> }>): ComputedRef<RuleFailure | null> {
	const host = inject(QuoteHostKey, null)
	return computed(() => {
		const outcome = host?.browser.value
		if (outcome !== undefined && !outcome.ok && outcome.failure.kind === 'exception' && outcome.failure.widgetId === widgetId)
			return 'own'
		return read.value.threw ? 'input' : null
	})
}
