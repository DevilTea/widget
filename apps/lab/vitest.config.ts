import Vue from 'unplugin-vue/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [Vue()],
	test: {
		include: ['src/**/*.unit.test.ts'],
		// Vuetify components import their colocated CSS. Keep Vuetify inside Vite's transform
		// pipeline so registry-importing unit suites never hand those CSS imports directly to Node.
		server: {
			deps: { inline: ['vuetify'] },
		},
	},
})
