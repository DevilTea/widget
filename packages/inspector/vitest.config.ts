import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.unit.test.ts'],
		// Match the root config: node by default; DOM suites opt in with `// @vitest-environment happy-dom`.
		environment: 'node',
		coverage: { enabled: false },
	},
})
