/**
 * The trip-budget `WidgetSystem`: one instance shared by every trip preset, the Lab session bound to the
 * showcase and the renderer registry (`./renderers/index.ts`).
 */

import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import { createWidgetSystem } from '@deviltea/widget-core'
import { tripBudgetPlugins } from './plugins'

export const tripBudgetSystem = createWidgetSystem({ plugins: tripBudgetPlugins })

/** A Runtime of the trip-budget system. */
export type TripRuntime = WidgetSystemRuntime<typeof tripBudgetPlugins>
