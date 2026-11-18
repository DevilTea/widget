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

function assetOf(href: string): string {
	return join(dist, 'assets', basename(href))
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
		it('links no stylesheet with showcase styles and statically loads no chunk with a showcase renderer', () => {
			expect(existsSync(join(dist, 'index.html')), 'apps/lab/dist/index.html is missing: run `pnpm build` first')
				.toBe(true)
			const html = readFileSync(join(dist, 'index.html'), 'utf8')
			const stylesheets = [...html.matchAll(/<link[^>]*\srel="stylesheet"[^>]*\shref="([^"]+)"/g)].map(match => assetOf(match[1]!))
			const entries = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(match => assetOf(match[1]!))
			const preloads = [...html.matchAll(/<link[^>]*\srel="modulepreload"[^>]*\shref="([^"]+)"/g)].map(match => assetOf(match[1]!))
			expect(stylesheets.length)
				.toBeGreaterThan(0)
			expect(entries.length)
				.toBeGreaterThan(0)

			// Every chunk the shell loads without a dynamic import().
			const chunks = new Set<string>()
			const queue = [...entries, ...preloads]
			while (queue.length > 0) {
				const file = queue.pop()!
				if (chunks.has(file))
					continue
				chunks.add(file)
				for (const name of staticChunkImports(readFileSync(file, 'utf8')))
					queue.push(join(dist, 'assets', name))
			}

			// Showcase renderer styles: the survey's own token and root class, as written in `SurveyRootRenderer.vue`.
			const SHOWCASE_STYLE = /--survey-|\.survey\b|data-survey-theme/
			const offences = stylesheets.filter(file => SHOWCASE_STYLE.test(readFileSync(file, 'utf8')))
				.map(file => `${basename(file)} (linked by index.html) carries showcase renderer styles`)
			for (const chunk of chunks) {
				const text = readFileSync(chunk, 'utf8')
				if (/--survey-|data-survey-theme/.test(text) || /^(?:\w+Renderer|QuestionFrame|renderers)-/.test(basename(chunk)))
					offences.push(`${basename(chunk)} (loaded by index.html) carries showcase renderer code`)
			}
			expect(offences)
				.toEqual([])

			// Positive control: the renderer styles and code are in the build, just not in the shell's static graph.
			const assets = readdirSync(join(dist, 'assets'))
			const styled = assets.filter(name => name.endsWith('.css') && SHOWCASE_STYLE.test(readFileSync(join(dist, 'assets', name), 'utf8')))
			expect(styled, 'the survey renderer styles are somewhere in the build')
				.not
				.toEqual([])
			expect(styled.map(name => join(dist, 'assets', name))
				.filter(file => stylesheets.includes(file)))
				.toEqual([])
		})
	})
})
