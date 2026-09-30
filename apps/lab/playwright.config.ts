import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

/**
 * Issue #28 browser-contract harness.
 *
 * Starts two distinct browser targets. Most Lab E2E specs use the built app served from `dist/` by
 * `vite preview` on 4173. The DevTools transport contract explicitly visits its fixture on 4174,
 * where Vite serves source modules; it tests the source implementation, not the built distribution.
 *
 * `webServer` only serves these targets; it does not build `dist/`. CI's `browser-contracts` job builds
 * first, and local runs must run `pnpm --filter widget-lab... run build` before this suite. Each server
 * can reuse an already-running instance on its own port when `reuseExistingServer` is enabled.
 *
 * Chromium only for this first iteration (issue #28 non-goals: "exhaustive cross-browser matrix in the
 * first iteration").
 */
export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	// `list` mirrors this repo's terminal-first Vitest output and writes nothing to disk; the HTML
	// reporter is deliberately not used so this suite never accumulates a report directory to gitignore
	// beyond what failure diagnostics below already need.
	reporter: 'list',
	use: {
		baseURL: 'http://localhost:4173',
		// Diagnostics only on failure (issue #28 "preserve useful diagnostics ... do not commit generated
		// artifacts") — both write under `test-results/` (gitignored; see apps/lab/.gitignore),
		// which CI's `browser-contracts` job uploads with `if: failure()`.
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
	],
	webServer: [
		{
			command: 'pnpm run preview -- --port 4173 --strictPort',
			port: 4173,
			reuseExistingServer: !process.env.CI,
		},
		{
			command: 'pnpm exec vite --host 127.0.0.1 --port 4174 --strictPort',
			port: 4174,
			reuseExistingServer: !process.env.CI,
		},
	],
})
