import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listFiles, referencesOf } from './boundary-support'

/**
 * Showcase isolation (issue #230): a showcase (`src/showcases/<id>/**`, `src/sandbox/**`) runs inside the Preview
 * frame and may depend on nothing of the Lab. It may refer to its own directory, the showcase host contract
 * (`src/showcase-host`), `vue` and the published `@deviltea/widget-*` packages (a test also Vitest and Vue Test Utils),
 * plus any extra packages its own `allowed-packages.json` names, and it may not mention the Lab's `--lab-*` tokens or
 * its `data-lab-theme` attribute. The host contract itself imports only itself, `vue` and the `@deviltea/widget-*`
 * packages.
 *
 * "Refer to" is every way a file can reach another one (see `referencesOf`): static and dynamic imports, CSS
 * `@import` and `url()`, SFC `<style src>`/`<script src>`, asset attributes and `new URL(..., import.meta.url)`. A
 * reference whose target cannot be known from the text (a dynamic `import()` with a template or variable,
 * `import.meta.glob`) fails: the guard fails closed. So does any file whose extension is not one of `.ts`, `.vue`,
 * `.css` or `.json`, because it would not be scanned. `showcases/registry.ts` and its test are the Lab-side index of the
 * showcases (they import them and the Lab's own types), the only exemption; every other file directly under
 * `src/showcases/` is showcase code that belongs to no showcase directory.
 *
 * The frame's own import graph (no chrome CSS or libraries) is checked in `styling-boundary.unit.test.ts`, and the
 * shell's (no showcase code) in `shell-isolation.unit.test.ts`.
 */

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const showcasesRoot = join(srcRoot, 'showcases')
const sandboxRoot = join(srcRoot, 'sandbox')
const hostRoot = join(srcRoot, 'showcase-host')
const SHOWCASE_PACKAGES = /^(?:vue|@deviltea\/widget-(?:core|vue|inspector)(?:\/.*)?)$/
const TEST_ONLY_PACKAGES = /^(?:vitest|@vue\/test-utils)$/
const LAB_STYLE_REFERENCE = /--lab-|data-lab-theme|labTheme/
const SCANNED_EXTENSIONS = new Set(['.ts', '.vue', '.css', '.json'])
const PACKAGE_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/
const ALLOWED_PACKAGES_FILE = 'allowed-packages.json'
/** A directory no file lives in: the "own directory" of a file directly under `src/showcases/`, which therefore owns nothing. */
const NO_DIRECTORY = join(showcasesRoot, '\0')
const EXEMPT_FILES = new Set([join(showcasesRoot, 'registry.ts'), join(showcasesRoot, 'registry.unit.test.ts')])

function isUnder(file: string, directory: string): boolean {
	const path = relative(directory, file)
	return path !== '' && !path.startsWith('..')
}

/** The directory a guarded file belongs to; `null` for a file the guard does not cover. */
function ownDirectoryOf(file: string): string | null {
	if (isUnder(file, hostRoot))
		return hostRoot
	if (isUnder(file, sandboxRoot))
		return sandboxRoot
	if (isUnder(file, showcasesRoot) && !EXEMPT_FILES.has(file)) {
		const [first, ...rest] = relative(showcasesRoot, file)
			.split('/')
		return rest.length === 0 ? NO_DIRECTORY : join(showcasesRoot, first!)
	}
	return null
}

/** The extra packages a showcase directory declares in `allowed-packages.json` (`{ "allowedPackages": ["name", ...] }`). */
function readAllowedPackages(directory: string): string[] {
	const path = join(directory, ALLOWED_PACKAGES_FILE)
	if (!existsSync(path))
		return []
	const value = JSON.parse(readFileSync(path, 'utf8')) as { allowedPackages?: unknown }
	const names = value.allowedPackages
	if (!Array.isArray(names) || !names.every(name => typeof name === 'string' && PACKAGE_NAME.test(name)))
		throw new Error(`${relative(srcRoot, path)} must be { "allowedPackages": [<npm package names>] }`)
	return names as string[]
}

/**
 * What `file` (a showcase file, or a file of the host contract itself) must not reference or contain, as readable
 * offences. `extraPackages` are the packages its showcase directory allows beyond the defaults.
 */
