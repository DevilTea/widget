import { describe, expect, it, vi } from 'vitest'

interface WebServerConfigLike {
	readonly reuseExistingServer?: boolean
}

interface PlaywrightConfigModuleLike {
	readonly default: {
		readonly webServer?: WebServerConfigLike | readonly WebServerConfigLike[]
	}
}

const configModules = import.meta.glob('../playwright*.config.ts') as Record<string, () => Promise<PlaywrightConfigModuleLike>>

describe('playwright local web-server ownership', () => {
	it('never reuses an arbitrary process already listening on a configured port', async () => {
		// Reproduce the local-development environment explicitly. In GitHub Actions CI is truthy,
		// which also made the old `reuseExistingServer: !process.env.CI` configuration look safe.
		vi.stubEnv('CI', '')
		try {
			vi.resetModules()
			const modules = await Promise.all(Object.entries(configModules)
				.map(async ([path, load]) => [path, await load()] as const))
			expect(modules.length)
				.toBeGreaterThan(0)

			for (const [path, module] of modules) {
				const configured = module.default.webServer
				const servers = configured === undefined
					? []
					: Array.isArray(configured)
						? configured
						: [configured]
				expect(servers.length, path)
					.toBeGreaterThan(0)
				for (const server of servers) {
					expect(server.reuseExistingServer, path)
						.toBe(false)
				}
			}
		}
		finally {
			vi.unstubAllEnvs()
		}
	})
})
