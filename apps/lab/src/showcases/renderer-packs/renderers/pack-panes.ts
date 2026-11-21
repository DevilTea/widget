/**
 * What a pane of the Nuxt UI pack shows while its lazy chunk loads and when the chunk failed to load. Neither is a live region: the
 * page's one status and one alert are the Notifier's.
 */

import { defineComponent, h } from 'vue'
import { usePacksText } from './use-packs-text'

export const LoadingPane = defineComponent({
	name: 'NuxtUiPackLoading',
	// The async wrapper hands its props (the Runtime) to the placeholder too; they are not attributes.
	inheritAttrs: false,
	setup() {
		const { t } = usePacksText()
		return () => h('p', { 'class': 'packs-loading', 'data-testid': 'packs-nui-loading' }, t('paneLoading'))
	},
})

export const FailedPane = defineComponent({
	name: 'NuxtUiPackFailed',
	inheritAttrs: false,
	setup() {
		const { t } = usePacksText()
		return () => h('p', { 'class': 'packs-loading', 'data-testid': 'packs-nui-failed' }, t('paneFailed'))
	},
})
