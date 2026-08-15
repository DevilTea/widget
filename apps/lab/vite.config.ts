import process from 'node:process'
import pikacss from '@pikacss/unplugin-pikacss/vite'
import Vue from 'unplugin-vue/vite'
import { defineConfig } from 'vite'
import { vendorModernMonacoEditorCore } from './vite-plugin-vendor-modern-monaco-editor-core'

export default defineConfig({
	// Root-relative ('/') in dev and any standalone build. The combined GitHub Pages deploy
	// (issue #13 Checkpoint A "Widget Lab" deployment section) co-locates this app's build output
	// under docs/site/.vitepress/dist/widget-lab/, so `pnpm docs:build:pages` overrides this via
	// `WIDGET_LAB_BASE=/deviltea-labs/widget-lab/` to keep asset/worker/router URLs correct under
	// that subpath. Left unset, `pnpm dev`/`pnpm build` behavior is unchanged.
	base: process.env.WIDGET_LAB_BASE ?? '/',
	plugins: [
		// `enforce: 'pre'` inside pikacss() already guarantees it runs before Vue regardless of
		// array order; listed first here for readability only.
		pikacss({
			tsCodegen: './src/pika.gen.ts',
			cssCodegen: './src/pika.gen.css',
		}),
		Vue(),
		// Self-hosts `modern-monaco`'s editor engine (issue #30 Scope A) — see the plugin's own
		// file-level comment for the full mechanism.
		vendorModernMonacoEditorCore(),
	],
	// The persistent ELK layout Worker (`src/graph/layout.worker.ts`, issue #13 Phase 5 "Dependency
	// Graph worker loading" comment) is a native Vite module Worker — `format: 'es'` keeps its own
	// `elkjs` import going through normal ESM bundling rather than being wrapped for classic workers.
	worker: {
		format: 'es',
	},
})
