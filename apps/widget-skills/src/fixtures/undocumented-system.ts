/**
 * Test fixture for `--check` and the extractor's edge cases:
 *
 * - `Counter`: one documented State member, one without JSDoc, one with a tag outside the tag set, and a Method
 *   with an undocumented parameter and an inline object parameter with an undocumented field.
 * - `Open`: `slots: string`, an open slot set whose names only the runtime knows.
 */

import type { WidgetInterfaces, WidgetPlugin } from '@deviltea/widget-core'
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
	methods: {
		/**
		 * Adds to the count.
		 * @param options - How to add.
		 * @returns The new count.
		 */
		add: (by: number, options: { silent: boolean }) => number
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
	.methods(methods => methods
		.add({
			validateArgs: (args): args is [number, { silent: boolean }] => args.length === 2 && typeof args[0] === 'number',
			execute: ({ args: [by] }) => by,
		}))
	.done()

/** A container that accepts any slot name. */
export interface OpenInterfaces extends WidgetInterfaces {
	slots: string
}

// Core's builder refuses `slots: string` (it wants a finite union), so the wide type is put on by a cast: this is the
// shape a loosely typed plugin library hands out.
export const OpenPlugin = createWidgetPlugin('Open')
	.description('A container that accepts any slot name.')
	.interfaces<{ slots: 'anything' }>()
	.slots({ anything: { description: 'Any children.' } })
	.done() as unknown as WidgetPlugin<'Open', OpenInterfaces>

export const undocumentedSystem = createWidgetSystem({ plugins: [CounterPlugin, OpenPlugin] as const })
