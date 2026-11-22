/**
 * The hand-written renderer pack: plain Vue components with `<style scoped>` and `--packs-*` custom properties, registered
 * against `packsSystem` through the public `@deviltea/widget-vue` contract only (`createWidgetVueRenderer`). Every plugin has
 * exactly one renderer registration (the registry is exhaustive by construction). The Nuxt UI pack
 * (`../nuxt-ui/`) registers a second renderer for the same System.
 */

import { createWidgetVueRenderer } from '@deviltea/widget-vue'
import { packsSystem } from '../../system'
import HandAppearance from './HandAppearance.vue'
import HandChoice from './HandChoice.vue'
import HandDangerAction from './HandDangerAction.vue'
import HandNotifier from './HandNotifier.vue'
import HandSection from './HandSection.vue'
import HandSettingsPage from './HandSettingsPage.vue'
import HandTextField from './HandTextField.vue'
import HandToggle from './HandToggle.vue'

export const HandWrittenRenderer = createWidgetVueRenderer(packsSystem, renderers =>
	renderers
		.SettingsPage(HandSettingsPage)
		.Appearance(HandAppearance)
		.Notifier(HandNotifier)
		.Section(HandSection)
		.TextField(HandTextField)
		.Toggle(HandToggle)
		.Choice(HandChoice)
		.DangerAction(HandDangerAction))
