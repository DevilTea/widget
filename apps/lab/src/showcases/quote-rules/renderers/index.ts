/**
 * Quote Vue renderer registry, registered against `quoteSystem` through the public `@deviltea/widget-vue` contract
 * only (`createWidgetVueRenderer`). Every plugin has exactly one renderer registration (the registry is exhaustive
 * by construction).
 *
 * `QuoteRenderer` is the component the Lab mounts: the registry's own renderer wrapped in the **host** that owns the
 * Runtime (`./quote-host.ts`). The host starts the Web Worker, installs the isolated-error handler and provides
 * both to the renderers below it, and tears them down when the Preview unmounts the page.
 */

import type { PropType } from 'vue'
import type { QuoteRuntime } from '../system'
import type { QuoteBackend } from '../worker-client'
import { createWidgetVueRenderer } from '@deviltea/widget-vue'
import { defineComponent, h, inject, onScopeDispose, provide } from 'vue'
import { quoteSystem } from '../system'
import { createWorkerBackend } from '../worker-client'
import DeliveryRenderer from './DeliveryRenderer.vue'
import ItemRenderer from './ItemRenderer.vue'
import { createQuoteHost, QuoteBackendFactoryKey, QuoteHostKey } from './quote-host'
import QuoteRootRenderer from './QuoteRootRenderer.vue'
import RushSurchargeRenderer from './RushSurchargeRenderer.vue'
import SalesTaxRenderer from './SalesTaxRenderer.vue'
import VolumeDiscountRenderer from './VolumeDiscountRenderer.vue'

export const QuoteWidgetRenderer = createWidgetVueRenderer(quoteSystem, renderers =>
	renderers
		.Quote(QuoteRootRenderer)
		.Item(ItemRenderer)
		.VolumeDiscount(VolumeDiscountRenderer)
		.RushSurcharge(RushSurchargeRenderer)
		.Delivery(DeliveryRenderer)
		.SalesTax(SalesTaxRenderer))

/** One host for one Runtime: created when it mounts, disposed when it unmounts. */
const QuoteHostScope = defineComponent({
	name: 'QuoteHostScope',
	props: {
		runtime: { type: Object as PropType<QuoteRuntime>, required: true },
	},
	setup(props) {
		const createBackend: () => QuoteBackend = inject(QuoteBackendFactoryKey, () => createWorkerBackend())
		const { host, dispose } = createQuoteHost(props.runtime, createBackend())
		provide(QuoteHostKey, host)
		onScopeDispose(dispose)
		return () => h(QuoteWidgetRenderer, { runtime: props.runtime })
	},
})

const hostKeys = new WeakMap<object, number>()
let nextHostKey = 1

export const QuoteRenderer = defineComponent({
	name: 'QuoteRenderer',
	props: {
		runtime: { type: Object as PropType<QuoteRuntime>, required: true },
	},
	setup(props) {
		// A different Runtime is a different quote: it gets its own host (and Worker), not a re-pointed one.
		return () => {
			if (!hostKeys.has(props.runtime))
				hostKeys.set(props.runtime, nextHostKey++)
			return h(QuoteHostScope, { runtime: props.runtime, key: hostKeys.get(props.runtime) })
		}
	},
})
