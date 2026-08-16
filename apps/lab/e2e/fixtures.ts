import { test as base, expect } from '@playwright/test'

/**
 * Shared fixture for every spec in this suite (issue #28 "no external network"): aborts every request
 * whose hostname is not the local preview server, so the suite can never pass by accident depending on
 * something off-repo being reachable. Historically this was most notably `modern-monaco`'s esm.sh CDN
 * load; issue #30 Scope A self-hosts the editor engine instead (see
 * `src/composables/use-monaco-editor.ts` and `vite-plugin-vendor-modern-monaco-editor-core.ts`), so
 * this block is now also the mechanism `shell.spec.ts`'s offline Source-editor contract uses to prove
 * no such request is even attempted anymore. Routing at the Playwright layer (rather than, say, an
 * OS-level firewall) keeps this self-contained in the harness and gives a blocked request a clear,
 * deterministic `net::ERR_BLOCKED_BY_CLIENT` outcome instead of a real, slow DNS/TLS failure.
 *
 * `127.0.0.1`/`localhost` are both allowed since `webServer`/`baseURL` in `playwright.config.ts` use
 * `localhost`, but a redirect or absolute asset URL could resolve either form.
 */
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

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
export const test = base.extend<{ blockedRequestUrls: string[], welcomeDismissed: boolean }>({
	welcomeDismissed: [true, { option: true }],

	// Populated by the `page` fixture below as requests are blocked; a plain array captured by
	// reference so both fixtures share the same instance for a given test. No other fixture
	// dependency needed, but Playwright statically parses this signature for its dependency list, so
	// the empty object-destructure pattern (rather than a plain unused parameter) is required here.
	// eslint-disable-next-line no-empty-pattern
	blockedRequestUrls: async ({}, use) => {
		await use([])
	},

	page: async ({ page, blockedRequestUrls }, use) => {
		await page.route('**/*', async (route) => {
			const url = route.request()
				.url()
			const hostname = new URL(url).hostname
			if (ALLOWED_HOSTNAMES.has(hostname)) {
				await route.continue()
				return
			}
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
