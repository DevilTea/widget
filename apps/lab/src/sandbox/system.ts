/**
 * The sandbox `WidgetSystem` — one instance shared by every sandbox preset and the `LabSession`.
 */

import { createWidgetSystem } from '@deviltea/widget-core'
import { sandboxPlugins } from './plugins'

export const sandboxSystem = createWidgetSystem({ plugins: sandboxPlugins })
