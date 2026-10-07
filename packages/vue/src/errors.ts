/**
 * Stable discriminators for `WidgetVueIntegrationError`. Reusing a code string across error classes
 * (for example in `@deviltea/widget-core`) is intentional; always discriminate by class and `code`.
 */
export type WidgetVueIntegrationErrorCode
	= | 'invalid-renderer-registry'
		| 'runtime-system-mismatch'
		| 'outside-widget-renderer'
		| 'widget-plugin-mismatch'
		| 'readonly-projection-write'

/**
 * The defect lists reported together by an `invalid-renderer-registry` error.
 */
interface WidgetVueRegistryDefects {
	readonly missingTypes: readonly string[]
	readonly unknownTypes: readonly string[]
	readonly duplicateTypes: readonly string[]
}

/**
 * Programmer/configuration exception surface.
 *
 * Normative source: diagnostic #13 checkpoint B ("Misconfigured Vue integration is a programmer/
 * configuration exception, not a Widget Diagnostic.") and checkpoint E ("A mismatch is a renderer/
 * programmer error and throws; it is not a Widget Diagnostic and is not recoverable application state.").
 *
 * `@deviltea/widget-vue` uses a single exception class for every caller-reachable violation.
 * Discriminate by class and `code`, matching `@deviltea/widget-core`'s `WidgetSystemConfigurationError`;
 * the message text is human-readable only and is never meant to be parsed as a machine protocol.
 *
 * - `invalid-renderer-registry`: `createWidgetVueRenderer` coverage is not exactly-once against the
 *   bound System. One error reports every defect together: `missingTypes` (in System plugin order),
 *   `unknownTypes` and `duplicateTypes` (in first-registration order). Each is a frozen array
 *   (possibly empty) for this code.
 * - `runtime-system-mismatch`: the `runtime` prop was not created from the exact bound System.
 * - `outside-widget-renderer`: `useWidget()` or `WidgetSlot` was used without a current widget host.
 * - `widget-plugin-mismatch`: `useWidget(Plugin)` received a plugin instance other than the current
 *   widget's exact plugin.
 * - `readonly-projection-write`: a Property or Diagnostics ref was written.
 *
 * `missingTypes`, `unknownTypes` and `duplicateTypes` are `null` for every other code. States made
 * impossible by exact-plugin, registry and System-identity validation are internal invariants and
 * throw a plain `Error`, not this class.
 *
 * This error never appears in any `getDiagnostics()` / `subscribeDiagnostics()` snapshot.
 */
export class WidgetVueIntegrationError extends Error {
	override readonly name = 'WidgetVueIntegrationError'
	readonly missingTypes: readonly string[] | null
	readonly unknownTypes: readonly string[] | null
	readonly duplicateTypes: readonly string[] | null

	constructor(code: 'invalid-renderer-registry', message: string, defects: WidgetVueRegistryDefects)
	constructor(code: Exclude<WidgetVueIntegrationErrorCode, 'invalid-renderer-registry'>, message: string)
	constructor(
		readonly code: WidgetVueIntegrationErrorCode,
		message: string,
		defects?: WidgetVueRegistryDefects,
	) {
		super(message)
		this.missingTypes = defects === undefined ? null : Object.freeze([...defects.missingTypes])
		this.unknownTypes = defects === undefined ? null : Object.freeze([...defects.unknownTypes])
		this.duplicateTypes = defects === undefined ? null : Object.freeze([...defects.duplicateTypes])
	}
}
