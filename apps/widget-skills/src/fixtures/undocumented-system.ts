/**
 * Test fixture for `--check`: one documented member, one without JSDoc, and one with a tag outside the tag set.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

/** A counter. */
export interface CounterInterfaces extends WidgetInterfaces {
	state: {
		/**
		 * The current count.
		 * @minimum 0
		 */
		count: number
		step: number
		/**
		 * The largest count.
		 * @madeUpTag nope
		 */
		limit: number
	}
}

const isNumber = (input: unknown): input is number => typeof input === 'number'

export const CounterPlugin = createWidgetPlugin('Counter')
	.description('A counter.')
	.interfaces<CounterInterfaces>()
	.state(state => state
		.count({ validate: isNumber, default: () => 0 })
		.step({ validate: isNumber, default: () => 1 })
		.limit({ validate: isNumber, default: () => 10 }))
	.done()

export const undocumentedSystem = createWidgetSystem({ plugins: [CounterPlugin] as const })
