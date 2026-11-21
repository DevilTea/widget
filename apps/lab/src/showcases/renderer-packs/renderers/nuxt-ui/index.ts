/**
 * The Nuxt UI renderer pack: components of a component library (Nuxt UI) with Tailwind utilities, registered against the same
 * `packsSystem` as the hand-written pack (`../handwritten/`) through the public `@deviltea/widget-vue` contract only. Every
 * plugin has exactly one renderer registration (the registry is exhaustive by construction).
 *
 * The pack runs in its OWN Nuxt UI instance (`./nested-app.ts`): a nested Vue app mounted inside the showcase root with
 * `@nuxt/ui/vue-plugin` installed, so the showcase never relies on the frame document having one.
 */

import { createWidgetVueRenderer } from '@deviltea/widget-vue'
import { packsSystem } from '../../system'
import NuiAppearance from './NuiAppearance.vue'
import NuiChoice from './NuiChoice.vue'
import NuiDangerAction from './NuiDangerAction.vue'
import NuiNotifier from './NuiNotifier.vue'
import NuiSection from './NuiSection.vue'
import NuiSettingsPage from './NuiSettingsPage.vue'
import NuiTextField from './NuiTextField.vue'
import NuiToggle from './NuiToggle.vue'

export const NuxtUiWidgetRenderer = createWidgetVueRenderer(packsSystem, renderers =>
	renderers
		.SettingsPage(NuiSettingsPage)
		.Appearance(NuiAppearance)
		.Notifier(NuiNotifier)
		.Section(NuiSection)
		.TextField(NuiTextField)
		.Toggle(NuiToggle)
		.Choice(NuiChoice)
		.DangerAction(NuiDangerAction))
