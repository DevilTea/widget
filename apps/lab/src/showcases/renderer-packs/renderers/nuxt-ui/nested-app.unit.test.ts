// @vitest-environment happy-dom
/**
 * The nested Nuxt UI app on its own, mounted the way a careless caller would: outside any component, from a timer. The Nuxt UI
 * plugin registers a generated colour block with `unhead`'s `useHead`, which ties that entry (and its effect) to the component being
 * set up or else to the current effect scope. `mountNuxtUiApp` installs the plugin in a detached scope that `unmount()` stops, so
 * nothing is left in the document head, whoever mounted the app and from where. Without the scope the colour `<style>` stayed on
 * every pack switch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { createPacksRuntime } from '../../test-support'
import { createPacksHost } from '../packs-host'
import { createTestHost, settle } from '../test-harness'
import { createdNuxtUiApps, liveNuxtUiApps, mountNuxtUiApp } from './nested-app'

vi.setConfig({ testTimeout: 30_000 })

const COLOURS = 'style#nuxt-ui-colors, style[data-nuxt-ui-colors]'

afterEach(() => {
	document.body.innerHTML = ''
})

function mountFromATimer() {
	const { runtime } = createPacksRuntime()
	const target = document.createElement('div')
	document.body.append(target)
	return new Promise<ReturnType<typeof mountNuxtUiApp>>((resolve) => {
		// Outside any component lifecycle and outside any effect scope: no current instance, no current scope.
		setTimeout(() => resolve(mountNuxtUiApp({ target, host: createTestHost(), packs: createPacksHost('nui'), runtime: shallowRef(runtime) })), 0)
	})
}

describe('mountNuxtUiApp outside any component', () => {
	it('leaves no colour block in the head after unmount, however often it is mounted and unmounted', async () => {
		await vi.waitFor(() => expect(document.head.querySelectorAll(COLOURS))
			.toHaveLength(0), { timeout: 2000 })
		const liveBefore = liveNuxtUiApps()
		const createdBefore = createdNuxtUiApps()
		for (let round = 0; round < 3; round++) {
			const nested = await mountFromATimer()
			await settle()
			expect(document.head.querySelectorAll(COLOURS), `round ${round}: while mounted`)
				.toHaveLength(1)
			expect(liveNuxtUiApps())
				.toBe(liveBefore + 1)
			nested.unmount()
			// `unhead` renders the removal asynchronously.
			await vi.waitFor(() => expect(document.head.querySelectorAll(COLOURS))
				.toHaveLength(0), { timeout: 2000 })
			expect(liveNuxtUiApps())
				.toBe(liveBefore)
		}
		expect(createdNuxtUiApps())
			.toBe(createdBefore + 3)
	})

	it('unmounts once: a second unmount is a no-op', async () => {
		const nested = await mountFromATimer()
		await settle()
		const live = liveNuxtUiApps()
		nested.unmount()
		nested.unmount()
		expect(liveNuxtUiApps())
			.toBe(live - 1)
		await vi.waitFor(() => expect(document.head.querySelectorAll(COLOURS))
			.toHaveLength(0), { timeout: 2000 })
	})
})
