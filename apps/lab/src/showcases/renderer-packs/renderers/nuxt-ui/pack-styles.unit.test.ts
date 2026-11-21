// @vitest-environment happy-dom
/**
 * The pack's stylesheet leaves the frame document with the pack and comes back before the pack mounts again: the frame document is
 * reused across showcases, and Vite's preload helper adds a lazy chunk's `<link>` once and never again, so the pack has to keep the
 * element itself. The stylesheet is found by its marker rule, so a `<style>` (the dev server) stands in for a `<link>` (a build).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { detachPackStyles, packStyleState, restorePackStyles } from './pack-styles'

function addStyle(text: string): HTMLStyleElement {
	const style = document.createElement('style')
	style.textContent = text
	document.head.append(style)
	return style
}

afterEach(async () => {
	detachPackStyles()
	await restorePackStyles()
	document.head.innerHTML = ''
})

describe('pack styles', () => {
	it('has nothing to restore before the pack was ever detached (the first mount)', () => {
		expect(restorePackStyles())
			.toBeNull()
	})

	it('takes out exactly the stylesheet that holds the marker, and puts the same element back', async () => {
		const pack = addStyle('.packs-ui { color: red }\n.packs-ui-pack-marker { --packs-ui-pack: 1 }')
		const other = addStyle('.survey { color: blue }')
		expect(packStyleState())
			.toEqual({ inDocument: 1, detached: 0 })

		detachPackStyles()
		expect(pack.isConnected)
			.toBe(false)
		expect(other.isConnected)
			.toBe(true)
		expect(packStyleState())
			.toEqual({ inDocument: 0, detached: 1 })

		const restoring = restorePackStyles()
		expect(restoring)
			.not
			.toBeNull()
		await restoring
		expect(pack.isConnected)
			.toBe(true)
		expect(packStyleState())
			.toEqual({ inDocument: 1, detached: 0 })
		expect(restorePackStyles())
			.toBeNull()
	})

	it('leaves a document without the pack\'s stylesheet alone', () => {
		const other = addStyle('.packs-ui { color: red }')
		detachPackStyles()
		expect(other.isConnected)
			.toBe(true)
		expect(packStyleState())
			.toEqual({ inDocument: 0, detached: 0 })
	})
})
