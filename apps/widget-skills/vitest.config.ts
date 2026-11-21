import { defineConfig } from 'vitest/config'
import { widgetDocs } from './src/vite'

// Keep the plugin options in step with the `widget-skills` project of the root `vitest.config.ts`.
export default defineConfig({
	plugins: [widgetDocs({ systems: { survey: { module: 'fixtures/survey-system.ts', export: 'surveySystem', tsconfig: 'tsconfig.json' } } })],
	test: {
		include: ['src/**/*.unit.test.ts'],
	},
})
