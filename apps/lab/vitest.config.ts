import Vue from 'unplugin-vue/vite'
import { defineConfig } from 'vitest/config'
import { labNuxtUi } from './nuxt-ui'
import { labWidgetDocs } from './widget-docs'

export default defineConfig({
	plugins: [Vue(), labNuxtUi(), labWidgetDocs()],
	test: {
		include: ['src/**/*.unit.test.ts'],
		// Global offline-icons guarantee, see the file.
		setupFiles: ['./src/test-setup.ts'],
	},
})
