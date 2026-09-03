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
})
