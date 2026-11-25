/// <reference types="@deviltea/widget-docs-generator/virtual-widget-docs-slim" />
/**
 * `@deviltea/widget-docs-generator/virtual-widget-docs-slim` types `virtual:widget-docs/<name>` as `WidgetDocsSlim`.
 * A separate program from `packed-consumer-types.mts`: the two declarations type the same module pattern, so a
 * project references one of them.
 */
import type { WidgetDocs, WidgetDocsSlim } from '@deviltea/widget-docs-generator/docs'
import type surveyDocs from 'virtual:widget-docs/survey'

export function slimDocs(docs: typeof surveyDocs): WidgetDocsSlim {
	return docs
}

export function notFullDocs(docs: typeof surveyDocs): WidgetDocs {
	// @ts-expect-error -- the slim docs have no `types` section.
	return docs
}
