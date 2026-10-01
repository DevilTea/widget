import type { FrameLocator, Page } from '@playwright/test'
import { test as base, expect } from '@playwright/test'

/**
 * Shared request boundary for the browser suite. Built-app tests default to the exact origin in
 * `baseURL` (the `vite preview` server on :4173), so same-host requests to Vite's source server on
 * :4174 cannot satisfy a built asset request. The DevTools source-fixture spec opts into its own
 * exact :4174 origin below; that allowance does not apply to built-app tests.
 *
 * `blob:`, `data:`, and `about:` URLs are browser-local resources rather than network origins and
 * remain available. Every other off-origin request is recorded and aborted at the Playwright layer,
 * which keeps the suite offline and makes a wrong-origin asset request deterministic.
 */

/**
 * Issue #25 P1: `App.vue` now shows a first-entry Welcome card whenever
 * `tutorial/session-flags.ts`'s `welcome-dismissed` sessionStorage flag is unset — which every fresh
 * Playwright context always is. Left alone, that would insert an extra modal in front of every one of
 * the pre-existing specs, none of which expect it (issue #28's browser-contract suite predates the
 * tutorial). `context.addInitScript()` pre-sets that exact flag before any page script runs, for EVERY
 * test using this fixture — the same key `session-flags.ts` reads (`isWelcomeDismissed()`), so this is
 * not a parallel/duplicated mechanism, just seeding the real flag the app itself already checks.
 *
 * `e2e/tutorial.spec.ts` is the one spec that must see the real first-entry welcome card (that is
 * exactly what part of it tests) — it opts out via the `welcomeDismissed: false` fixture option below
 * rather than a second fixture file, keeping "which specs see the welcome card" declared in one place.
 */
export const test = base.extend<{
	additionalRequestOrigin: string | null
	blockedRequestUrls: string[]
	expectedRequestOrigin: string | null
	offOriginRequestUrls: string[]
	welcomeDismissed: boolean
}>({
	welcomeDismissed: [true, { option: true }],
	additionalRequestOrigin: [null, { option: true }],
	expectedRequestOrigin: [null, { option: true }],

	// Populated by the `page` fixture below as requests are blocked; a plain array captured by
	// reference so both fixtures share the same instance for a given test. No other fixture
	// dependency needed, but Playwright statically parses this signature for its dependency list, so
	// the empty object-destructure pattern (rather than a plain unused parameter) is required here.
	// eslint-disable-next-line no-empty-pattern
	blockedRequestUrls: async ({}, use) => {
		await use([])
	},
	// eslint-disable-next-line no-empty-pattern
	offOriginRequestUrls: async ({}, use) => {
		await use([])
	},

	page: async ({
		additionalRequestOrigin,
		baseURL,
		blockedRequestUrls,
		context,
		expectedRequestOrigin,
		offOriginRequestUrls,
		page,
	}, use) => {
		const expectedOrigin = new URL(expectedRequestOrigin ?? baseURL ?? 'http://localhost:4173').origin
		const additionalOrigin = additionalRequestOrigin === null
			? null
			: new URL(additionalRequestOrigin).origin
		await context.route('**/*', async (route) => {
			const url = route.request()
				.url()
			const parsedUrl = new URL(url)
			if (
				parsedUrl.protocol === 'blob:'
				|| parsedUrl.protocol === 'data:'
				|| parsedUrl.protocol === 'about:'
				|| parsedUrl.origin === expectedOrigin
				|| parsedUrl.origin === additionalOrigin
			) {
				await route.continue()
				return
			}
			offOriginRequestUrls.push(url)
			blockedRequestUrls.push(url)
			await route.abort('blockedbyclient')
		})
		await use(page)
	},

	context: async ({ context, welcomeDismissed }, use) => {
		if (welcomeDismissed) {
			await context.addInitScript(() => {
				sessionStorage.setItem('widget-lab:tutorial:welcome-dismissed', '1')
			})
		}
		await use(context)
	},
})

export { expect }

/** The isolated Preview execution document introduced by issue #10 / Phase B2. */
export function previewFrame(page: Page): FrameLocator {
	return page.frameLocator('[data-testid=\"preview-frame\"]')
}
