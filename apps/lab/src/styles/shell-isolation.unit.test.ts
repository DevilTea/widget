import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { specifiersOf } from './boundary-support'

/**
 * The other direction of showcase isolation (issue #230): no showcase renderer, component or stylesheet reaches the Lab
 * SHELL document. `showcases/registry.ts` is shell-safe metadata (system, presets, sources); a renderer is loaded only
 * in the Preview frame, through the lazy `preview-frame-renderers.ts`.
 *
 * Two checks of the same property: the shell's source import graph (`main.ts`, every import including lazy ones) holds
 * no renderer file, and the BUILT shell document (`dist/index.html`) links no stylesheet and statically loads no chunk
 * that carries showcase renderer code. The second needs a build, like the docs samples (`pnpm check` builds first).
 */

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const srcRoot = join(appRoot, 'src')
const dist = join(appRoot, 'dist')

function resolveLocal(from: string, specifier: string): string | null {
	if (!specifier.startsWith('.'))
		return null
	const base = resolve(dirname(from), specifier)
	for (const candidate of [base, `${base}.ts`, `${base}.vue`, `${base}.css`, join(base, 'index.ts')]) {
		if (existsSync(candidate) && !isDirectory(candidate))
			return candidate
	}
	return null
}

function isDirectory(path: string): boolean {
	try {
		readdirSync(path)
		return true
	}
	catch {
		return false
	}
}

/** A file that is showcase renderer code: a Vue component or stylesheet of a showcase, or a `renderers` module. */
function isShowcaseRendererFile(file: string): boolean {
	const path = relative(srcRoot, file)
	if (path === 'sandbox/renderers.ts' || /^showcases\/[^/]+\/renderers\//.test(path))
		return true
	return /^(?:showcases|sandbox)\//.test(path) && /\.(?:vue|css)$/.test(path)
}

/** Everything the file imports, transitively, as absolute paths (every import form, lazy ones included). */
function importGraph(entry: string): Set<string> {
	const seen = new Set<string>()
	const queue = [entry]
	while (queue.length > 0) {
		const file = queue.pop()!
		if (seen.has(file))
			continue
		seen.add(file)
		for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
			const local = resolveLocal(file, specifier)
			if (local !== null && /\.(?:ts|vue|css)$/.test(local))
				queue.push(local)
		}
	}
	return seen
}

/** Chunk files a built JS file loads at once: `import ... from "./x.js"` and `import "./x.js"`, not `import("./x.js")`. */
function staticChunkImports(js: string): string[] {
	return [...js.matchAll(/(?:\bfrom|\bimport)\s*["'](\.\/[^"']+\.js)["']/g)].map(match => basename(match[1]!))
}

/** The manifest keys the loaders of `preview-frame-renderers.ts` should produce: each one's import target, as a source path. */
function lazyRendererSources(): string[] {
	const registry = join(srcRoot, 'preview-frame-renderers.ts')
	return specifiersOf(readFileSync(registry, 'utf8'))
		.filter(specifier => specifier.startsWith('.'))
		.map(specifier => relative(appRoot, resolveLocal(registry, specifier)!))
}

function assetOf(href: string): string {
	return join(dist, 'assets', basename(href))
}

interface ManifestChunk {
	readonly file: string
	readonly isEntry?: boolean
	readonly isDynamicEntry?: boolean
	readonly imports?: readonly string[]
	readonly dynamicImports?: readonly string[]
	readonly css?: readonly string[]
}

/** Vite's `dist/.vite/manifest.json`: every chunk by source key, with its static imports, lazy imports and stylesheets. */
type Manifest = Readonly<Record<string, ManifestChunk>>

function synthetic(manifest: Manifest): Manifest {
	return manifest
}

/** The chunks reachable from `roots` through static `imports` (never through `dynamicImports`), roots included. */
function staticClosure(manifest: Manifest, roots: readonly string[]): Map<string, ManifestChunk> {
	const closure = new Map<string, ManifestChunk>()
	const queue = [...roots]
	while (queue.length > 0) {
		const key = queue.shift()!
		const chunk = manifest[key]
		if (chunk === undefined || closure.has(key))
			continue
		closure.set(key, chunk)
		queue.push(...chunk.imports ?? [])
	}
	return closure
}

/**
 * The chunks reachable from `roots` through static `imports` AND through `dynamicImports` other than `?raw` source texts, roots
 * included: a renderer may have lazy chunks of its own behind it (the renderer-packs showcase loads its Nuxt UI pack that way), and
 * those carry its code and styles just as much as the renderer entry.
 */
function lazyClosure(manifest: Manifest, roots: readonly string[]): Map<string, ManifestChunk> {
	const closure = new Map<string, ManifestChunk>()
	const queue = [...roots]
	while (queue.length > 0) {
		const key = queue.shift()!
		const chunk = manifest[key]
		if (chunk === undefined || closure.has(key))
			continue
		closure.set(key, chunk)
		queue.push(...chunk.imports ?? [], ...(chunk.dynamicImports ?? []).filter(dynamic => !dynamic.endsWith('?raw')))
	}
	return closure
}

