/**
 * Test fixture for `--check`: `Counter` writes `undocumented` for its config (which waives the docs of `raw` and
 * `resolved`), a slot, a State member, a Method parameter, a field of an inline object parameter and a field of a
 * reason's payload, beside documented members. Its `labelled` slot is a `WidgetContract` without `Types`.
 */

import type { WidgetChild, WidgetContract, WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem, undocumented } from '@deviltea/widget-core'

export interface CounterInterfaces extends WidgetInterfaces {
	config: {
		raw: {
			start?: number
		} | null
		resolved: { start: number }
	}
	slots: {
		items: WidgetChild
		labelled: WidgetContract<{ properties: { label: string } }>
	}
	state: {
		count: number
		step: number
		limit: number
	}
	methods: {
		add: (by: number, options: { silent: boolean }) => number
	}
	reasons: {
		'too-large': { limit: number }
	}
}

const isNumber = (input: unknown): input is number => typeof input === 'number'

export const CounterPlugin = createWidgetPlugin('Counter')
	.description('A counter.')
	.interfaces<CounterInterfaces>()
	.config({
		description: undocumented,
		validate: (input): input is { start?: number } | null => input === null || typeof input === 'object',
		resolve: raw => ({ start: raw?.start ?? 0 }),
	})
	.slots({ items: { description: undocumented }, labelled: { description: 'Children that expose a label; any plugin type.' } })
	.state(state => state
		.count({ description: 'The current count, at least 0.', validate: isNumber, default: () => 0 })
		.step({ description: undocumented, validate: isNumber, default: () => 1 })
		.limit({ description: 'The largest count.', validate: isNumber, default: () => 10 }))
	.methods(methods => methods
		.add({
			description: 'Adds to the count.',
			params: [undocumented, { description: 'How to add.', fields: { silent: undocumented } }],
			returns: { description: 'The new count.' },
			validateArgs: (args): args is [number, { silent: boolean }] => args.length === 2 && typeof args[0] === 'number',
			execute: ({ args: [by] }) => by,
		}))
	.reasons({ 'too-large': { description: 'The count is above the limit.', details: { fields: { limit: undocumented } } } })
	.done()

export const undocumentedSystem = createWidgetSystem({ plugins: [CounterPlugin] as const })
