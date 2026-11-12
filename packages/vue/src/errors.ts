/**
 * Stable discriminators for `WidgetVueIntegrationError`. Reusing a code string across error classes
 * (for example in `@deviltea/widget-core`) is intentional; always discriminate by class and `code`.
 */
export type WidgetVueIntegrationErrorCode
	= | 'invalid-renderer-registry'
		| 'invalid-runtime'
		| 'foreign-runtime'
		| 'unknown-widget'
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
	readonly invalidTypes: readonly string[]
}

// Named so stack traces and `constructor.name` keep reading `WidgetVueIntegrationError`.
const WidgetVueIntegrationErrorImpl = class WidgetVueIntegrationError extends Error {
	override readonly name = 'WidgetVueIntegrationError'
	readonly missingTypes: readonly string[] | null
	readonly unknownTypes: readonly string[] | null
	readonly duplicateTypes: readonly string[] | null
	readonly invalidTypes: readonly string[] | null

	constructor(
		readonly code: WidgetVueIntegrationErrorCode,
		message: string,
		defects?: WidgetVueRegistryDefects,
	) {
		super(message)
		this.missingTypes = defects === undefined ? null : Object.freeze([...defects.missingTypes])
		this.unknownTypes = defects === undefined ? null : Object.freeze([...defects.unknownTypes])
		this.duplicateTypes = defects === undefined ? null : Object.freeze([...defects.duplicateTypes])
		this.invalidTypes = defects === undefined ? null : Object.freeze([...defects.invalidTypes])
	}
}

interface WidgetVueIntegrationErrorBase extends Error {
	readonly name: 'WidgetVueIntegrationError'
}

/** The `invalid-renderer-registry` member of {@link WidgetVueIntegrationError}: the defect lists are non-null. */
interface WidgetVueRegistryIntegrationError extends WidgetVueIntegrationErrorBase, WidgetVueRegistryDefects {
	readonly code: 'invalid-renderer-registry'
}

/** Every other member of {@link WidgetVueIntegrationError}: the defect lists are `null`. */
interface WidgetVueUsageIntegrationError extends WidgetVueIntegrationErrorBase {
	readonly code: Exclude<WidgetVueIntegrationErrorCode, 'invalid-renderer-registry'>
	readonly missingTypes: null
	readonly unknownTypes: null
	readonly duplicateTypes: null
	readonly invalidTypes: null
}

/**
 * An instance is a union discriminated by `code`: after `error.code === 'invalid-renderer-registry'`
 * the registry defect lists are typed as `readonly string[]` rather than `readonly string[] | null`.
 */
export type WidgetVueIntegrationError = WidgetVueRegistryIntegrationError | WidgetVueUsageIntegrationError

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
 *   `unknownTypes` and `duplicateTypes` (in first-registration order), and `invalidTypes` (registered
 *   values that are not Vue components, in first-registration order). Each is a frozen array
 *   (possibly empty) for this code.
 * - `invalid-runtime`: the `runtime` prop is not an object at all (for example `null` or `undefined`).
 * - `foreign-runtime`: the `runtime` prop was not produced by the `@deviltea/widget-core` instance this
 *   package imports, because two copies of core are installed. Checked when the root renderer is first
 *   given a Runtime, before the System-identity check.
 * - `unknown-widget`: `createWidgetTestHost()` (from `@deviltea/widget-vue/testing`) was given a widget
 *   id the Runtime does not contain.
 * - `runtime-system-mismatch`: the `runtime` prop was not created from the exact bound System.
 * - `outside-widget-renderer`: `useWidget()` or `WidgetSlot` was used without a current widget host.
 * - `widget-plugin-mismatch`: `useWidget(Plugin)` received a plugin instance other than the current
 *   widget's exact plugin.
 * - `readonly-projection-write`: a Property or Diagnostics ref was written.
 *
 * `missingTypes`, `unknownTypes`, `duplicateTypes` and `invalidTypes` are `null` for every other code. States made
 * impossible by exact-plugin, registry and System-identity validation are internal invariants and
 * throw a plain `Error`, not this class.
 *
 * This error never appears in any `getDiagnostics()` / `subscribeDiagnostics()` snapshot.
 */
// The exported value and type deliberately share one name, like a class, so `instanceof` narrows to the union.
// eslint-disable-next-line ts/no-redeclare
export const WidgetVueIntegrationError: {
	new (code: 'invalid-renderer-registry', message: string, defects: WidgetVueRegistryDefects): WidgetVueRegistryIntegrationError
	new (code: Exclude<WidgetVueIntegrationErrorCode, 'invalid-renderer-registry'>, message: string): WidgetVueUsageIntegrationError
	readonly prototype: WidgetVueIntegrationError
} = WidgetVueIntegrationErrorImpl as unknown as typeof WidgetVueIntegrationError