/**
 * The chunks that exist only for a showcase renderer: what the Preview frame imports lazily (its dynamic imports other than
 * `?raw` source texts, which are `preview-frame-renderers.ts`'s loaders), what those load statically and the lazy chunks behind
 * them, minus whatever the frame loads at once anyway. Derived from the manifest, so any showcase the frame can load is covered.
 */
function rendererChunks(manifest: Manifest): Map<string, ManifestChunk> {
	const frame = manifest['preview-frame.html']
	if (frame === undefined)
		throw new Error('the manifest has no preview-frame.html entry')
	const owned = lazyClosure(manifest, rendererEntries(manifest))
	for (const key of staticClosure(manifest, ['preview-frame.html'])
		.keys())
		owned.delete(key)
	return owned
}

/** The frame's lazily loaded renderer entries (its dynamic imports other than `?raw` source texts). */
function rendererEntries(manifest: Manifest): string[] {
	return (manifest['preview-frame.html']?.dynamicImports ?? []).filter(key => !key.endsWith('?raw'))
}

/**
 * What of a showcase renderer the shell entry loads statically or links, as readable offences: a renderer entry itself, or a
 * stylesheet of a chunk that only renderers load. (A code chunk the shell and the renderers both need, such as the SFC helper,
 * is shared on purpose and not a leak.)
 */
function shellLeaks(manifest: Manifest): string[] {
	const entries = new Set(rendererEntries(manifest))
	const owned = rendererChunks(manifest)
	const ownedCss = new Set([...owned.values()].flatMap(chunk => chunk.css ?? []))
	const offences: string[] = []
	for (const [key, chunk] of staticClosure(manifest, ['index.html'])) {
		if (entries.has(key))
			offences.push(`${chunk.file} is a showcase renderer, loaded by index.html`)
		for (const css of chunk.css ?? []) {
			if (ownedCss.has(css))
				offences.push(`${css} is linked by index.html but belongs to a showcase renderer`)
		}
	}
	return offences
}

