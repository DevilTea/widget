import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listFiles, specifiersOf } from './boundary-support'

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

/**
 * What the frame may not reach is the CHROME's pipeline: `styles/lab-ui.css`, `nuxt-ui.ts`, `src/ui/`, `src/components/`
 * and the chrome libraries (Dockview, Vue Flow, Monaco). A showcase may bring its own Tailwind/Nuxt UI (an
 * `allowed-packages.json` names the packages, see `showcase-isolation.unit.test.ts`), so `@nuxt/ui` and `tailwindcss`
 * are only forbidden outside a showcase directory, and a stylesheet that carries Tailwind syntax may only be referenced
 * from inside the showcase directory it lives in.
 */
const chromeTargets = [join(srcRoot, 'components'), join(srcRoot, 'ui')]
const chromeFiles = [join(srcRoot, 'styles', 'lab-ui'), join(srcRoot, 'styles', 'lab-ui.css'), join(appRoot, 'nuxt-ui'), join(appRoot, 'nuxt-ui.ts')]
const CHROME_LIBRARIES = /^(?:dockview|@vue-flow|modern-monaco)/
const TAILWIND_LIBRARIES = /^(?:@nuxt\/ui|tailwindcss|@tailwindcss\/)/
const TAILWIND_SYNTAX = /@import\s+["']?(?:tailwindcss|@nuxt\/ui)|@theme|@source|@apply|@tailwind/

function isUnder(file: string, directory: string): boolean {
	const path = relative(directory, file)
	return path !== '' && !path.startsWith('..')
}

/** The directory of the showcase a file belongs to (`showcases/<id>`, or `sandbox`), or `null`. */
function showcaseDirectory(file: string): string | null {
	if (isUnder(file, join(srcRoot, 'sandbox')))
		return join(srcRoot, 'sandbox')
	const showcases = join(srcRoot, 'showcases')
	if (isUnder(file, showcases)) {
		const [first, ...rest] = relative(showcases, file)
			.split('/')
		return rest.length === 0 ? null : join(showcases, first!)
	}
	return null
}

/** Why `importer` importing `specifier` reaches the chrome pipeline, or `null`. */
function chromeLeak(importer: string, specifier: string): string | null {
	if (specifier.startsWith('.') || specifier.startsWith('/')) {
		const target = resolve(dirname(importer), specifier.replace(/[?#].*$/, ''))
		if (chromeFiles.includes(target) || chromeTargets.some(directory => target === directory || isUnder(target, directory)))
			return `${relative(srcRoot, importer)} imports ${specifier} (the chrome's styling pipeline or components)`
		return null
	}
	if (CHROME_LIBRARIES.test(specifier))
		return `${relative(srcRoot, importer)} imports ${specifier} (a chrome library)`
	if (TAILWIND_LIBRARIES.test(specifier) && showcaseDirectory(importer) === null)
		return `${relative(srcRoot, importer)} imports ${specifier} (Tailwind/Nuxt UI outside a showcase directory)`
	return null
}

/** `file` carries Tailwind syntax: it must be inside a showcase directory and only imported from inside that directory. */
function tailwindEntryLeak(file: string, text: string, importers: readonly string[]): string | null {
	if (!TAILWIND_SYNTAX.test(text))
		return null
	const directory = showcaseDirectory(file)
	if (directory === null)
		return `${relative(srcRoot, file)} carries Tailwind syntax outside a showcase directory`
	const outsider = importers.find(importer => !isUnder(importer, directory))
	return outsider === undefined ? null : `${relative(srcRoot, outsider)} references ${relative(srcRoot, file)}, a showcase's own Tailwind entry, from outside ${relative(srcRoot, directory)}`
}

describe('the Preview frame does not reach the chrome styling pipeline', () => {
	it('imports neither the chrome pipeline (lab-ui.css, nuxt-ui.ts, ui/, components/, Dockview, Vue Flow, Monaco) nor a Tailwind entry from outside its showcase, directly or transitively', () => {
		const entry = join(srcRoot, 'preview-frame-main.ts')
		const seen = new Set<string>()
		const importersOf = new Map<string, string[]>()
		const queue = [entry]
		const offences: string[] = []
		while (queue.length > 0) {
			const file = queue.pop()!
			if (seen.has(file))
				continue
			seen.add(file)
			const source = readFileSync(file, 'utf8')
			for (const specifier of specifiersOf(source)) {
				const leak = chromeLeak(file, specifier)
				if (leak !== null)
					offences.push(leak)
				const local = resolveLocal(file, specifier)
				if (local !== null) {
					importersOf.set(local, [...importersOf.get(local) ?? [], file])
					queue.push(local)
				}
			}
		}
		for (const file of seen) {
			if (!/\.(?:css|vue)$/.test(file))
				continue
			const leak = tailwindEntryLeak(file, readFileSync(file, 'utf8'), importersOf.get(file) ?? [])
			if (leak !== null)
				offences.push(leak)
		}
		expect(offences)
			.toEqual([])
		// Sanity: the walk really covered the frame's stylesheets and a renderer, not just the entry.
		const visited = [...seen].map(file => relative(srcRoot, file))
		expect(visited)
			.toEqual(expect.arrayContaining([
				'styles/lab-tokens.css',
				'styles/preview-frame.css',
				'showcase-host/index.ts',
				'showcases/survey/renderers/SurveyRootRenderer.vue',
			]))
		// The shell's baseline (dialogs, narrow-viewport gate, document font) is not part of the frame document.
		expect(visited)
			.not
			.toContain('styles/global.css')
	})

	it('reaches the survey renderers only through the lazy frame registry (a dynamic import the walk follows)', () => {
		const registry = readFileSync(join(srcRoot, 'preview-frame-renderers.ts'), 'utf8')
		expect(specifiersOf(registry))
			.toEqual(expect.arrayContaining(['./showcases/survey/renderers', './sandbox/renderers']))
	})

	describe('the rule itself (each leak is reported, and a showcase\'s own entry is expressible)', () => {
		const frameEntry = join(srcRoot, 'preview-frame-main.ts')
		const renderer = join(srcRoot, 'showcases', 'future', 'renderers', 'Root.vue')

		it('reports the chrome pipeline, components and chrome libraries from anywhere in the frame', () => {
			for (const [importer, specifier] of [
				[frameEntry, './styles/lab-ui.css'],
				[frameEntry, './styles/lab-ui'],
				[frameEntry, '../nuxt-ui'],
				[frameEntry, './ui/offline-icons'],
				[frameEntry, './components/Workbench.vue'],
				[renderer, '../../../components/Workbench.vue'],
				[renderer, '../../../ui/offline-icons'],
				[renderer, '../../../styles/lab-ui.css'],
				[renderer, 'dockview-vue'],
				[renderer, '@vue-flow/core'],
				[renderer, 'modern-monaco'],
			] as const)
				expect(chromeLeak(importer, specifier), `${importer} -> ${specifier}`).not.toBeNull()
		})

		it('reports @nuxt/ui and tailwindcss outside a showcase directory but not inside one', () => {
			for (const specifier of ['@nuxt/ui', '@nuxt/ui/vue-plugin', 'tailwindcss', 'tailwindcss/theme.css', '@tailwindcss/vite']) {
				expect(chromeLeak(frameEntry, specifier), specifier)
					.not
					.toBeNull()
				expect(chromeLeak(join(srcRoot, 'showcase-host', 'index.ts'), specifier), specifier)
					.not
					.toBeNull()
				expect(chromeLeak(renderer, specifier), specifier)
					.toBeNull()
				expect(chromeLeak(join(srcRoot, 'sandbox', 'renderers.ts'), specifier), specifier)
					.toBeNull()
			}
		})

		it('lets a showcase\'s own Tailwind entry be referenced only from inside that showcase\'s directory', () => {
			const entry = join(srcRoot, 'showcases', 'future', 'future-ui.css')
			const css = '@layer theme, base, components, utilities;\n@import "tailwindcss/theme.css" layer(theme);\n@theme { --color-brand: red; }'
			expect(tailwindEntryLeak(entry, css, [renderer]))
				.toBeNull()
			expect(tailwindEntryLeak(entry, css, []))
				.toBeNull()
			expect(tailwindEntryLeak(entry, css, [renderer, frameEntry]))
				.toContain('from outside showcases/future')
			expect(tailwindEntryLeak(entry, css, [join(srcRoot, 'showcases', 'other', 'renderers', 'Root.vue')]))
				.toContain('from outside showcases/future')
			expect(tailwindEntryLeak(join(srcRoot, 'styles', 'preview-frame.css'), css, [frameEntry]))
				.toContain('outside a showcase directory')
			expect(tailwindEntryLeak(join(srcRoot, 'styles', 'preview-frame.css'), '.a { color: red }', [frameEntry]))
				.toBeNull()
		})
	})

	it('has no Tailwind source or @theme in the frame stylesheets', () => {
		for (const name of ['global.css', 'lab-tokens.css', 'preview-frame.css', 'tutorial-theme.css']) {
			const css = readFileSync(join(srcRoot, 'styles', name), 'utf8')
			expect(css, name)
				.not
				.toMatch(/@import\s+["']?(?:tailwindcss|@nuxt\/ui)|@theme|@source|@apply|@tailwind/)
		}
	})
})
