/**
 * The workspace settings `WidgetSystem`: one instance shared by every preset, the Lab session bound to the showcase and BOTH
 * renderer packs (`./renderers/handwritten/` and `./renderers/nuxt-ui/` each register a renderer for every plugin type here).
 */

import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import { createWidgetSystem } from '@deviltea/widget-core'
import { packsPlugins } from './plugins'

export const packsSystem = createWidgetSystem({ plugins: packsPlugins })

/** A Runtime of the workspace settings system. */
export type PacksRuntime = WidgetSystemRuntime<typeof packsPlugins>
