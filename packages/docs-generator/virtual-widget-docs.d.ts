// Types for the virtual modules of `widgetDocs()` (`@deviltea/widget-docs-generator/vite`). Reference this file from a
// tsconfig (`"types": ["@deviltea/widget-docs-generator/virtual-widget-docs"]`) or with
// `/// <reference types="@deviltea/widget-docs-generator/virtual-widget-docs" />`.

declare module 'virtual:widget-docs/*' {
	/** The documentation of the System this module is named after, generated from its types and its plugins' docs. */
	const docs: import('@deviltea/widget-docs-generator/docs').WidgetDocs
	export default docs
}
