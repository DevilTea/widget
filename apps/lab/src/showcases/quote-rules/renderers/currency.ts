import type { InjectionKey } from 'vue'

/** The currency code of the quote (the root's config `currency`), provided by the root renderer to every widget below it. */
export const QuoteCurrencyKey: InjectionKey<string> = Symbol('widget-lab:quote-currency')
