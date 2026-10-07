/**
 * Coded exception for foreign inputs to the inspection entries.
 */

export type WidgetInspectionErrorCode = 'foreign-plugin' | 'foreign-blueprint' | 'foreign-runtime'

/**
 * Thrown by `inspectPlugin` / `inspectBlueprint` / `inspectRuntime` when the argument was not produced
 * by this loaded `@deviltea/widget-core` module instance (another module instance or a structural
 * look-alike). Discriminate by class and `code`; `message` is not protocol.
 */
export class WidgetInspectionError extends Error {
	override readonly name = 'WidgetInspectionError'

	constructor(
		readonly code: WidgetInspectionErrorCode,
		message = `The ${code.slice('foreign-'.length)} was not produced by this widget core instance.`,
	) {
		super(message)
	}
}
