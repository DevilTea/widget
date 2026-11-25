/**
 * The plugin documentation the Lab shows. A plugin's prose is written in its builder and kept on `plugin.docs` (Core 0.4); the
 * shape comes from its `Interfaces` type. `widgetDocs()` (`@deviltea/widget-docs-generator/vite`, wired in `widget-docs.ts` at the app root) turns both into one
 * `WidgetDocs` object per showcase System, imported as `virtual:widget-docs/<showcase id>` by `showcases/registry.ts`.
 *
 * The readers here never throw for a type or member the documentation does not name: an undocumented one reads as `''`, and
 * the views then render nothing for it.
 */

// The types come from the virtual module's declaration (`../virtual-widget-docs.d.ts`): importing the generator's
// `docs-types.ts` here would pull a source file of another project into this composite project (TS6307). Every
// `virtual:widget-docs/<name>` has the same type; this type-only import is erased.
import type showcaseDocs from 'virtual:widget-docs/survey'

/** The documentation object of one showcase System. */
export type WidgetDocs = typeof showcaseDocs
/** The documentation of one plugin type. */
export type WidgetPluginDocs = WidgetDocs['plugins'][string]
/** The prose fields every documented member has. */
export type WidgetDocsText = Pick<WidgetPluginDocs, 'summary' | 'remarks'>

/** The documentation of plugin `type`, or `undefined` when there is none. */
export function pluginDocsOf(docs: WidgetDocs | undefined, type: string): WidgetPluginDocs | undefined {
	return docs !== undefined && Object.hasOwn(docs.plugins, type) ? docs.plugins[type] : undefined
}

/**
 * Joins the line wraps of one paragraph (a description may be written with hard wraps), and the views
 * render text with `white-space: pre-line`. Blank lines (paragraph breaks) and lines that start a list item stay.
 */
function unwrapLines(text: string): string {
	return text.replace(/(?<!\n)[ \t]*\n(?!\n|[ \t]*(?:[-*+]|\d+\.)[ \t])[ \t]*/g, ' ')
}

/** The prose of one documented member: its summary, then its remarks after a blank line; `''` when it has none. */
export function docText(text: WidgetDocsText | null | undefined): string {
	if (text === null || text === undefined)
		return ''
	return [text.summary, text.remarks].filter(part => part !== '')
		.map(unwrapLines)
		.join('\n\n')
}

/** The prose of entry `name` of a documented section (`slots`, `events`, ...); `''` when it is not documented. */
export function memberDocText(section: Readonly<Record<string, WidgetDocsText>> | null | undefined, name: string): string {
	return section !== null && section !== undefined && Object.hasOwn(section, name) ? docText(section[name]) : ''
}
