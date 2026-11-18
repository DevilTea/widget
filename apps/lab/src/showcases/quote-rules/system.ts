/**
 * The quote `WidgetSystem`: one instance shared by every quote preset, the Lab session bound to the showcase,
 * the renderer registry (`./renderers/index.ts`) and the headless evaluation (`./evaluate.ts`, which also runs
 * in a Web Worker). It imports no Vue.
 */

import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import { createWidgetSystem } from '@deviltea/widget-core'
import { quotePlugins } from './plugins'

export const quoteSystem = createWidgetSystem({ plugins: quotePlugins })

/** A Runtime of the quote system. */
export type QuoteRuntime = WidgetSystemRuntime<typeof quotePlugins>
