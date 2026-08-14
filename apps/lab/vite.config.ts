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
	// The persistent ELK layout Worker (`src/graph/layout.worker.ts`, issue #13 Phase 5 "Dependency
	// Graph worker loading" comment) is a native Vite module Worker — `format: 'es'` keeps its own
	// `elkjs` import going through normal ESM bundling rather than being wrapped for classic workers.
	worker: {
		format: 'es',
	},
})
