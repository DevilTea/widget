// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
	vi.unstubAllGlobals()
	vi.resetModules()
})

describe('offline icons', () => {
	it('would request an unbundled icon from the Iconify API without the switch (control)', async () => {
		const fetchSpy = vi.fn(async () => new Response('{}'))
		vi.stubGlobal('fetch', fetchSpy)
		vi.resetModules()
		// Iconify captures `fetch` when it is first imported, so import it after the stub.
		const { loadIcons } = await import('@iconify/vue')

		loadIcons(['lucide:control-not-bundled-icon'])
		await new Promise(resolve => setTimeout(resolve, 50))

		expect(fetchSpy)
			.toHaveBeenCalled()
	})

	it('never requests an unbundled icon once remote icons are disabled', async () => {
		const fetchSpy = vi.fn(async () => new Response('{}'))
		vi.stubGlobal('fetch', fetchSpy)
		vi.resetModules()
		const { loadIcons } = await import('@iconify/vue')
		const { disableRemoteIcons } = await import('./offline-icons')
		disableRemoteIcons()

		const loaded = await new Promise<string[]>((resolve) => {
			loadIcons(['lucide:another-not-bundled-icon'], (_loaded, missing) => resolve(missing.map(icon => icon.name)))
		})

		expect(loaded)
			.toEqual(['another-not-bundled-icon'])
		expect(fetchSpy)
			.not.toHaveBeenCalled()
	})
})
