// @vitest-environment happy-dom
/**
 * The pack's stylesheet leaves the frame document with the last pack and comes back before the next one mounts: the frame document
 * is reused across showcases, and Vite's preload helper adds a lazy chunk's `<link>` once and never again, so the pack has to keep
 * the element itself, and count its holders because packs are switched faster than a stylesheet loads.
 *
 * The stylesheet is found by its marker rule. A `<style>` stands in for it in the dev-server-like tests; a `<link>` (a build) is
 * stood in for by a link element with a fake `sheet`, because happy-dom loads no stylesheet: the tests fire its `load` event.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquirePackStyles, forgetPackStyles, packStyleState, releasePackStyles } from './pack-styles'

const MARKER_RULES = [{ selectorText: '.packs-ui' }, { selectorText: '.packs-ui-pack-marker' }, { selectorText: '@property --tw-x' }]

function addStyle(text: string, attributes: Record<string, string> = {}): HTMLStyleElement {
	const style = document.createElement('style')
	style.textContent = text
	for (const [name, value] of Object.entries(attributes))
		style.setAttribute(name, value)
	document.head.append(style)
	return style
}

/** A stylesheet `<link>` in the document whose `sheet` is the marker sheet, or `null` while "unloaded". */
function addLink(): { readonly link: HTMLLinkElement, readonly setLoaded: (loaded: boolean) => void } {
	const link = document.createElement('link')
	link.rel = 'stylesheet'
	let loaded = true
	Object.defineProperty(link, 'sheet', { get: () => loaded ? { cssRules: MARKER_RULES } : null })
	document.head.append(link)
	return { link, setLoaded: (value) => {
		loaded = value
	} }
}

function settled(promise: Promise<void> | null): { readonly done: () => boolean } {
	let done = false
	void promise?.then(() => {
		done = true
	})
	return { done: () => done }
}

beforeEach(() => {
	forgetPackStyles()
})

afterEach(() => {
	forgetPackStyles()
	document.head.innerHTML = ''
	vi.useRealTimers()
})

describe('pack styles with a <style>', () => {
	it('has nothing to wait for on the first mount, and the last release takes out exactly the stylesheet that holds the marker', () => {
		const pack = addStyle('.packs-ui { color: red }\n.packs-ui-pack-marker { --packs-ui-pack: 1 }')
		const other = addStyle('.survey { color: blue }')
		expect(acquirePackStyles())
			.toBeNull()
		expect(packStyleState())
			.toMatchObject({ inDocument: 1, holders: 1, known: 0 })

		releasePackStyles()
		expect(pack.isConnected)
			.toBe(false)
		expect(other.isConnected)
			.toBe(true)
		expect(packStyleState())
			.toMatchObject({ inDocument: 0, holders: 0, known: 1 })
	})

	it('puts the same element back on the next acquire', () => {
		const pack = addStyle('.packs-ui-pack-marker { --packs-ui-pack: 1 }')
		acquirePackStyles()
		releasePackStyles()
		expect(acquirePackStyles())
			.toBeNull()
		expect(pack.isConnected)
			.toBe(true)
	})

	it('keeps the stylesheet while another pack still holds it, and takes it out with the last release', () => {
		const pack = addStyle('.packs-ui-pack-marker { --packs-ui-pack: 1 }')
		acquirePackStyles()
		acquirePackStyles()
		releasePackStyles()
		expect(pack.isConnected)
			.toBe(true)
		releasePackStyles()
		expect(pack.isConnected)
			.toBe(false)
	})

	it('leaves a document without the pack\'s stylesheet alone, and never goes below zero holders', () => {
		const other = addStyle('.packs-ui { color: red }')
		acquirePackStyles()
		releasePackStyles()
		releasePackStyles()
		expect(other.isConnected)
			.toBe(true)
		expect(packStyleState())
			.toMatchObject({ holders: 0, known: 0 })
	})

	it('leaves the dev server\'s own <style data-vite-dev-id> alone: its HMR removes the element itself and throws when it is gone', () => {
		const dev = addStyle('.packs-ui-pack-marker { --packs-ui-pack: 1 }', { 'data-vite-dev-id': '/src/packs-ui.css' })
		acquirePackStyles()
		releasePackStyles()
		expect(dev.isConnected)
			.toBe(true)
		expect(packStyleState().known)
			.toBe(0)
	})
})

