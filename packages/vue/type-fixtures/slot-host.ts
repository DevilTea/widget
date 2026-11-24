/**
 * The plugin and type assertions `WidgetSlotNarrowing.vue` uses. Type-checked by `pnpm typecheck:vue` (vue-tsc), never
 * run or published.
 */

import type { WidgetChild, WidgetContract, WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin, undocumented } from '@deviltea/widget-core'

interface HostInterfaces extends WidgetInterfaces {
	slots: {
		/** Labels only. */
		header: 'Label'
		/** Labels and counters. */
		body: 'Label' | 'Counter'
		/** Any widget. */
		free: WidgetChild
		/** Leaves, read through a contract. */
		leaves: WidgetContract<{ state: { label: string } }, 'Leaf'>
	}
}

export const HostPlugin = createWidgetPlugin('Host')
	.description(undocumented)
	.interfaces<HostInterfaces>()
	.slots({ header: { description: undocumented }, body: { description: undocumented }, free: { description: undocumented }, leaves: { description: undocumented } })
	.done()

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

/**
 * `expectType<Expected>()(value)` compiles only when the type of `value` is exactly `Expected` (not wider, not
 * narrower, not `never`).
 */
export function expectType<Expected>() {
	return <Actual>(value: Actual, ..._exact: Equal<Actual, Expected> extends true ? [] : ['the type differs from the expected one']): Actual => value
}
