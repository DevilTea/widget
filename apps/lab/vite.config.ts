import pikacss from '@pikacss/unplugin-pikacss/vite'
import Vue from 'unplugin-vue/vite'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [
		// `enforce: 'pre'` inside pikacss() already guarantees it runs before Vue regardless of
		// array order; listed first here for readability only.
		pikacss({
			tsCodegen: './src/pika.gen.ts',
			cssCodegen: './src/pika.gen.css',
		}),
		Vue(),
	],
})