describe('pack styles with a <link>', () => {
	it('puts the link back and waits for it to load again before the pack mounts', async () => {
		const { link } = addLink()
		expect(acquirePackStyles())
			.toBeNull()
		releasePackStyles()
		expect(link.isConnected)
			.toBe(false)

		const waiting = settled(acquirePackStyles())
		expect(link.isConnected)
			.toBe(true)
		await Promise.resolve()
		expect(waiting.done())
			.toBe(false)
		link.dispatchEvent(new Event('load'))
		await vi.waitFor(() => expect(waiting.done())
			.toBe(true))
		expect(packStyleState().loading)
			.toBe(0)
	})

	it('stops waiting when the link fails to load, and when it takes longer than the timeout', async () => {
		vi.useFakeTimers()
		const { link } = addLink()
		acquirePackStyles()
		releasePackStyles()

		const failing = settled(acquirePackStyles())
		link.dispatchEvent(new Event('error'))
		await vi.advanceTimersByTimeAsync(0)
		expect(failing.done())
			.toBe(true)
		releasePackStyles()

		const slow = settled(acquirePackStyles())
		await vi.advanceTimersByTimeAsync(2999)
		expect(slow.done())
			.toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		expect(slow.done())
			.toBe(true)
	})

	it('fast switching: a pack switched away before the link loaded does not take it from the pack that replaced it', async () => {
		const { link } = addLink()
		// Pack A mounted and went.
		acquirePackStyles()
		releasePackStyles()
		expect(link.isConnected)
			.toBe(false)

		// Pack B mounts and waits for the link, and is switched away before it loaded: its hold is released.
		const b = settled(acquirePackStyles())
		releasePackStyles()
		expect(link.isConnected)
			.toBe(false)

		// Pack C mounts at once after B: the link is back for it, and C waits for the load.
		const c = settled(acquirePackStyles())
		expect(link.isConnected)
			.toBe(true)
		link.dispatchEvent(new Event('load'))
		await vi.waitFor(() => expect(c.done())
			.toBe(true))
		// B's own wait ends too, and with it B's `gone` branch (it only returns): C keeps the stylesheet.
		await vi.waitFor(() => expect(b.done())
			.toBe(true))
		expect(link.isConnected)
			.toBe(true)
		expect(packStyleState())
			.toMatchObject({ holders: 1, inDocument: 1 })

		// The last release takes it out.
		releasePackStyles()
		expect(link.isConnected)
			.toBe(false)
	})

	it('fast switching with B still holding: C waits for the same load, and B\'s release leaves the link for C', async () => {
		const { link } = addLink()
		acquirePackStyles()
		releasePackStyles()

		const b = settled(acquirePackStyles())
		const c = settled(acquirePackStyles())
		expect(packStyleState())
			.toMatchObject({ holders: 2, loading: 1 })
		releasePackStyles()
		expect(link.isConnected)
			.toBe(true)
		link.dispatchEvent(new Event('load'))
		await vi.waitFor(() => expect(b.done() && c.done())
			.toBe(true))
		expect(link.isConnected)
			.toBe(true)
		releasePackStyles()
		expect(link.isConnected)
			.toBe(false)
	})

	it('finds a link again that has no sheet yet (it was put back and not loaded when it was released), so it cannot stay in the frame', () => {
		const { link, setLoaded } = addLink()
		acquirePackStyles()
		releasePackStyles()
		acquirePackStyles()
		expect(link.isConnected)
			.toBe(true)
		// A restore that ended by the timeout: the link is in the document, not loaded, and has no sheet to find it by.
		setLoaded(false)
		releasePackStyles()
		expect(link.isConnected)
			.toBe(false)
	})
})
