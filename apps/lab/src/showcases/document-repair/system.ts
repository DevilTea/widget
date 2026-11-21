/**
 * The OUTER system: the repair desk, the one the Lab registers as the showcase (the Lab Document). It holds saved drafts of
 * the inner notice board system (`./board/system.ts`), which is the app's own document format and is not registered.
 */

import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import { createWidgetSystem } from '@deviltea/widget-core'
import { repairPlugins } from './plugins'

export const repairSystem = createWidgetSystem({ plugins: repairPlugins })

/** A Runtime of the repair desk system. */
export type RepairRuntime = WidgetSystemRuntime<typeof repairPlugins>