function isolationOffences(file: string, text: string, extraPackages: readonly string[] = []): string[] {
	const own = ownDirectoryOf(file)
	if (own === null)
		return []
	const isHost = own === hostRoot
	const isTest = /\.unit\.test\.ts$|\/test-(?:harness|support)\.ts$/.test(file)
	const name = relative(srcRoot, file)
	const offences: string[] = []
	if (!SCANNED_EXTENSIONS.has(extname(file)))
		offences.push(`${name} has an extension the guard does not scan (${extname(file) || 'none'}); only .ts, .vue, .css and .json are allowed`)
	if (LAB_STYLE_REFERENCE.test(text))
		offences.push(`${name} references a Lab style token or theme attribute`)
	const { specifiers, opaque } = referencesOf(text)
	for (const description of opaque)
		offences.push(`${name} has a reference the guard cannot resolve: ${description}`)
	for (const raw of specifiers) {
		const specifier = raw.replace(/[?#].*$/, '')
		if (specifier.startsWith('.')) {
			const target = resolve(dirname(file), specifier)
			const inOwn = own !== NO_DIRECTORY && (target === own || isUnder(target, own))
			const inHost = target === hostRoot || isUnder(target, hostRoot)
			if (!inOwn && !(inHost && !isHost))
				offences.push(`${name} imports ${raw} (outside its own directory and the showcase host contract)`)
		}
		else if (SHOWCASE_PACKAGES.test(specifier) || (isTest && TEST_ONLY_PACKAGES.test(specifier))) {
			// allowed everywhere
		}
		else if (!isHost && extraPackages.some(pkg => specifier === pkg || specifier.startsWith(`${pkg}/`))) {
			// allowed by the showcase's own allowed-packages.json
		}
		else {
			offences.push(`${name} imports ${raw} (not vue, a @deviltea/widget-* package or one its allowed-packages.json names)`)
		}
	}
	return offences
}

describe('showcases are isolated from the Lab', () => {
	const files = listFiles(srcRoot)
		.filter(file => ownDirectoryOf(file) !== null)

	it('covers the survey, the sandbox and the host contract', () => {
		const names = files.map(file => relative(srcRoot, file))
		expect(names)
			.toEqual(expect.arrayContaining([
				'showcases/survey/renderers/SurveyRootRenderer.vue',
				'showcases/survey/renderers/control-style.ts',
				'showcases/survey/sources.ts',
				'sandbox/renderers.ts',
				'showcase-host/host.ts',
			]))
		expect(names)
			.not
			.toContain('showcases/registry.ts')
	})

	it('has no showcase or host-contract file that imports outside its allowed set, has an unresolvable reference, an unscanned extension or a Lab style token', () => {
		const offences = files.flatMap((file) => {
			const own = ownDirectoryOf(file)!
			const extra = own === hostRoot || own === NO_DIRECTORY ? [] : readAllowedPackages(own)
			// An unscanned extension is reported without reading the file as text.
			return isolationOffences(file, SCANNED_EXTENSIONS.has(extname(file)) ? readFileSync(file, 'utf8') : '', extra)
		})
		expect(offences)
			.toEqual([])
	})

	it('has valid allowed-packages.json files: exactly one today, the quote-rules showcase\'s schema library (Valibot and its JSON Schema converter, through Standard Schema)', () => {
		const declared = [showcasesRoot, sandboxRoot]
			.flatMap(root => listFiles(root))
			.filter(file => file.endsWith(`/${ALLOWED_PACKAGES_FILE}`))
		for (const file of declared)
			expect(() => readAllowedPackages(dirname(file)), file).not.toThrow()
		expect(declared.map(file => relative(srcRoot, file)))
			.toEqual(['showcases/quote-rules/allowed-packages.json'])
		expect([...readAllowedPackages(join(showcasesRoot, 'quote-rules'))])
			.toEqual(['@valibot/to-json-schema', 'valibot'])
	})

	describe('the check itself (each forbidden reference is reported)', () => {
		const survey = join(showcasesRoot, 'survey', 'renderers', 'Probe.vue')
		const sandbox = join(sandboxRoot, 'probe.ts')
		const host = join(hostRoot, 'probe.ts')
		const topLevel = join(showcasesRoot, 'shared.ts')

		it('accepts the allowed references', () => {
			const allowed = [
				'import { ref } from \'vue\'',
				'import { useWidget } from \'@deviltea/widget-vue\'',
				'import { inspectAnchorAttributes } from \'@deviltea/widget-inspector/anchor\'',
				'import { useShowcaseHost } from \'../../../showcase-host\'',
				'import { surveyMessages } from \'../messages\'',
				'import source from \'../plugins/survey.ts?raw\'',
				'const text = () => import(\'../plugins/survey.ts?raw\')',
				'const same = () => import(`../plugins/survey.ts`)',
				'<style scoped src="./survey.css"></style>',
				'.a { background: url(./icon.svg); mask: url("../icons/m.svg"); fill: url(#gradient); background: url(data:image/png;base64,AAAA) }',
				'@import "./tokens.css";',
				'const icon = new URL(\'./icon.svg\', import.meta.url)',
				'<img src="./logo.png">',
			].join('\n')
			expect(isolationOffences(survey, allowed))
				.toEqual([])
		})

		it('reports an import of a Lab module, another showcase, a chrome library or an unlisted package', () => {
			for (const source of [
				'import { useLabI18n } from \'../../../composables/use-lab-i18n\'',
				'import { surveyQuestionTarget } from \'../../../tutorial/survey-target-map\'',
				'import { sandboxSystem } from \'../../../sandbox/system\'',
				'import { UButton } from \'@nuxt/ui\'',
				'import Fuse from \'fuse.js\'',
				'import \'../../../styles/global.css\'',
				'export { x } from \'../../registry\'',
				'const lazy = () => import(\'../../../components/Workbench.vue\')',
				'const lazy = () => import(`../../../components/Workbench.vue`)',
			]) {
				expect(isolationOffences(survey, source), source)
					.toHaveLength(1)
			}
			expect(isolationOffences(sandbox, 'import { useLabTheme } from \'../composables/use-lab-theme\''))
				.toHaveLength(1)
			expect(isolationOffences(sandbox, 'import { surveySystem } from \'../showcases/survey/system\''))
				.toHaveLength(1)
		})

		it('accepts a module Worker whose URL stays inside the showcase directory, and reports one that leaves it or is not a literal', () => {
			const quote = join(showcasesRoot, 'quote-rules', 'worker-client.ts')
			expect(isolationOffences(quote, 'const worker = new Worker(new URL(\'./quote.worker.ts\', import.meta.url), { type: \'module\' })'))
				.toEqual([])
			for (const source of [
				'const worker = new Worker(new URL(\'../../graph/layout.worker.ts\', import.meta.url), { type: \'module\' })',
				'const worker = new Worker(new URL(\'../trip-budget/plugins/trip.ts\', import.meta.url), { type: \'module\' })',
				'const worker = new Worker(new URL(file, import.meta.url), { type: \'module\' })',
			]) {
				expect(isolationOffences(quote, source), source)
					.toHaveLength(1)
			}
		})

		it('reports each other way out of the directory (template-literal and variable import(), import.meta.glob, require, new URL)', () => {
			for (const source of [
				// eslint-disable-next-line no-template-curly-in-string -- the source under test is a template literal with a substitution
				'const load = (n: string) => import(`../../../components/${n}.vue`)',
				'const load = (n: string) => import(n)',
				'const load = (n: string) => import(\'../../../components/\' + n)',
				'const all = import.meta.glob(\'../../../components/*.vue\')',
				'const all = import.meta.globEager(\'./*.ts\')',
				'const lib = require(\'../../../composables/use-lab-i18n\')',
				'const url = new URL(\'../../../styles/global.css\', import.meta.url)',
				'const url = new URL(name, import.meta.url)',
				'const here = import.meta.url',
			]) {
				const offences = isolationOffences(survey, source)
				expect(offences, source)
					.not
					.toHaveLength(0)
			}
		})

		it('reports an SFC <style src> / <script src> / <template src>, an asset attribute and a CSS url() or @import, quoted or not, that leaves the directory', () => {
			for (const source of [
				'<style src="../../../styles/lab-ui.css"></style>',
				'<style scoped lang="css" src=\'../../../styles/global.css\'></style>',
				'<script setup src="../../../composables/x.ts"></script>',
				'<template src="../../../components/X.html"></template>',
				'<img src="../../../ui/logo.svg">',
				'<img src="/logo.svg">',
				'.a { background: url(../../../assets/a.png) }',
				'.a { background: url("../../../assets/a.png") }',
				'.a { background: url(\'../../../assets/a.png\') }',
				'.a { background: url( ../../../assets/a.png ) }',
				'.a { background: url(https://example.com/a.png) }',
				'@import url(../../../styles/lab-ui.css);',
				'@import url("../../../styles/lab-ui.css");',
				'@import \'../../../styles/lab-ui.css\';',
				'@import "tailwindcss";',
				'@import url(tailwindcss);',
			]) {
				expect(isolationOffences(survey, source), source)
					.toHaveLength(1)
			}
		})

		it('reports strings inside CSS image-set(), and fails closed on preprocessor styles and Sass @use/@forward', () => {
			for (const source of [
				'.a { background: image-set("../../../assets/a.png" 1x, "../../../assets/b.png" 2x) }',
				'.a { background-image: -webkit-image-set(\'../../../assets/a.png\' 1x) }',
				'.a { background: image-set(url(../../../assets/a.png) 1x, "./ok.png" 2x) }',
				'<style lang="scss">.a { color: red }</style>',
				'<style scoped lang=\'sass\'>.a\n  color: red</style>',
				'<style lang=less>.a { color: red }</style>',
				'<style lang="stylus">.a\n  color red</style>',
				'@use "../../../styles/tokens";',
				'@forward "../../../styles/tokens";',
			]) {
				expect(isolationOffences(survey, source), source)
					.not
					.toHaveLength(0)
			}
			// Inside the directory, image-set is fine.
			expect(isolationOffences(survey, '.a { background: image-set("./a.png" 1x, "./b.png" 2x) }'))
				.toEqual([])
			expect(isolationOffences(survey, '<style lang="css">.a { color: red }</style>'))
				.toEqual([])
		})

		it('reports a --lab-* token or the Lab theme attribute in CSS, an inline style or a selector', () => {
			for (const source of [
				'<style scoped>.a { color: var(--lab-color-text); }</style>',
				'const style = { color: \'var(--lab-color-accent)\' }',
				'html[data-lab-theme=\'light\'] .a { color: red }',
			]) {
				expect(isolationOffences(survey, source), source)
					.toHaveLength(1)
			}
		})

		it('reports a file with an extension the guard does not scan, whatever its content', () => {
			for (const name of ['Probe.tsx', 'probe.js', 'probe.mjs', 'probe.cjs', 'probe.jsx', 'probe.mts', 'probe.scss', 'probe.sass', 'probe.less', 'probe.styl', 'probe.html', 'probe.svg', 'probe.png', 'probe']) {
				expect(isolationOffences(join(showcasesRoot, 'survey', name), ''), name)
					.toHaveLength(1)
			}
			for (const name of ['probe.ts', 'Probe.vue', 'probe.css', 'probe.json']) {
				expect(isolationOffences(join(showcasesRoot, 'survey', name), ''), name)
					.toEqual([])
			}
		})

		it('lets only a test import Vitest and Vue Test Utils, and keeps the host contract free of showcases', () => {
			const testFile = join(showcasesRoot, 'survey', 'x.unit.test.ts')
			expect(isolationOffences(testFile, 'import { it } from \'vitest\'\nimport { mount } from \'@vue/test-utils\''))
				.toEqual([])
			expect(isolationOffences(survey, 'import { it } from \'vitest\''))
				.toHaveLength(1)
			expect(isolationOffences(host, 'import { surveyMessages } from \'../showcases/survey/messages\''))
				.toHaveLength(1)
			expect(isolationOffences(host, 'import { ref } from \'vue\'\nimport { x } from \'./host\''))
				.toEqual([])
		})

		it('treats a file directly under src/showcases (other than the registry) as showcase code that owns no directory', () => {
			expect(isolationOffences(topLevel, 'import { x } from \'./survey/system\''))
				.toHaveLength(1)
			expect(isolationOffences(topLevel, 'import { x } from \'../composables/use-lab-store\''))
				.toHaveLength(1)
			expect(isolationOffences(topLevel, 'import { ref } from \'vue\'\nimport { useShowcaseHost } from \'../showcase-host\''))
				.toEqual([])
			expect(isolationOffences(join(showcasesRoot, 'registry.ts'), 'import { x } from \'../sandbox/system\''))
				.toEqual([])
		})

		it('lets a showcase use the extra packages its allowed-packages.json names (and subpaths), and no other', () => {
			const extra = ['@nuxt/ui', 'tailwindcss']
			expect(isolationOffences(survey, 'import { UButton } from \'@nuxt/ui\'\nimport UApp from \'@nuxt/ui/components/App.vue\'\n@import "tailwindcss";', extra))
				.toEqual([])
			expect(isolationOffences(survey, 'import x from \'@nuxt/ui-other\'', extra))
				.toHaveLength(1)
			expect(isolationOffences(survey, 'import x from \'dockview-vue\'', extra))
				.toHaveLength(1)
			// Without the declaration the same imports are offences, and the host contract can never take extras.
			expect(isolationOffences(survey, 'import { UButton } from \'@nuxt/ui\''))
				.toHaveLength(1)
			expect(isolationOffences(host, 'import { UButton } from \'@nuxt/ui\'', extra))
				.toHaveLength(1)
			// Extra packages widen what may be imported, not where: paths still stay inside the directory.
			expect(isolationOffences(survey, 'import x from \'../../../components/X.vue\'', extra))
				.toHaveLength(1)
		})
	})
})
