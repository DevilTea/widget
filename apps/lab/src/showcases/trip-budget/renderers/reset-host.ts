/**
 * The host actions the trip's renderers may ask for: Core's `resetState()`.
 *
 * `resetState()` is a **host** API: it lives on the Runtime and on a Runtime widget, and `useWidget()` hands a
 * renderer neither (every cross-widget interaction of a renderer goes through declared dependencies). So the
 * host that owns the Runtime, `TripBudgetRenderer` (`./index.ts`), provides these two functions to the
 * renderers below it, and a renderer only ever asks:
 *
 * - `resetWidget(id)`: `runtime.getWidget(id).resetState()`: every State member of that widget goes back to
 *   the value it started with (the authored amount, payer and participants). What other widgets derived
 *   from it recomputes by itself;
 * - `resetAll()`: `runtime.resetState()`: every widget starts over.
 *
 * `resetState()` restores State only. It does not clear Property or Method diagnostics, and it restores
 * the *same* values the Runtime was created with, not an empty form.
 */

import type { InjectionKey } from 'vue'
import type { TripRuntime } from '../system'

export interface TripResetHost {
	readonly resetWidget: (widgetId: string) => void
	readonly resetAll: () => void
}

export const TripResetHostKey: InjectionKey<TripResetHost> = Symbol('widget-lab:trip-budget-host')

/** The host of one Runtime. `runtime()` is read at call time, so a replaced Runtime is always the current one. */
export function createTripResetHost(runtime: () => TripRuntime): TripResetHost {
	return {
		resetWidget: (widgetId) => {
			const widget = runtime()
				.getWidget(widgetId)
			if (widget !== null && 'resetState' in widget)
				widget.resetState()
		},
		resetAll: () => {
			runtime()
				.resetState()
		},
	}
}
