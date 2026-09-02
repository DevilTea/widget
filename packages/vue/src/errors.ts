/**
 * Programmer/configuration exception surface.
 *
 * Normative source: diagnostic #13 checkpoint B ("Misconfigured Vue integration is a programmer/
 * configuration exception, not a Widget Diagnostic.") and checkpoint E ("A mismatch is a renderer/
 * programmer error and throws; it is not a Widget Diagnostic and is not recoverable application state.").
 *
 * `@deviltea/widget-vue` uses a single exception type for every such violation: renderer registry
 * misconfiguration (missing/unknown/duplicate renderer registration), a `runtime` prop bound to a
 * different `WidgetSystem` instance, `useWidget()`/`WidgetSlot` used outside a rendered widget host,
 * and an exact plugin-identity mismatch at `useWidget(Plugin)`. `instanceof` is the stable
 * discriminator, matching `@deviltea/widget-core`'s own `WidgetSystemRuntimeDisposedError` — the
 * message text is human-readable only and is never meant to be parsed as a machine protocol.
 *
 * This error never appears in any `getDiagnostics()` / `subscribeDiagnostics()` snapshot.
 */
export class WidgetVueIntegrationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'WidgetVueIntegrationError'
	}
}
