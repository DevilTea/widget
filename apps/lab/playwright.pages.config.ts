import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

/**
 * Built GitHub-Pages integration harness (#47).
 *
 * `pnpm docs:build:pages` is run by CI before this suite. The docs VitePress preview then serves the
 * combined artifact (`/deviltea-labs/` plus the separately-built `/deviltea-labs/widget-lab/`) from one
 * origin, matching the production routing shape without treating Widget Lab as a VitePress page.
 */
export default defineConfig({
	testDir: './e2e-pages',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: 'list',
	use: {
		baseURL: 'http://127.0.0.1:4174',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
	],
	webServer: {
		// Run VitePress directly rather than forwarding CLI arguments through the docs package script;
		// bind IPv4 explicitly so the readiness probe and preview server share the same address family.
		command: 'pnpm --dir ../../docs/site exec vitepress preview . --host 127.0.0.1 --port 4174',
		url: 'http://127.0.0.1:4174/deviltea-labs/',
		reuseExistingServer: !process.env.CI,
	},
})
