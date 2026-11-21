/**
 * The Nuxt UI pack's stylesheet in a frame document that outlives it.
 *
 * `packs-ui.css` is Tailwind's theme and utilities, Nuxt UI's `:root` tokens and its base rules (`color-scheme`, a focus rule on
 * every `a`), none of which may touch the hand-written pack or another showcase. The Preview reuses its frame document across
 * showcase switches (`preview-host/frame-driver.ts`), and a stylesheet that a lazy chunk brought in stays in the document: Vite's
 * preload helper adds the `<link>` once and remembers it, so it is never added again (and a link removed from outside is not
 * restored by the next `import()`). So the pack owns the element's presence itself:
 *
 * - `detachPackStyles()` takes the pack's stylesheet element out of the document when the pack unmounts, and keeps the element;
 * - `restorePackStyles()` puts the same element back before the pack mounts again, and says when it has loaded (a cached link loads
 *   again), so the pack is never drawn unstyled.
 *
 * The element is found by what it holds, not by its name: the rule `.packs-ui-pack-marker`, the last rule of `packs-ui.css`. That
 * is a `<link>` in a build and a `<style>` in the dev server, and it does not depend on the chunk's file name.
 */

const MARKER = '.packs-ui-pack-marker'

/** How long a restored stylesheet may take to load before the pack mounts anyway (the pack is then briefly unstyled, not absent). */
const RESTORE_TIMEOUT_MS = 3000

type StyleElement = HTMLLinkElement | HTMLStyleElement

/** The elements taken out of the document, in order. */
const detached = new Set<StyleElement>()

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
	// The marker is the last rule: a sheet that holds it answers at once, one that does not is read once.
	for (let index = rules.length - 1; index >= 0; index--) {
		if ((rules[index] as CSSStyleRule).selectorText === MARKER)
			return true
	}
	return false
}

/** The stylesheet elements of the document that hold the pack's stylesheet. */
function packStyleElements(): StyleElement[] {
	return [...document.querySelectorAll<StyleElement>('link[rel="stylesheet"], style')]
		.filter(element => carriesMarker(element.sheet))
}

/** Takes the pack's stylesheet out of the document (it stays remembered for `restorePackStyles`). */
export function detachPackStyles(): void {
	for (const element of packStyleElements()) {
		detached.add(element)
		element.remove()
	}
}

/**
 * Puts a detached stylesheet back and returns a promise for when it has loaded, or `null` when there is nothing to put back (the
 * first mount, where the preload helper has just added and awaited it). Never rejects.
 */
export function restorePackStyles(): Promise<void> | null {
	if (detached.size === 0)
		return null
	const loading: Promise<void>[] = []
	for (const element of detached) {
		if (element.isConnected)
			continue
		document.head.append(element)
		if (element instanceof HTMLLinkElement) {
			loading.push(new Promise<void>((resolve) => {
				let timer: ReturnType<typeof setTimeout> | undefined
				const done = (): void => {
					clearTimeout(timer)
					resolve()
				}
				timer = setTimeout(done, RESTORE_TIMEOUT_MS)
				element.addEventListener('load', done, { once: true })
				element.addEventListener('error', done, { once: true })
			}))
		}
	}
	detached.clear()
	return Promise.all(loading)
		.then(() => {})
}

/** For tests: how many pack stylesheet elements are in the document, and how many are waiting to be put back. */
export function packStyleState(): { readonly inDocument: number, readonly detached: number } {
	return { inDocument: packStyleElements().length, detached: detached.size }
}
