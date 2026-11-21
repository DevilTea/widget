/**
 * The Preview frame's renderer registry (frame-side glue, imported by `preview-frame-main.ts` only).
 *
 * A showcase's renderer is the one part of it that carries Vue components and CSS, so it is deliberately not in
 * `showcases/registry.ts` (which the Lab shell imports): it is loaded lazily, by showcase id, and only inside the
 * frame document. That keeps every showcase stylesheet and component out of the shell's module graph and
 * `index.html` (checked on the built output by `styles/shell-isolation.unit.test.ts`).
 *
 * To add a showcase: add its id here, next to its entry in `showcases/registry.ts`.
 */

import type { Component } from 'vue'

const loaders: Readonly<Record<string, () => Promise<Component>>> = {
	'survey': async () => (await import('./showcases/survey/renderers')).SurveyRenderer as unknown as Component,
	'trip-budget': async () => (await import('./showcases/trip-budget/renderers')).TripBudgetRenderer as unknown as Component,
	'quote-rules': async () => (await import('./showcases/quote-rules/renderers')).QuoteRenderer as unknown as Component,
	'onboarding': async () => (await import('./showcases/onboarding/renderers')).OnboardingRenderer as unknown as Component,
	'document-repair': async () => (await import('./showcases/document-repair/renderers')).DocumentRepairRenderer as unknown as Component,
	'renderer-packs': async () => (await import('./showcases/renderer-packs/renderers')).loadRendererPacksRenderer(),
	'sandbox': async () => (await import('./sandbox/renderers')).SandboxRenderer as unknown as Component,
}

/** The renderer component of a registered showcase, or `undefined` for an id this frame has no renderer for. */
export async function loadShowcaseRenderer(id: string): Promise<Component | undefined> {
	return Object.hasOwn(loaders, id) ? loaders[id]!() : undefined
}
