import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

/**
 * Isolated production Preview-host contract. Build with
 * VITE_PREVIEW_FRAME_ORIGIN=http://127.0.0.1:4175 before running this config; both hosts then serve
 * the built artifact on distinct origins, while the main browser suite remains on its default.
 */
export default defineConfig({
	testDir: './e2e',
	testMatch: '**/preview-origin.spec.ts',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: 'list',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
	],
	webServer: [
		{
			command: 'pnpm exec vite preview --port 4173 --strictPort',
			port: 4173,
			reuseExistingServer: !process.env.CI,
		},
		{
			command: 'pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort',
			port: 4175,
			reuseExistingServer: !process.env.CI,
		},
	],
})
