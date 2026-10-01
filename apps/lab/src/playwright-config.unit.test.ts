import { afterEach, describe, expect, it, vi } from 'vitest'

interface BrowserPolicy {
	forbidOnly?: boolean
	failOnFlakyTests?: boolean
	retries?: number
}

async function loadPolicies(ci: string): Promise<readonly BrowserPolicy[]> {
	vi.stubEnv('CI', ci)
	vi.resetModules()

	const [browser, pages] = await Promise.all([
		import('../playwright.config'),
		import('../playwright.pages.config'),
	])

	return [browser.default, pages.default]
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetModules()
})

describe('playwright CI retry policy', () => {
	it('keeps retries for diagnostics but makes any flaky retry fail CI', async () => {
		for (const config of await loadPolicies('1')) {
			expect(config.forbidOnly)
				.toBe(true)
			expect(config.retries)
				.toBe(1)
			expect(config.failOnFlakyTests)
				.toBe(true)
		}
	})

	it('does not turn local retries or flaky-test failure on by default', async () => {
		for (const config of await loadPolicies('')) {
			expect(config.forbidOnly)
				.toBe(false)
			expect(config.retries)
				.toBe(0)
			expect(config.failOnFlakyTests)
				.toBe(false)
		}
	})
})
