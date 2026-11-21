/**
 * The renderer entry of the "One document, two renderer packs" showcase: the module `preview-frame-renderers.ts` loads lazily.
 *
 * It is deliberately a thin facade. The showcase has a second lazy boundary behind it (the Nuxt UI pack, which loads Nuxt UI,
 * Tailwind and a stylesheet only when a pane needs them), and that pack shares modules with the page (the text and host helpers,
 * the messages). A bundler puts what a chunk and its own lazy child share into the parent chunk and lets the child import it from
 * there, which makes the parent chunk export more than its entry module does: it stops being a chunk of its own entry, and the
 * shell-isolation guard (`styles/shell-isolation.unit.test.ts`), which finds a showcase's renderer chunk by its entry module in the
 * build manifest, could no longer tell it from a shared helper chunk. With the page behind a dynamic import here, the entry is
 * just this loader, a chunk of its own as for every other showcase, and the page, the hand-written pack and what the packs share
 * live in the next chunk.
 *
 * The loader is awaited by the frame before it replaces the running Preview, so a chunk that fails to load is reported the way
 * every renderer load failure is (`discardFrame`), not as an error inside a mounted tree.
 */

import type { Component } from 'vue'

export async function loadRendererPacksRenderer(): Promise<Component> {
	return (await import('./page')).RendererPacksRenderer as unknown as Component
}
