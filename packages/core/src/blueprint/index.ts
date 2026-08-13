/**
 * Blueprint compilation entry.
 *
 * Placeholder: the compiler is implemented by the Blueprint unit (U2) against
 * `../internal/contract` (compile pipeline, recovery rules and diagnostics of issue #10 §6/§7/§10).
 */

import type { WidgetSystemBlueprint } from '../internal/contract'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetSystem } from '../system'

export function compileBlueprint<Plugins extends AnyWidgetPluginTuple>(
	_system: WidgetSystem<Plugins>,
	_definition: unknown,
): WidgetSystemBlueprint<Plugins> {
	throw new Error('not implemented: U2')
}
