import process from 'node:process'
import { fileURLToPath } from 'node:url'
import Vue from 'unplugin-vue/vite'
import { defineConfig } from 'vite'
import { labNuxtUi } from './nuxt-ui'
import { vendorModernMonacoEditorCore } from './vite-plugin-vendor-modern-monaco-editor-core'
import { labWidgetDocs } from './widget-docs'

export default defineConfig({
	// Root-relative ('/') in dev and any standalone build. The combined GitHub Pages deploy
	// (issue #13 Checkpoint A "Widget Lab" deployment section) co-locates this app's build output
	// under docs/site/.vitepress/dist/lab/, so `pnpm docs:build:pages` overrides this via
	// `WIDGET_LAB_BASE=/widget/lab/` to keep asset/worker/router URLs correct under
	// that subpath. Left unset, `pnpm dev`/`pnpm build` behavior is unchanged.
	base: process.env.WIDGET_LAB_BASE ?? '/',
	plugins: [
		Vue(),
		// Nuxt UI + Tailwind v4. Only the Lab entry imports their CSS (`src/styles/lab-ui.css` from `main.ts`); the
		// Preview frame entry never does. See `nuxt-ui.ts`.
		labNuxtUi(),
		// Self-hosts `modern-monaco`'s editor engine (issue #30 Scope A) — see the plugin's own
		// file-level comment for the full mechanism.
		vendorModernMonacoEditorCore(),
		// `virtual:widget-docs/<showcase id>`: each showcase's plugin documentation, generated from its Interfaces JSDoc
		// (Core 0.3 carries no descriptions at run time). See `widget-docs.ts`.
		labWidgetDocs(),
	],
	// The persistent ELK layout Worker (`src/graph/layout.worker.ts`, issue #13 Phase 5 "Dependency
	// Graph worker loading" comment) is a native Vite module Worker — `format: 'es'` keeps its own
	// `elkjs` import going through normal ESM bundling rather than being wrapped for classic workers.
	worker: {
		format: 'es',
	},
	build: {
		// `dist/.vite/manifest.json`: which chunk and stylesheet each module landed in, read by `src/styles/shell-isolation.unit.test.ts`.
		manifest: true,
		// Phase B2 Preview is a real second HTML document, not a component rendered in the Lab page.
		// Keep both entries in one Vite build so dev, standalone production, and Pages subpath builds
		// share the exact same module graph/base handling.
		rollupOptions: {
			input: {
				lab: fileURLToPath(new URL('./index.html', import.meta.url)),
				previewFrame: fileURLToPath(new URL('./preview-frame.html', import.meta.url)),
			},
		},
	},
})
