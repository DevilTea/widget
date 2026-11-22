// Types for the virtual modules of `widgetDocs()` (`@deviltea/widget-skills/vite`). Reference this file from a
// tsconfig (`"types": ["@deviltea/widget-skills/virtual-widget-docs"]`) or with
// `/// <reference types="@deviltea/widget-skills/virtual-widget-docs" />`.

declare module 'virtual:widget-docs/*' {
	/** The documentation of the System this module is named after, generated from its types and JSDoc. */
	const docs: import('@deviltea/widget-skills/docs').WidgetDocs
	export default docs
}
