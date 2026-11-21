import Vue from 'unplugin-vue/vite'
import { defineConfig } from 'vitest/config'
import { labNuxtUi } from './apps/lab/nuxt-ui'

export default defineConfig({
	plugins: [Vue()],
	test: {
		// The retention tests observe garbage collection, which needs the collector exposed to the workers.
		execArgv: ['--expose-gc'],
		// Three projects share everything above and below (plugins, `execArgv`, coverage, typecheck). Only the Lab's
		// realm loads its Nuxt UI plugin and offline-icons setup, so a Lab or Iconify break cannot fail the
		// package tests or the widget-skills tests at setup.
		projects: [
			{
				extends: true,
				test: {
					name: 'widget-skills',
					include: ['apps/widget-skills/src/**/*.unit.test.ts'],
				},
			},
			{
				extends: true,
				test: {
					name: 'packages',
					include: ['packages/**/src/**/*.unit.test.ts', 'scripts/**/*.unit.test.ts'],
				},
			},
			{
				extends: true,
				plugins: [labNuxtUi()],
				test: {
					name: 'lab',
					include: ['apps/lab/src/**/*.unit.test.ts'],
					// Icons stay offline even where a test does not import `test-support-ui.ts`.
					setupFiles: ['./apps/lab/src/test-setup.ts'],
				},
			},
		],
		coverage: {
			enabled: true,
			provider: 'v8',
			include: [
				'packages/core/src/**/*.ts',
				'packages/inspector/src/**/*.ts',
				'packages/vue/src/**/*.ts',
			],
			exclude: [
				'**/*.unit.test.ts',
				'**/dist/**',
				'packages/inspector/src/test-fixture.ts',
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
