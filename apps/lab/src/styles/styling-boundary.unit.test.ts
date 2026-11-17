import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Styling boundaries of the Lab (issue #230):
 *
 * - PikaCSS is gone: nothing in this app imports it, configures it, generates its files or calls `pika()`.
 * - The Lab chrome is styled with Tailwind v4 and Nuxt UI (`styles/lab-ui.css`, imported by `main.ts` only); the
 *   Preview frame (`preview-frame-main.ts`) and the showcase renderers it mounts are plain CSS, so nothing the
 *   frame imports, directly or through another module, may reach that pipeline. The built frame document is
 *   checked in the browser by `e2e/nuxt-ui.spec.ts` ("Preview frame isolation").
 */

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const srcRoot = join(appRoot, 'src')
const thisFile = fileURLToPath(import.meta.url)

function listFiles(directory: string, files: string[] = []): string[] {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'test-results' || entry.name === 'playwright-report')
			continue
		const path = join(directory, entry.name)
		if (entry.isDirectory())
			listFiles(path, files)
		else
			files.push(path)
	}
	return files
}

/** Every module/stylesheet specifier a file imports (static, side-effect, dynamic and CSS `@import`). */
function specifiersOf(source: string): string[] {
	const found: string[] = []
	for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|@import\s+(?:url\()?)['"]([^'"]+)['"]/g))
		found.push(match[1]!)
	return found
}

function resolveLocal(from: string, specifier: string): string | null {
	if (!specifier.startsWith('.'))
		return null
	const base = resolve(dirname(from), specifier)
	for (const candidate of [base, `${base}.ts`, `${base}.vue`, `${base}.css`, join(base, 'index.ts')]) {
		if (existsSync(candidate) && !readdirOrNull(candidate))
			return candidate
	}
	return null
}

function readdirOrNull(path: string): boolean {
	try {
		readdirSync(path)
		return true
	}
	catch {
		return false
	}
}

describe('the Lab has no PikaCSS', () => {
	const FORBIDDEN = [
		/@pikacss\//,
		/\bpikacss\b/i,
		/\bpika\.(?:css|config|gen)\b/,
		/\bpikap?\(/,
		/\bpika:codegen\b/,
	]

	it('has no PikaCSS dependency, plugin, config, generated file, import or pika() call in code, config or HTML (docs may mention it)', () => {
		const files = [
			...listFiles(srcRoot),
			...listFiles(join(appRoot, 'e2e')),
			...listFiles(join(appRoot, 'e2e-pages')),
			...listFiles(join(appRoot, 'scripts')),
			...readdirSync(appRoot)
				.filter(name => /\.(?:json|ts|mts|mjs|js|html|css)$/.test(name))
				.map(name => join(appRoot, name)),
		].filter(file => file !== thisFile && !file.endsWith('.png'))

		const offences: string[] = []
		for (const file of files) {
			const text = readFileSync(file, 'utf8')
			for (const pattern of FORBIDDEN) {
				if (pattern.test(text))
					offences.push(`${relative(appRoot, file)} matches ${pattern}`)
			}
		}
		expect(offences)
			.toEqual([])
		expect(existsSync(join(appRoot, 'pika.config.ts')))
			.toBe(false)
		expect(existsSync(join(srcRoot, 'pika.gen.ts')))
			.toBe(false)
	})
})

describe('the Preview frame does not reach the chrome styling pipeline', () => {
	it('imports neither lab-ui.css, Tailwind, Nuxt UI nor the chrome component tree, directly or transitively', () => {
		const entry = join(srcRoot, 'preview-frame-main.ts')
		const seen = new Set<string>()
		const queue = [entry]
		const offences: string[] = []
		while (queue.length > 0) {
			const file = queue.pop()!
			if (seen.has(file))
				continue
			seen.add(file)
			const source = readFileSync(file, 'utf8')
			for (const specifier of specifiersOf(source)) {
				if (/^(?:@nuxt\/ui|tailwindcss|dockview|@vue-flow|modern-monaco)/.test(specifier) || specifier.includes('lab-ui.css') || specifier.includes('/components/'))
					offences.push(`${relative(srcRoot, file)} imports ${specifier}`)
				const local = resolveLocal(file, specifier)
				if (local !== null)
					queue.push(local)
			}
		}
		expect(offences)
			.toEqual([])
		// Sanity: the walk really covered the frame's stylesheets and a renderer, not just the entry.
		const visited = [...seen].map(file => relative(srcRoot, file))
		expect(visited)
			.toEqual(expect.arrayContaining([
				'styles/global.css',
				'styles/preview-frame.css',
				'showcases/survey/renderers/SurveyRootRenderer.vue',
			]))
	})

	it('has no Tailwind source or @theme in the frame stylesheets', () => {
		for (const name of ['global.css', 'preview-frame.css', 'tutorial-theme.css']) {
			const css = readFileSync(join(srcRoot, 'styles', name), 'utf8')
			expect(css, name)
				.not
				.toMatch(/@import\s+["']?(?:tailwindcss|@nuxt\/ui)|@theme|@source|@apply|@tailwind/)
		}
	})
})
