import Vue from 'unplugin-vue/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [Vue()],
	test: {
		include: [
			'packages/**/src/**/*.unit.test.ts',
			'apps/**/src/**/*.unit.test.ts',
		],
		coverage: {
			enabled: true,
			provider: 'v8',
			include: [
				'packages/core/src/**/*.ts',
				'packages/vue/src/**/*.ts',
			],
			exclude: [
				'**/*.unit.test.ts',
				'**/dist/**',
				'packages/vue/src/test-fixtures.ts',
				'apps/lab/**',
			],
			excludeAfterRemap: true,
			reporter: [
				['text', { skipFull: false }],
				'html',
				'clover',
				'json',
			],
			// The source repository gated coverage across every DevilTea Labs package as one
			// aggregate. After extracting Widget, the preserved Widget-only baseline is
			// branches 82.8%, functions 95.22%, lines 88.97%, statements 89.22%. Keep
			// rounded-down floors here so the split does not pretend the package previously
			// met the old aggregate 90% gate while still preventing coverage regressions.
			thresholds: {
				branches: 82,
				functions: 95,
				lines: 88,
				statements: 89,
			},
		},
		typecheck: {
			enabled: true,
		},
	},
})
