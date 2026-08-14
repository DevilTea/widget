/**
 * The Showcase B ("Interactive Product Prototype") `WidgetSystem` — one instance shared by every CRM
 * preset and the `LabSession` bound to the "crm" showcase (see `../registry.ts`).
 */

import { createWidgetSystem } from '@deviltea/widget-core'
import { crmPlugins } from './plugins'

export const crmSystem = createWidgetSystem({ plugins: crmPlugins })
