import type { Plugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Self-hosts `modern-monaco`'s editor engine (issue #30 Scope A).
 *
 * `modern-monaco@0.4.2`'s `loadMonaco()` (`dist/core.mjs`) dynamically `import()`s its editor engine
 * from `https://esm.sh/modern-monaco@<version>/es2022/editor-core.mjs` at runtime UNLESS an
 * `<script type="importmap">` on the page already maps the bare specifier
 * `modern-monaco/editor-core` to a different URL (verified: `dist/core.mjs`'s `loadMonaco()` reads
 * `document.querySelector("script[type='importmap']")` before falling back to the esm.sh URL; the
 * package's own README documents this exact importmap override as the supported "load editor modules
 * from a custom CDN" mechanism). Because that import call uses a runtime-computed string, Vite's
 * bundler cannot see it and never includes `editor-core.mjs` in the normal module graph — so serving
 * it ourselves at a stable, base-aware URL and pointing the importmap at that URL is what makes the
 * Source editor fully self-contained.
 *
 * `dist/editor-core.mjs` (~7.9 MB) has zero static imports of its own (verified: no `^import ` lines
 * in the file) EXCEPT that its `createEditorWorkerMain()` spawns a real dedicated Worker via
 * `new URL('./editor-worker-main.mjs', import.meta.url)` for the `editorWorkerService` — so that
 * sibling file (and the file it in turn imports, `editor-worker.mjs`) must be co-located with
 * `editor-core.mjs` at the vendored URL for that Worker to resolve. All three are vendored together,
 * unhashed, at `<base>vendor/modern-monaco/<file>` so their relative import/URL structure survives
 * unchanged from the package's own `dist/` layout. `modern-monaco/lsp` is NOT vendored: this app never
 * sets `MonacoEnvironment.useBuiltinLSP`, so `loadMonaco()`'s `useBuiltinLSP` branch is dead code here
 * and importing `lsp.mjs` is deliberately never attempted.
 *
 * Never committed to git: this plugin reads the three files straight out of `node_modules` and (a)
 * serves them from dev middleware, (b) `emitFile`s them into the production bundle at build time — no
 * `public/` copy step, no repo-tracked vendor directory.
 */

const VENDOR_DIR = 'vendor/modern-monaco'

const VENDORED_FILES = [
	'editor-core.mjs',
	// Sibling files `editor-core.mjs`'s own `createEditorWorkerMain()` resolves via `import.meta.url`
	// at runtime — see file-level comment above.
	'editor-worker-main.mjs',
	'editor-worker.mjs',
] as const

function resolveVendoredFilePath(fileName: string): string {
	const specifier = `modern-monaco/${fileName.replace(/\.mjs$/, '')}`
	return fileURLToPath(import.meta.resolve(specifier))
}

export function vendorModernMonacoEditorCore(): Plugin {
	let base = '/'
	let command: 'build' | 'serve' = 'serve'

	const filePathsByName = new Map(
		VENDORED_FILES.map(fileName => [fileName, resolveVendoredFilePath(fileName)] as const),
	)

	return {
		name: 'widget-lab:vendor-modern-monaco-editor-core',

		configResolved(config) {
			base = config.base
			command = config.command
		},

		configureServer(server) {
			const routePrefix = `/${VENDOR_DIR}/`
			server.middlewares.use(async (req, res, next) => {
				if (req.url === undefined) {
					next()
					return
				}
				const { pathname } = new URL(req.url, 'http://localhost')
				if (!pathname.startsWith(routePrefix)) {
					next()
					return
				}
				const fileName = pathname.slice(routePrefix.length)
				const filePath = filePathsByName.get(fileName as typeof VENDORED_FILES[number])
				if (filePath === undefined) {
					next()
					return
				}
				res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
				res.end(await readFile(filePath))
			})
		},

		async buildStart() {
			if (command !== 'build')
				return
			for (const [fileName, filePath] of filePathsByName) {
				this.emitFile({
					type: 'asset',
					fileName: `${VENDOR_DIR}/${fileName}`,
					source: await readFile(filePath),
				})
			}
		},

		transformIndexHtml() {
			const importMap = {
				imports: {
					'modern-monaco/editor-core': `${base}${VENDOR_DIR}/editor-core.mjs`,
				},
			}
			return [
				{
					tag: 'script',
					attrs: { type: 'importmap' },
					children: JSON.stringify(importMap),
					// default injectTo is 'head-prepend' — before the body's `<script type="module">` — but
					// spelled out here since being first is load-bearing (modern-monaco reads the importmap
					// synchronously before its own dynamic import, so it must already be in the DOM).
					injectTo: 'head-prepend',
				},
			]
		},
	}
}
