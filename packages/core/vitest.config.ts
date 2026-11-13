import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		// The retention tests observe garbage collection, which needs the collector exposed to the workers.
		execArgv: ['--expose-gc'],
		include: ['src/**/*.unit.test.ts'],
	},
})
