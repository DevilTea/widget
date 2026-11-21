/**
 * The INNER system: the notice board application's document format v3. It is not registered as a Lab showcase; the repair
 * desk (`../system.ts`) holds legacy drafts of it and the application repairs them with `SourcePatch`.
 */

import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import { createWidgetSystem } from '@deviltea/widget-core'
import { boardPlugins } from './plugins'

export const boardSystem = createWidgetSystem({ plugins: boardPlugins })

/** A Runtime of the notice board system. */
export type BoardRuntime = WidgetSystemRuntime<typeof boardPlugins>
