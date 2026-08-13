/**
 * Runtime entry.
 *
 * Placeholder: the Runtime unit (U3) implements this against `../internal/contract`
 * (Runtime creation/initialization, primitives, batching, issues and disposal of issue #10 §11-§20).
 */

import type { CreateWidgetSystemRuntimeOptions, ValidWidgetSystemBlueprint, WidgetSystemRuntime } from '../internal/contract'
import type { AnyWidgetPluginTuple } from '../plugin'

export function createWidgetSystemRuntime<Plugins extends AnyWidgetPluginTuple>(
	_blueprint: ValidWidgetSystemBlueprint<Plugins>,
	_options?: CreateWidgetSystemRuntimeOptions,
): WidgetSystemRuntime<Plugins> {
	throw new Error('not implemented: U3')
}
