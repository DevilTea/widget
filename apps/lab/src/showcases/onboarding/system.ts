/**
 * The onboarding `WidgetSystem`: one instance shared by every onboarding preset, the Lab session bound to the
 * showcase and the renderer registry (`./renderers/index.ts`).
 */

import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import { createWidgetSystem } from '@deviltea/widget-core'
import { onboardingPlugins } from './plugins'

export const onboardingSystem = createWidgetSystem({ plugins: onboardingPlugins })

/** A Runtime of the onboarding system. */
export type OnboardingRuntime = WidgetSystemRuntime<typeof onboardingPlugins>
