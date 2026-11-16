/**
 * The survey-form `WidgetSystem`: one instance shared by every survey preset, the Lab session bound to
 * the showcase, and the JSON-in/JSON-out evaluation function (`./evaluate.ts`).
 */

import { createWidgetSystem } from '@deviltea/widget-core'
import { surveyPlugins } from './plugins'

export const surveySystem = createWidgetSystem({ plugins: surveyPlugins })
