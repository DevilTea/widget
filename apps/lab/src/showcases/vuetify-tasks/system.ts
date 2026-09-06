import { createWidgetSystem } from '@deviltea/widget-core'
import { vuetifyTaskPlugins } from './plugins'

export const vuetifyTaskSystem = createWidgetSystem({ plugins: vuetifyTaskPlugins })
