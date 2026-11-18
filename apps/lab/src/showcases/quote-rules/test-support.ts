/**
 * Shared test-only fixtures for the quote-rules showcase's colocated `*.unit.test.ts` files. Not itself a test
 * file, and never imported by application code. Every test builds a real `@deviltea/widget-core`
 * Blueprint/Runtime against `quoteSystem`; nothing here mocks Core.
 */

import type { RuntimeWidget } from '@deviltea/widget-core'
import type { quotePlugins } from './plugins'
import type { QuoteRuntime } from './system'
import { defaultQuotePreset, quotePresets } from './presets'
import { quoteSystem } from './system'

export type { QuoteRuntime }
type QuoteRuntimeWidget = RuntimeWidget<typeof quotePlugins>

/** A Runtime for a source object; throws unless the Blueprint is valid. */
export function createRuntimeFor(source: unknown): { readonly runtime: QuoteRuntime } {
	const blueprint = quoteSystem.createBlueprint(source)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics.map(({ code, message }) => ({ code, message })))}`)
	return { runtime: blueprint.createRuntime() }
}

/** A Runtime for `sourceText` (the default preset when omitted); throws unless the Blueprint is valid. */
export function createQuoteRuntime(sourceText: string = defaultQuotePreset.sourceText): { readonly runtime: QuoteRuntime } {
	return createRuntimeFor(JSON.parse(sourceText))
}

/** The source text of a preset by id. */
export function presetText(id: string): string {
	const preset = quotePresets.find(candidate => candidate.id === id)
	if (preset === undefined)
		throw new Error(`No preset ${id}`)
	return preset.sourceText
}

/** The value of a successful Property or Method result; throws with the failure otherwise. */
export function valueOf<Value>(result: { readonly ok: true, readonly value: Value } | { readonly ok: false, readonly failure: unknown }): Value {
	if (!result.ok)
		throw new Error(`Expected an ok result, got ${JSON.stringify(result.failure)}`)
	return result.value
}

/**
 * `runtime.getWidget(id)` is typed as the union of every registered plugin's `RuntimeWidget` shape; this narrows it by
 * the `type` literal so callers get the exact `state`/`properties`.
 */
export function widgetOfType<Type extends QuoteRuntimeWidget['type']>(runtime: QuoteRuntime, id: string, type: Type): Extract<QuoteRuntimeWidget, { readonly type: Type }> {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== type)
		throw new Error(`Expected widget "${id}" to exist and be of type "${type}".`)
	return widget as Extract<QuoteRuntimeWidget, { readonly type: Type }>
}

/** A preset's definition, parsed so a test can change one part and re-serialize it. */
export function parsedPreset(id: string = defaultQuotePreset.id): any {
	return JSON.parse(presetText(id))
}

/** One widget of a parsed document, wherever it is. */
export function widgetOf(document: any, id: string): any {
	for (const slot of Object.values<any[]>(document.slots)) {
		const found = slot.find((candidate: { id: string }) => candidate.id === id)
		if (found !== undefined)
			return found
	}
	throw new Error(`No widget ${id}`)
}
