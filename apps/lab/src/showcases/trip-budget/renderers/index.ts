/**
 * Trip-budget Vue renderer registry, registered against `tripBudgetSystem` through the public
 * `@deviltea/widget-vue` contract only (`createWidgetVueRenderer`). Every plugin has exactly one renderer
 * registration (the registry is exhaustive by construction).
 *
 * `TripBudgetRenderer` is the component the Lab mounts: the registry's own renderer wrapped in the **host**
 * that owns the Runtime. The host provides `resetState()` to the renderers below it (see `./reset-host.ts`),
 * because `useWidget()` deliberately exposes no Runtime.
 */

import type { PropType } from 'vue'
import type { TripRuntime } from '../system'
import { createWidgetVueRenderer } from '@deviltea/widget-vue'
import { defineComponent, h, provide } from 'vue'
import { tripBudgetSystem } from '../system'
import CurrencyRenderer from './CurrencyRenderer.vue'
import ExpenseRenderer from './ExpenseRenderer.vue'
import PersonRenderer from './PersonRenderer.vue'
import { createTripResetHost, TripResetHostKey } from './reset-host'
import SettlementRenderer from './SettlementRenderer.vue'
import TripRootRenderer from './TripRootRenderer.vue'

export const TripWidgetRenderer = createWidgetVueRenderer(tripBudgetSystem, renderers =>
	renderers
		.Trip(TripRootRenderer)
		.Currency(CurrencyRenderer)
		.Person(PersonRenderer)
		.Expense(ExpenseRenderer)
		.Settlement(SettlementRenderer))

export const TripBudgetRenderer = defineComponent({
	name: 'TripBudgetRenderer',
	props: {
		runtime: { type: Object as PropType<TripRuntime>, required: true },
	},
	setup(props) {
		provide(TripResetHostKey, createTripResetHost(() => props.runtime))
		return () => h(TripWidgetRenderer, { runtime: props.runtime })
	},
})
