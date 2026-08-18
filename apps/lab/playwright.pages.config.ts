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
		baseURL: 'http://localhost:4174',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
	],
	webServer: {
		command: 'pnpm --dir ../../docs/site run preview -- --port 4174 --strictPort',
		// VitePress's configured base makes `/` a non-ready response. Probe the actual served docs root
		// so Playwright does not mistake a healthy preview server for a startup timeout.
		url: 'http://localhost:4174/deviltea-labs/',
		reuseExistingServer: !process.env.CI,
	},
})
