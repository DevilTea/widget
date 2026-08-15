import { test as base, expect } from '@playwright/test'

/**
 * Shared fixture for every spec in this suite (issue #28 "no external network"): aborts every request
 * whose hostname is not the local preview server, so the suite can never pass by accident depending on
 * something off-repo being reachable (most notably `modern-monaco`'s esm.sh CDN load — see
 * `src/composables/use-monaco-editor.ts` and issue #30). Routing at the Playwright layer (rather than,
 * say, an OS-level firewall) keeps this self-contained in the harness and gives a blocked request a
 * clear, deterministic `net::ERR_BLOCKED_BY_CLIENT` outcome instead of a real, slow DNS/TLS failure.
 *
 * `127.0.0.1`/`localhost` are both allowed since `webServer`/`baseURL` in `playwright.config.ts` use
 * `localhost`, but a redirect or absolute asset URL could resolve either form.
 */
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

export const test = base.extend({
	page: async ({ page }, use) => {
		await page.route('**/*', async (route) => {
			const hostname = new URL(route.request()
				.url()).hostname
			if (ALLOWED_HOSTNAMES.has(hostname)) {
				await route.continue()
				return
			}
			await route.abort('blockedbyclient')
		})
		await use(page)
	},
})

export { expect }
