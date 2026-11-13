// @ts-check
import deviltea from '@deviltea/eslint-config'

export default deviltea({
	ignores: [
		'**/dist/**',
		'**/.vitepress/cache/**',
		'**/.vitepress/dist/**',
		'**/pika.gen.*',
		'**/test-results/**',
		'**/playwright-report/**',
	],
}, {
	files: ['packages/*/package.json'],
	rules: {
		'pnpm/json-enforce-catalog': 'off',
	},
}, {
	// Benchmark scripts are command-line programs: their output is the point, and they load the built
	// packages with a dynamic import at module level.
	files: ['benchmarks/**/*.mjs'],
	rules: {
		'no-console': 'off',
		'antfu/no-top-level-await': 'off',
	},
})
