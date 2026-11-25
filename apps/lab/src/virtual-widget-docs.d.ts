// The virtual modules of `widgetDocs({ slim: true })` (`../widget-docs.ts`): `virtual:widget-docs/<showcase id>` is that
// showcase's generated plugin documentation, slim (the prose of plugins, configs, slots and Events, and the config schemas).
// This is the declaration `@deviltea/widget-docs-generator/virtual-widget-docs-slim` ships, written out here so the app's
// tsconfigs need no `types` entry.

declare module 'virtual:widget-docs/*' {
	/** The slim documentation of the System this module is named after, generated from its types and its plugins' docs. */
	const docs: import('@deviltea/widget-docs-generator/docs').WidgetDocsSlim
	export default docs
}
