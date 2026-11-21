/**
 * The Nuxt UI pack's stylesheet in a frame document that outlives it.
 *
 * `packs-ui.css` is Tailwind's theme and utilities, Nuxt UI's `:root` tokens and its base rules (`color-scheme`, a focus rule on
 * every `a`), none of which may touch the hand-written pack or another showcase. The Preview reuses its frame document across
 * showcase switches (`preview-host/frame-driver.ts`), and a stylesheet that a lazy chunk brought in stays in the document: Vite's
 * preload helper adds the `<link>` once and remembers it, so it is never added again (and a link removed from outside is not
 * restored by the next `import()`). So the pack owns the element's presence itself, by reference counting, because packs come and
 * go faster than a stylesheet loads:
 *
 * - `acquirePackStyles()` is called when a pack mounts. It puts a detached stylesheet element back (the same element) and returns a
 *   promise for when it has loaded (a cached link loads again), or `null` when nothing is pending, so the pack is never drawn
 *   unstyled. A pack that mounts while another one's restore is still loading waits for that same load.
 * - `releasePackStyles()` is called when a pack unmounts, once for each acquire, whether or not it ever mounted. Only the release
 *   that brings the count to zero takes the stylesheet out of the document (and keeps the element): a pack that was switched away
 *   before its stylesheet loaded must not take it from the pack that replaced it.
 *
 * The element is found by what it holds, not by its name: the rule `.packs-ui-pack-marker` of `packs-ui.css`. That is a `<link>` in
 * a build and a `<style>` in the dev server, and it does not depend on the chunk's file name. (The rule is not the last one: the
 * Tailwind output appends `@property` and `@keyframes` after it, so the whole list is read, from the end.) An element this module
 * put back is remembered, so it is found again even before it has loaded (a `<link>` has no sheet then).
 *
 * In the dev server the stylesheet is a `<style data-vite-dev-id>` that Vite's HMR owns (`removeStyle` throws when its element is
 * not in the head), so this module leaves that one alone: in dev the pack's CSS stays in the frame after the pack is gone.
 */

const MARKER = '.packs-ui-pack-marker'

/** How long a restored stylesheet may take to load before the pack mounts anyway (the pack is then briefly unstyled, not absent). */
const RESTORE_TIMEOUT_MS = 3000

type StyleElement = HTMLLinkElement | HTMLStyleElement

/** The elements this module has taken out of the document, and put back since: the ones it owns. */
const known = new Set<StyleElement>()

/** The restores still waiting for their `<link>` to load. */
const loads = new Map<StyleElement, Promise<void>>()

let holders = 0

function carriesMarker(sheet: CSSStyleSheet | null): boolean {
	if (sheet === null)
		return false
	let rules: CSSRuleList
	try {
		rules = sheet.cssRules
	}
	catch {
		// A cross-origin sheet cannot be read, and none of ours is one.
		return false
	}
	for (let index = rules.length - 1; index >= 0; index--) {
		if ((rules[index] as CSSStyleRule).selectorText === MARKER)
			return true
	}
	return false
}

/** The Vite dev server's own `<style>` for a stylesheet (see the module comment). */
function ownedByViteDevServer(element: StyleElement): boolean {
	return element instanceof HTMLStyleElement && element.hasAttribute('data-vite-dev-id')
}

/** The stylesheet elements of the document that hold the pack's stylesheet, plus the ones this module owns that are in it. */
function packStyleElements(): StyleElement[] {
	const found = [...document.querySelectorAll<StyleElement>('link[rel="stylesheet"], style')]
		.filter(element => carriesMarker(element.sheet))
	return [...new Set([...found, ...[...known].filter(element => element.isConnected)])]
		.filter(element => !ownedByViteDevServer(element))
}

function waitForLoad(element: HTMLLinkElement): Promise<void> {
	const promise = new Promise<void>((resolve) => {
		let timer: ReturnType<typeof setTimeout> | undefined
		const done = (): void => {
			clearTimeout(timer)
			resolve()
		}
		timer = setTimeout(done, RESTORE_TIMEOUT_MS)
		element.addEventListener('load', done, { once: true })
		element.addEventListener('error', done, { once: true })
	})
	loads.set(element, promise)
	void promise.then(() => {
		if (loads.get(element) === promise)
			loads.delete(element)
	})
	return promise
}

/**
 * A pack is mounting. Returns a promise for when its stylesheet is in the document and loaded, or `null` when it already is (the
 * first mount, where the preload helper has just added and awaited it). Never rejects. Pair every call with one `releasePackStyles()`.
 */
export function acquirePackStyles(): Promise<void> | null {
	holders++
	const waiting: Promise<void>[] = []
	for (const element of known) {
		if (!element.isConnected) {
			document.head.append(element)
			if (element instanceof HTMLLinkElement)
				waiting.push(waitForLoad(element))
		}
		else {
			const pending = loads.get(element)
			if (pending !== undefined)
				waiting.push(pending)
		}
	}
	return waiting.length === 0
		? null
		: Promise.all(waiting)
				.then(() => {})
}

/** A pack is gone (or was never mounted): the last one out takes the stylesheet out of the document, keeping the element. */
export function releasePackStyles(): void {
	holders = Math.max(0, holders - 1)
	if (holders > 0)
		return
	for (const element of packStyleElements()) {
		known.add(element)
		loads.delete(element)
		element.remove()
	}
}

/** For tests: the state of this module. */
export function packStyleState(): { readonly inDocument: number, readonly known: number, readonly holders: number, readonly loading: number } {
	return { inDocument: packStyleElements().length, known: known.size, holders, loading: loads.size }
}

/** For tests: forget everything (the module outlives a test). */
export function forgetPackStyles(): void {
	known.clear()
	loads.clear()
	holders = 0
}
