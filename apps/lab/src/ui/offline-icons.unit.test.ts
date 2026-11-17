// @vitest-environment happy-dom

import { _api, loadIcons } from '@iconify/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disableRemoteIcons } from './offline-icons'

// `test-setup.ts` (Vitest `setupFiles`) has already disabled remote icons in this worker; each test sets the
// `fetch` Iconify holds explicitly, so it tests the switch itself and not the setup file.
afterEach(() => {
	disableRemoteIcons()
})

describe('offline icons', () => {
	it('would request an unbundled icon from the Iconify API while Iconify has a fetch (control)', async () => {
		const fetchSpy = vi.fn(async () => new Response('{}'))
		_api.setFetch(fetchSpy as unknown as typeof fetch)

		loadIcons(['lucide:control-not-bundled-icon'])
		await new Promise(resolve => setTimeout(resolve, 50))

		expect(fetchSpy)
			.toHaveBeenCalled()
	})

	it('never requests an unbundled icon once remote icons are disabled', async () => {
		const fetchSpy = vi.fn(async () => new Response('{}'))
		_api.setFetch(fetchSpy as unknown as typeof fetch)
		disableRemoteIcons()

		// Fail fast and readably if the switch is broken: a real attempt would only settle after Iconify's own
		// multi-second retry timers.
		const outcome = await Promise.race([
			new Promise<string[]>((resolve) => {
				loadIcons(['lucide:another-not-bundled-icon'], (_loaded, missing) => resolve(missing.map(icon => icon.name)))
			}),
			new Promise<'still waiting'>(resolve => setTimeout(resolve, 500, 'still waiting')),
		])

		expect(outcome)
			.toEqual(['another-not-bundled-icon'])
		expect(fetchSpy)
			.not.toHaveBeenCalled()
	})
})
