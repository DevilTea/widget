/**
 * Passive validation of a caller-supplied Runtime, shared by the root renderer and the `./testing`
 * host so both reject the same inputs with the same codes.
 */

import { assertCoreRuntime, WidgetIntegrationError } from '@deviltea/widget-core/integration'
import { WidgetVueIntegrationError } from './errors'

/**
 * Throws `WidgetVueIntegrationError` unless `runtime` is an object produced by the exact
 * `@deviltea/widget-core` instance this package imports. Core recognizes its own Runtimes by
 * module-local symbols, so a second installed copy renders everything but fails at the first `emit`;
 * checking provenance here moves that failure to the first time a Runtime is supplied. It reads no
 * Runtime state and acquires no emit authority.
 */
export function assertWidgetRuntime(runtime: unknown): void {
	if (typeof runtime !== 'object' || runtime === null) {
		throw new WidgetVueIntegrationError(
			'invalid-runtime',
			`The \`runtime\` prop must be a WidgetSystemRuntime created by @deviltea/widget-core, received ${runtime === null ? 'null' : typeof runtime}.`,
		)
	}

	try {
		assertCoreRuntime(runtime)
	}
	catch (error) {
		if (error instanceof WidgetIntegrationError && error.code === 'foreign-runtime') {
			throw new WidgetVueIntegrationError(
				'foreign-runtime',
				'The `runtime` was not produced by the @deviltea/widget-core instance imported by @deviltea/widget-vue: two copies of @deviltea/widget-core are installed (or the value is not a WidgetSystemRuntime). Make the application and @deviltea/widget-vue resolve a single copy of @deviltea/widget-core.',
			)
		}
		throw error
	}
}
