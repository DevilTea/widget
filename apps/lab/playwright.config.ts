import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

/**
 * Issue #28 browser-contract harness.
 *
 * Runs against the BUILT app via `vite preview`, not the dev server, so contracts exercise the actual
 * deployed artifact. `webServer` below only *serves* `dist/` — it deliberately does not build it, so a
 * caller that already built (CI's `browser-contracts` job runs `pnpm --filter widget-lab... run build`
 * once, before this suite; locally, run `pnpm --filter widget-lab... run build` yourself first) never
 * pays for a second build here. `reuseExistingServer` still lets a `pnpm --filter widget-lab run dev`-
 * adjacent local iteration loop reuse a preview server already listening on the port.
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
		// artifacts") — both write under `test-results/` (gitignored; see apps/widget-lab/.gitignore),
		// which CI's `browser-contracts` job uploads with `if: failure()`.
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
	],
	webServer: {
		command: 'pnpm run preview -- --port 4173 --strictPort',
		port: 4173,
		reuseExistingServer: !process.env.CI,
	},
})
