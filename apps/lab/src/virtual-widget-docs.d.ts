// The virtual modules of `widgetDocs({ slim: true })` (`../widget-docs.ts`): `virtual:widget-docs/<showcase id>` is that
// showcase's generated plugin documentation, slim (the prose of plugins, configs, slots and Events, and the config schemas).
// This is the declaration `@deviltea/widget-skills/virtual-widget-docs-slim` ships, with the `WidgetDocsSlim` type read by
// relative path: the Lab does not depend on the private generator package, it only loads its Vite plugin by relative path
// from its configs.

declare module 'virtual:widget-docs/*' {
	/** The slim documentation of the System this module is named after, generated from its types and its plugins' docs. */
	const docs: import('../../widget-skills/src/docs-types').WidgetDocsSlim
	export default docs
}
