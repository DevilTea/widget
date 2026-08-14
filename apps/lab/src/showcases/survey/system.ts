/**
 * The Showcase A ("Interactive Survey") `WidgetSystem` — one instance shared by every survey preset
 * and the `LabSession` bound to the "survey" showcase (see `../registry.ts`).
 */

import { createWidgetSystem } from '@deviltea/widget-core'
import { surveyPlugins } from './plugins'

export const surveySystem = createWidgetSystem({ plugins: surveyPlugins })
