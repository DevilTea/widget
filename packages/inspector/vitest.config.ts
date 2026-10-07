import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.unit.test.ts'],
		environment: 'happy-dom',
		coverage: { enabled: false },
	},
})
