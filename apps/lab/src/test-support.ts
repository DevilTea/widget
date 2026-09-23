/** Shared typed Vue mount globals for Lab unit tests. */

import type { StyleItem } from '@pikacss/unplugin-pikacss'
import type { ComponentCustomProperties } from 'vue'
import { reactive } from 'vue'
import { createVuetify } from 'vuetify'

type StyleFunction = (...params: StyleItem[]) => string

function makeStyleFunction() {
	const fn: StyleFunction = params => JSON.stringify(params)
	return Object.assign(fn, {
		str: fn,
		arr: (...params: StyleItem[]) => params.map(() => ''),
	})
}

const vuetify = createVuetify()

export const testGlobalProperties: ComponentCustomProperties = {
	$vuetify: {
		defaults: vuetify.defaults.value,
		display: reactive(vuetify.display),
		theme: reactive(vuetify.theme),
		icons: vuetify.icons,
		locale: reactive(vuetify.locale),
		date: vuetify.date.instance,
	},
	pika: makeStyleFunction(),
	pikap: makeStyleFunction(),
}