describe('the Lab shell does not load showcase renderers', () => {
	it('has no showcase renderer, Vue component or stylesheet in the source import graph of main.ts', () => {
		const graph = importGraph(join(srcRoot, 'main.ts'))
		expect([...graph].filter(isShowcaseRendererFile)
			.map(file => relative(srcRoot, file)))
			.toEqual([])
		// Sanity: the walk reaches the registry (the shell's source of showcase metadata) and the frame's registry is not part of it.
		const visited = [...graph].map(file => relative(srcRoot, file))
		expect(visited)
			.toEqual(expect.arrayContaining(['showcases/registry.ts', 'showcases/survey/presets.ts']))
		expect(visited)
			.not
			.toContain('preview-frame-renderers.ts')
	})

	it('classifies renderer files (the check itself)', () => {
		for (const path of ['showcases/survey/renderers/index.ts', 'showcases/survey/renderers/QuestionFrame.vue', 'showcases/other/Panel.vue', 'sandbox/renderers.ts', 'showcases/x/theme.css']) {
			expect(isShowcaseRendererFile(join(srcRoot, path)), path)
				.toBe(true)
		}
		for (const path of ['showcases/registry.ts', 'showcases/survey/system.ts', 'showcases/survey/presets.ts', 'sandbox/system.ts', 'components/Workbench.vue']) {
			expect(isShowcaseRendererFile(join(srcRoot, path)), path)
				.toBe(false)
		}
	})

	describe('built output (needs `pnpm build`)', () => {
		it('derives the renderer chunks and styles from the build manifest, whatever the showcase', () => {
			const manifest = synthetic({
				'index.html': { file: 'assets/lab.js', isEntry: true, imports: ['_shared.js'], css: ['assets/lab.css'] },
				'preview-frame.html': { file: 'assets/frame.js', isEntry: true, imports: ['_shared.js'], dynamicImports: ['src/showcases/x/renderers/index.ts', 'src/showcases/x/renderers/Source.vue?raw'], css: ['assets/frame.css'] },
				'_shared.js': { file: 'assets/shared.js', css: ['assets/shared.css'] },
				'_lib.js': { file: 'assets/lib.js' },
				'src/showcases/x/renderers/index.ts': { file: 'assets/x-renderers.js', isDynamicEntry: true, imports: ['_shared.js', '_lib.js'], css: ['assets/x.css'] },
				'src/showcases/x/renderers/Source.vue?raw': { file: 'assets/source.js', isDynamicEntry: true },
			})
			const owned = rendererChunks(manifest)
			// The lazy renderer entry and what it loads on top of what the frame loads at once; not a `?raw` source text.
			expect([...owned.keys()].sort())
				.toEqual(['_lib.js', 'src/showcases/x/renderers/index.ts'])
			expect([...owned.values()].flatMap(chunk => chunk.css ?? []))
				.toEqual(['assets/x.css'])
			expect(shellLeaks(manifest))
				.toEqual([])

			// A lazy chunk behind a renderer (its own `import()`) is the renderer's too, with its styles; a `?raw` source text is not.
			const nested = synthetic({
				...manifest,
				'src/showcases/x/renderers/index.ts': { file: 'assets/x-renderers.js', isDynamicEntry: true, imports: ['_shared.js', '_lib.js'], dynamicImports: ['src/showcases/x/renderers/Pack.ts', 'src/showcases/x/renderers/Page.vue?raw'], css: ['assets/x.css'] },
				'src/showcases/x/renderers/Pack.ts': { file: 'assets/x-pack.js', isDynamicEntry: true, imports: ['_shared.js', '_pack-lib.js'], css: ['assets/x-pack.css'] },
				'_pack-lib.js': { file: 'assets/pack-lib.js' },
				'src/showcases/x/renderers/Page.vue?raw': { file: 'assets/page-source.js', isDynamicEntry: true },
			})
			expect([...rendererChunks(nested)
				.keys()].sort())
				.toEqual(['_lib.js', '_pack-lib.js', 'src/showcases/x/renderers/Pack.ts', 'src/showcases/x/renderers/index.ts'])
			expect([...rendererChunks(nested)
				.values()].flatMap(chunk => chunk.css ?? [])
				.sort())
				.toEqual(['assets/x-pack.css', 'assets/x.css'])
			const nestedLeak = synthetic({
				...nested,
				'_shared.js': { file: 'assets/shared.js', css: ['assets/shared.css', 'assets/x-pack.css'] },
			})
			expect(shellLeaks(nestedLeak))
				.toEqual(['assets/x-pack.css is linked by index.html but belongs to a showcase renderer'])

			// A renderer pulled into the shell's static graph, or the stylesheet of one, is reported; a shared helper is not.
			const shared = synthetic({
				...manifest,
				'index.html': { file: 'assets/lab.js', isEntry: true, imports: ['_shared.js', '_lib.js'], css: ['assets/lab.css'] },
			})
			expect(shellLeaks(shared))
				.toEqual([])
			const styled = synthetic({
				...manifest,
				'_shared.js': { file: 'assets/shared.js', css: ['assets/shared.css', 'assets/x.css'] },
			})
			expect(shellLeaks(styled))
				.toEqual(['assets/x.css is linked by index.html but belongs to a showcase renderer'])
			const entry = synthetic({
				...manifest,
				'index.html': { file: 'assets/lab.js', isEntry: true, imports: ['src/showcases/x/renderers/index.ts'], css: ['assets/lab.css'] },
			})
			expect(shellLeaks(entry))
				.toEqual(['assets/x-renderers.js is a showcase renderer, loaded by index.html', 'assets/x.css is linked by index.html but belongs to a showcase renderer'])
		})

		it('has every showcase renderer and its styles out of the shell: index.html links no renderer stylesheet and loads no renderer chunk', () => {
			expect(existsSync(join(dist, '.vite', 'manifest.json')), 'apps/lab/dist/.vite/manifest.json is missing: run `pnpm build` first')
				.toBe(true)
			const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8')) as Manifest
			const owned = rendererChunks(manifest)
			const entryFiles = new Set(rendererEntries(manifest)
				.map(key => manifest[key]!.file))
			const ownedCss = new Set([...owned.values()].flatMap(chunk => chunk.css ?? []))
			// Every loader of the frame's renderer registry is still its own lazy chunk. A renderer that something static also imports
			// is merged into that importer's chunk (and shows up here as a missing entry), however the shell came to import it.
			expect(rendererEntries(manifest)
				.sort())
				.toEqual(lazyRendererSources()
					.sort())
			expect(rendererEntries(manifest).length)
				.toBeGreaterThan(1)
			expect(ownedCss.size, 'a showcase renderer has styles of its own')
				.toBeGreaterThan(0)
			expect(shellLeaks(manifest))
				.toEqual([])

			// The same, from what index.html itself links and loads (not only from the manifest's account of it).
			const html = readFileSync(join(dist, 'index.html'), 'utf8')
			const stylesheets = [...html.matchAll(/<link[^>]*\srel="stylesheet"[^>]*\shref="([^"]+)"/g)].map(match => basename(match[1]!))
			const entries = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(match => basename(match[1]!))
			const preloads = [...html.matchAll(/<link[^>]*\srel="modulepreload"[^>]*\shref="([^"]+)"/g)].map(match => basename(match[1]!))
			expect(stylesheets.length)
				.toBeGreaterThan(0)
			expect(entries.length)
				.toBeGreaterThan(0)
			const loaded = new Set<string>()
			const queue = [...entries, ...preloads]
			while (queue.length > 0) {
				const name = queue.pop()!
				if (loaded.has(name))
					continue
				loaded.add(name)
				queue.push(...staticChunkImports(readFileSync(assetOf(name), 'utf8')))
			}
			expect(stylesheets.filter(name => ownedCss.has(`assets/${name}`)))
				.toEqual([])
			expect([...loaded].filter(name => entryFiles.has(`assets/${name}`)))
				.toEqual([])
		})
	})
})
