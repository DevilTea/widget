/** Shared typed Vue mount globals for Lab unit tests. */

import type { StyleItem } from '@pikacss/unplugin-pikacss'
import type { ComponentCustomProperties } from 'vue'

type StyleFunction = (...params: StyleItem[]) => string

function makeStyleFunction() {
	const fn: StyleFunction = params => JSON.stringify(params)
	return Object.assign(fn, {
		str: fn,
		arr: (...params: StyleItem[]) => params.map(() => ''),
	})
}

export const testGlobalProperties: ComponentCustomProperties = {
	pika: makeStyleFunction(),
	pikap: makeStyleFunction(),
}
