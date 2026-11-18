import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listFiles, specifiersOf } from './boundary-support'

/**
 * Showcase isolation (issue #230): a showcase (`src/showcases/<id>/**`, `src/sandbox/**`) runs inside the Preview
 * frame and may depend on nothing of the Lab. It may import its own directory, the showcase host contract
 * (`src/showcase-host`), `vue` and the published `@deviltea/widget-*` packages (a test also Vitest and Vue Test Utils),
 * and it may not mention the Lab's `--lab-*` tokens or its `data-lab-theme` attribute. The host contract itself
 * imports only itself, `vue` and the `@deviltea/widget-*` packages. `showcases/registry.ts` is the Lab-side index of
 * the showcases (it imports them and the Lab's own types), so it is the one exemption.
 *
 * The frame's own import graph (no chrome CSS or libraries) is checked in `styling-boundary.unit.test.ts`.
 */

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostRoot = join(srcRoot, 'showcase-host')
const SHOWCASE_PACKAGES = /^(?:vue|@deviltea\/widget-(?:core|vue|inspector)(?:\/.*)?)$/
const TEST_ONLY_PACKAGES = /^(?:vitest|@vue\/test-utils)$/
const LAB_STYLE_REFERENCE = /--lab-|data-lab-theme|labTheme/

function isUnder(file: string, directory: string): boolean {
	const path = relative(directory, file)
	return path !== '' && !path.startsWith('..')
}

/** The directory a showcase file belongs to: `showcases/<id>` or `sandbox`; `null` for any other file. */
function showcaseDirectoryOf(file: string): string | null {
	if (isUnder(file, join(srcRoot, 'sandbox')))
		return join(srcRoot, 'sandbox')
	if (isUnder(file, join(srcRoot, 'showcases'))) {
		const id = relative(join(srcRoot, 'showcases'), file)
			.split('/')[0]!
		return id.includes('.') ? null : join(srcRoot, 'showcases', id)
	}
	return null
}

/** What `file` (a showcase file, or a file of the host contract itself) must not reference, as readable offences. */
function isolationOffences(file: string, text: string): string[] {
	const isHost = isUnder(file, hostRoot)
	const own = isHost ? hostRoot : showcaseDirectoryOf(file)
	if (own === null)
		return []
	const isTest = /\.unit\.test\.ts$|\/test-(?:harness|support)\.ts$/.test(file)
	const offences: string[] = []
	const name = relative(srcRoot, file)
	if (LAB_STYLE_REFERENCE.test(text))
		offences.push(`${name} references a Lab style token or theme attribute`)
	for (const raw of specifiersOf(text)) {
		const specifier = raw.replace(/\?.*$/, '')
		if (specifier.startsWith('.')) {
			const target = resolve(dirname(file), specifier)
			const inOwn = target === own || isUnder(target, own)
			const inHost = target === hostRoot || isUnder(target, hostRoot)
			if (!inOwn && !(inHost && !isHost))
				offences.push(`${name} imports ${raw} (outside its own directory and the showcase host contract)`)
		}
		else if (!SHOWCASE_PACKAGES.test(specifier) && !(isTest && TEST_ONLY_PACKAGES.test(specifier))) {
			offences.push(`${name} imports ${raw} (not vue or a @deviltea/widget-* package)`)
		}
	}
	return offences
}

describe('showcases are isolated from the Lab', () => {
	const files = listFiles(srcRoot)
		.filter(file => /\.(?:ts|vue|css)$/.test(file))
		.filter(file => showcaseDirectoryOf(file) !== null || isUnder(file, hostRoot))
		.filter(file => file !== join(srcRoot, 'showcases', 'registry.ts') && file !== join(srcRoot, 'showcases', 'registry.unit.test.ts'))

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

	it('has no showcase or host-contract file that imports outside its allowed set or mentions a Lab style token', () => {
		const offences = files.flatMap(file => isolationOffences(file, readFileSync(file, 'utf8')))
		expect(offences)
			.toEqual([])
	})

	describe('the check itself (each forbidden reference is reported)', () => {
		const survey = join(srcRoot, 'showcases', 'survey', 'renderers', 'Probe.vue')
		const sandbox = join(srcRoot, 'sandbox', 'probe.ts')
		const host = join(hostRoot, 'probe.ts')

		it('accepts the allowed imports', () => {
			const allowed = [
				'import { ref } from \'vue\'',
				'import { useWidget } from \'@deviltea/widget-vue\'',
				'import { inspectAnchorAttributes } from \'@deviltea/widget-inspector/anchor\'',
				'import { useShowcaseHost } from \'../../../showcase-host\'',
				'import { surveyMessages } from \'../messages\'',
				'import source from \'../plugins/survey.ts?raw\'',
				'const text = () => import(\'../plugins/survey.ts?raw\')',
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
				'const lazy = () => import(\'../../../components/Workbench.vue\')',
			]) {
				expect(isolationOffences(survey, source), source)
					.toHaveLength(1)
			}
			expect(isolationOffences(sandbox, 'import { useLabTheme } from \'../composables/use-lab-theme\''))
				.toHaveLength(1)
			expect(isolationOffences(sandbox, 'import { surveySystem } from \'../showcases/survey/system\''))
				.toHaveLength(1)
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

		it('lets only a test import Vitest and Vue Test Utils, and keeps the host contract free of showcases', () => {
			const testFile = join(srcRoot, 'showcases', 'survey', 'x.unit.test.ts')
			expect(isolationOffences(testFile, 'import { it } from \'vitest\'\nimport { mount } from \'@vue/test-utils\''))
				.toEqual([])
			expect(isolationOffences(survey, 'import { it } from \'vitest\''))
				.toHaveLength(1)
			expect(isolationOffences(host, 'import { surveyMessages } from \'../showcases/survey/messages\''))
				.toHaveLength(1)
			expect(isolationOffences(host, 'import { ref } from \'vue\'\nimport { x } from \'./host\''))
				.toEqual([])
		})
	})
})
