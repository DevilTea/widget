// Types for the virtual modules of `widgetDocs({ slim: true })` (`@deviltea/widget-docs-generator/vite`). Reference this file
// instead of `virtual-widget-docs.d.ts` (`"types": ["@deviltea/widget-docs-generator/virtual-widget-docs-slim"]`).

declare module 'virtual:widget-docs/*' {
	/** The slim documentation of the System this module is named after, generated from its types and its plugins' docs. */
	const docs: import('@deviltea/widget-docs-generator/docs').WidgetDocsSlim
	export default docs
}
