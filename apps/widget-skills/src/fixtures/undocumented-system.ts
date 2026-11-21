/**
 * Test fixture for `--check`: `Counter` has one documented State member, one without JSDoc, one with a tag outside
 * the tag set, a Method with an undocumented parameter and an inline object parameter with an undocumented field,
 * a config without JSDoc on `config`, a slot without JSDoc and a reason without JSDoc. Its `labelled` slot is a
 * `WidgetContract` without `Types`.
 */

import type { WidgetChild, WidgetContract, WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

/** A counter. */
export interface CounterInterfaces extends WidgetInterfaces {
	config: {
		raw: {
			/** The first count. */
			start?: number
		} | null
		resolved: { start: number }
	}
	slots: {
		items: WidgetChild
		/** Children that expose a label; any plugin type. */
		labelled: WidgetContract<{ properties: { label: string } }>
	}
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
	methods: {
		/**
		 * Adds to the count.
		 * @param options - How to add.
		 * @returns The new count.
		 */
		add: (by: number, options: { silent: boolean }) => number
	}
	reasons: {
		'too-large': { limit: number }
	}
}

const isNumber = (input: unknown): input is number => typeof input === 'number'

export const CounterPlugin = createWidgetPlugin('Counter')
	.interfaces<CounterInterfaces>()
	.config({
		validate: (input): input is { start?: number } | null => input === null || typeof input === 'object',
		resolve: raw => ({ start: raw?.start ?? 0 }),
	})
	.slots({ items: {}, labelled: {} })
	.state(state => state
		.count({ validate: isNumber, default: () => 0 })
		.step({ validate: isNumber, default: () => 1 })
		.limit({ validate: isNumber, default: () => 10 }))
	.methods(methods => methods
		.add({
			validateArgs: (args): args is [number, { silent: boolean }] => args.length === 2 && typeof args[0] === 'number',
			execute: ({ args: [by] }) => by,
		}))
	.done()

export const undocumentedSystem = createWidgetSystem({ plugins: [CounterPlugin] as const })
