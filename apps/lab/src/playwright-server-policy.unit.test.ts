import { describe, expect, it } from 'vitest'

interface WebServerConfigLike {
	readonly reuseExistingServer?: boolean
}

interface PlaywrightConfigModuleLike {
	readonly default: {
		readonly webServer?: WebServerConfigLike | readonly WebServerConfigLike[]
	}
}

const configModules = import.meta.glob('../playwright*.config.ts', { eager: true }) as Record<string, PlaywrightConfigModuleLike>

describe('playwright local web-server ownership', () => {
	it('never reuses an arbitrary process already listening on a configured port', () => {
		expect(Object.keys(configModules).length)
			.toBeGreaterThan(0)

		for (const [path, module] of Object.entries(configModules)) {
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
	})
})
