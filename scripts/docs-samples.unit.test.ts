import type { DocumentExpectation } from './docs-samples-runner'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverDocuments, extractSamples, readDocument } from './docs-samples'
import { claimMatches, compareOutput, scanLine } from './docs-samples-output'
import { checkDocuments, documentGuardProblems, missingBuildOutput, workspaceRoot } from './docs-samples-runner'

function fence(code: string, indent = '') {
	return [`${indent}\`\`\`ts`, ...code.split('\n')
		.map(line => line === '' ? line : `${indent}${line}`), `${indent}\`\`\``].join('\n')
}

/**
 * What the documents are known to contain. `before`, `after` and `run` are minimums (a sample added later is
 * picked up and checked without editing this list; only a removal, or a change of kind, is caught). `unmarked`
 * is exact: the number of TypeScript fences that carry no marker. A document that is not listed may have no
 * unmarked TypeScript fence at all.
 *
 * Why not "every fence is marked" everywhere: `docs/site/packages/widget-core.md` and the other pages listed
 * below were written with illustrative fragments between their runnable samples, and marking them would edit
 * their prose. They are held at today's count instead, and the check fails when the count drops as well as when
 * it grows, so the number can only be lowered (when you mark a fence) and never quietly leaves room for a new
 * one. The migration guide is already complete, so it is held at zero.
 */
const expectations: Record<string, DocumentExpectation> = {
	// 17 samples written against the published 0.0.6. The 20 that were compiled against the workspace packages are
	// historical since 0.3 (written against 0.1) and are marked `skip`.
	'docs/site/migration/0.1.md': { before: 17, after: 0, run: 0, unmarked: 0 },
	// The 0.3 guide's samples are historical since 0.4 (written against 0.3, no longer compiled) and are marked `skip`.
	'docs/site/migration/0.3.md': { before: 6, after: 0, run: 0, unmarked: 0 },
	// Every change has a `before` sample (0.3 API, not compiled) and an `after` or `run` one.
	'docs/site/migration/0.4.md': { before: 9, after: 2, run: 14, unmarked: 0 },
	'docs/site/packages/widget-core.md': { before: 0, after: 1, run: 28, unmarked: 28 },
	'packages/core/README.md': { before: 0, after: 0, run: 3, unmarked: 3 },
	// The generator's samples compile against its built subpaths; the ones that need a project on disk are `after`.
	'docs/site/packages/widget-docs-generator.md': { before: 0, after: 4, run: 1, unmarked: 0 },
	'packages/docs-generator/README.md': { before: 0, after: 2, run: 0, unmarked: 0 },
	// No marked sample yet: these pages hold unmarked fragments only.
	'docs/site/packages/widget-vue.md': { before: 0, after: 0, run: 0, unmarked: 11 },
	'docs/site/packages/widget-inspector.md': { before: 0, after: 0, run: 0, unmarked: 2 },
	'packages/vue/README.md': { before: 0, after: 0, run: 0, unmarked: 2 },
	'packages/inspector/README.md': { before: 0, after: 0, run: 0, unmarked: 5 },
	// The Agent Skills the packages ship (`packages/*/skills/**/*.md`) follow the same rules: every TypeScript fence
	// is marked, and an API change that breaks a sample fails here. A skill sample cannot import another sample, so
	// each one is complete; the renderer testing sample needs a DOM and is type-checked only.
	'packages/core/skills/widget-plugin-authoring/SKILL.md': { before: 0, after: 0, run: 1, unmarked: 0 },
	'packages/core/skills/widget-plugin-authoring/references/example-interfaces.md': { before: 0, after: 1, run: 0, unmarked: 0 },
	'packages/core/skills/widget-plugin-authoring/references/plugin-docs.md': { before: 0, after: 1, run: 2, unmarked: 0 },
	'packages/vue/skills/widget-vue-renderer/SKILL.md': { before: 0, after: 1, run: 1, unmarked: 0 },
	'docs/architecture/widget-api-conventions.md': { before: 0, after: 0, run: 0, unmarked: 2 },
}

/**
 * Comments that sit on, or directly below, a statement that prints, without being the expected output: a returned
 * value, or a remark. They are the only comments that need not match what the statement printed. Each should be
 * moved above its statement (or reworded) in the document; the check fails when one stops being needed, so the list
 * can only shrink. It is empty today: every comment on a printing statement is its printed output.
 */
const exemptComments: Array<{ document: string, sample: string, comment: string }> = []
const isExempt = (document: string, sample: string, comment: string) => exemptComments.some(entry => entry.document === document && entry.sample === sample && entry.comment === comment)

describe('extractSamples', () => {
	it('reads the marker with or without the colon, and a sample inside an indented list item', () => {
		const text = [
			'<!-- sample: first after -->',
			fence('const a = 1'),
			'',
			'<!-- sample second run -->',
			fence('console.log(2) // 2'),
			'',
			'- an item',
			'',
			'  <!-- sample: nested run -->',
			fence('console.log(3) // 3\nif (true) {\n\tconsole.log(4)\n}', '  '),
		].join('\n')
		const { samples, problems, unmarkedScriptFences } = extractSamples('doc.md', text)
		expect(problems)
			.toEqual([])
		expect(unmarkedScriptFences)
			.toEqual([])
		expect(samples.map(sample => [sample.name, sample.kind, sample.markerLine, sample.codeLine]))
			.toEqual([['first', 'after', 1, 3], ['second', 'run', 6, 8], ['nested', 'run', 13, 15]])
		// The fence indentation is removed, the code's own indentation is kept.
		expect(samples[2]!.code)
			.toBe('console.log(3) // 3\nif (true) {\n\tconsole.log(4)\n}\n')
	})

	it('reports an unmarked TypeScript fence, but not other languages or a fence shown inside another fence', () => {
		const text = [
			fence('const a = 1'),
			'```bash\npnpm test\n```',
			'````md\n<!-- sample: shown run -->\n```ts\nconst b = 2\n```\n````',
		].join('\n\n')
		const { samples, unmarkedScriptFences, problems } = extractSamples('doc.md', text)
		expect(samples)
			.toEqual([])
		expect(problems)
			.toEqual([])
		expect(unmarkedScriptFences.map(entry => entry.line))
			.toEqual([1])
	})

	it('rejects a marker that is malformed, has an unknown kind, is detached from its fence or repeats a name', () => {
		const text = [
			'<!-- sample: a sideways -->',
			fence('1'),
			'<!-- sample: b after -->',
			'',
			fence('2'),
			'<!-- sample: c after -->',
			'prose',
			'<!-- sample c -->',
			fence('3'),
			'<!-- sample: d after -->',
			fence('4'),
			'<!-- sample: d run -->',
			fence('5'),
			'<!-- sample: e after -->',
		].join('\n')
		const { problems } = extractSamples('doc.md', text)
		expect(problems)
			.toEqual([
				expect.stringContaining('doc.md:1: sample "a" has unknown kind "sideways"'),
				expect.stringContaining('doc.md:5: marker "b" must be on the line directly above its code fence'),
				expect.stringContaining('doc.md:10: marker "c" is not followed by a code fence'),
				expect.stringContaining('doc.md:12: malformed sample marker'),
				expect.stringContaining('doc.md:20: sample name "d" is already used at line 16'),
				expect.stringContaining('doc.md:24: marker "e" is not followed by a code fence'),
			])
	})

	it('does not take a sentence that mentions the marker for a marker', () => {
		const text = [
			'Mark a sample with `<!-- sample: <name> <kind> -->` above its fence, or write <!-- sample name --> by mistake.',
			'- `<!-- sample: <name> before|after|run|skip -->` is the marker',
			fence('const a = 1'),
		].join('\n')
		const { problems, samples, unmarkedScriptFences } = extractSamples('doc.md', text)
		expect(problems)
			.toEqual([])
		expect(samples)
			.toEqual([])
		expect(unmarkedScriptFences.map(entry => entry.line))
			.toEqual([3])
	})

	it('accepts only names that are safe in a file name and a message', () => {
		const text = ['a.b-c_1', 'a#b', 'ä', 'a/b', 'a%20b']
			.map(name => `<!-- sample: ${name} after -->\n${fence('1')}`)
			.join('\n')
		const { samples, problems } = extractSamples('doc.md', text)
		expect(samples.map(sample => sample.name))
			.toEqual(['a.b-c_1'])
		expect(problems)
			.toHaveLength(4)
		expect(problems.every(problem => problem.includes('malformed sample marker')))
			.toBe(true)
	})

	it('finds the samples of the repository documents through discovery rather than a list', () => {
		const documents = discoverDocuments(workspaceRoot)
		expect(documents)
			.toEqual(expect.arrayContaining(['docs/site/migration/0.1.md', 'docs/site/packages/widget-core.md', 'packages/core/README.md']))
		// The skills the packages ship, references included, are documents like the others.
		expect(documents)
			.toEqual(expect.arrayContaining([
				'packages/core/skills/widget-plugin-authoring/SKILL.md',
				'packages/core/skills/widget-plugin-authoring/references/example-interfaces.md',
				'packages/core/skills/widget-plugin-authoring/references/plugin-docs.md',
				'packages/vue/skills/widget-vue-renderer/SKILL.md',
			]))
		expect(documents.some(path => path.includes('node_modules')))
			.toBe(false)
	})
})
describe('output comparison', () => {
	it('scans a trailing comment without being fooled by `//` in strings and templates', () => {
		expect(scanLine('const url = \'http://x\' // a'))
			.toEqual({ code: 'const url = \'http://x\' ', comment: 'a' })
		// eslint-disable-next-line no-template-curly-in-string
		expect(scanLine('const t = `a${\'//\'}//b` // c'))
			// eslint-disable-next-line no-template-curly-in-string
			.toEqual({ code: 'const t = `a${\'//\'}//b` ', comment: 'c' })
		expect(scanLine('const a = 1 /* x */ + 2'))
			.toEqual({ code: 'const a = 1 /* x */ + 2', comment: null })
	})

	it.each([
		['true', 'true', true],
		['true: the Method completed', 'true', true],
		['true, and the listener printed "x"', 'true', true],
		['1 (the second)', '1', true],
		['\'Badge configuration\'', 'Badge configuration', true],
		['[ \'a\', \'b\' ]', '[\n  \'a\',\n  \'b\'\n]', true],
		['{ ok: true, value: ... }', 'total -> { ok: true, value: 2 }', true],
		['{ ok: true, value: 2 }', 'reported: { ok: true, value: 2 }', true],
		['{ ok: true, value: ... }', '{ ok: false }', false],
		['valid', 'invalid', false],
		['10', '1', false],
		['0 1', '1', false],
		['1 2', '1', false],
		['1.5', '1', false],
		['1-2', '1', false],
		['2, 3', '2', false],
		['true, false', 'true', false],
		['...', '1', false],
		['... ...', '1', false],
		['2', 'total 2', false],
		['failed Ada Lovelace', 'ready Ada Lovelace', false],
	])('claim %j against output %j: %s', (claim, output, expected) => {
		expect(claimMatches(claim, output))
			.toBe(expected)
	})

	const print = (text: string, ...lines: number[]) => ({ text, lines })

	it('compares the claims on and below printing statements, and ignores comments on statements that print nothing', () => {
		const code = [
			'console.log(1 + 1) // 2',
			'console.log(\'a:\', { ok: true }) // { ok: true }',
			'console.log(\'x\')',
			'// x',
			'for (const value of [1, 2])',
			'\tconsole.log(value)',
			'// 1',
			'// 2',
			'console.log(5) // 6: the sum',
			'console.log(\'schema\') // the schema above',
			'total() // 3, but total() prints nothing',
		].join('\n')
		const outputs = [print('2', 1), print('a: { ok: true }', 2), print('x', 3), print('1', 6), print('2', 6), print('5', 9), print('schema', 10)]
		const comparison = compareOutput(code, outputs)
		expect(comparison.compared.map(claim => claim.line))
			.toEqual([1, 2, 4, 7, 8])
		expect(comparison.failures.map(failure => failure.line))
			.toEqual([9, 10])
		expect(comparison.failures[0]!.message)
			.toContain('the comment claims "6: the sum" but the statement printed "5"')
		expect(comparison.failures[0]!.message)
			.toContain('put a remark on its own line above the statement')

		const exempt = compareOutput(code, outputs, claim => claim === 'the schema above')
		expect(exempt.failures.map(failure => failure.line))
			.toEqual([9])
		expect(exempt.exempted)
			.toEqual([{ line: 10, text: 'the schema above' }])
	})

	it('holds an indirect claim (a call that makes a subscriber print) to the output, in both directions', () => {
		const code = 'notify() // pressed\nnotify() // rejected\nnotify() // pressed\nvalue() // 5'
		const comparison = compareOutput(code, [print('pressed', 9, 1), print('pressed', 9, 2), print('released', 9, 3)])
		expect(comparison.compared.map(claim => claim.line))
			.toEqual([1])
		expect(comparison.failures.map(failure => failure.line))
			.toEqual([2, 3])
		expect(comparison.failures[0]!.message)
			.toContain('claims "rejected"')
		// The sources are the lines that called console, so a mutation of the printed text can be aimed at them.
		expect(comparison.compared[0]!.sources)
			.toEqual([9])
	})

	it('fails a claim whose statement printed nothing, and a block with the wrong number of lines', () => {
		const comparison = compareOutput('if (false)\n\tconsole.log(1) // 1\nconsole.log(2)\n// 2\n// 3', [print('2', 3)])
		expect(comparison.failures.map(failure => failure.line))
			.toEqual([2, 5])
		expect(comparison.failures[1]!.message)
			.toContain('2 comment lines follow a statement that printed 1 lines')
	})

	it('holds a status word to the output', () => {
		const comparison = compareOutput('console.log(state.status.get(), state.title.get()) // failed Ada Lovelace', [print('ready Ada Lovelace', 1)])
		expect(comparison.failures.map(failure => failure.line))
			.toEqual([1])
	})
})

describe('document guards', () => {
	const report = (path: string, counts: Partial<Record<'before' | 'after' | 'run' | 'skip', number>>, unmarked = 0) => ({ path, counts: { before: 0, after: 0, run: 0, skip: 0, ...counts }, unmarked, unmarkedLines: Array.from({ length: unmarked }, (_, index) => index + 1) })
	const expected = (before: number, after: number, run: number, unmarked: number) => ({ before, after, run, unmarked })

	it('names a document that lost samples, changed a sample to another kind, or gained an unmarked fence', () => {
		const problems = documentGuardProblems(
			[report('a.md', { before: 1, after: 2, run: 0 }, 1), report('b.md', {}, 1)],
			{ 'a.md': expected(2, 1, 1, 0), 'gone.md': expected(0, 0, 0, 0) },
		)
		expect(problems)
			.toEqual([
				expect.stringContaining('a.md: found 1 "before" samples, expected at least 2'),
				expect.stringContaining('a.md: found 0 "run" samples, expected at least 1'),
				expect.stringContaining('gone.md: expected document is missing'),
				expect.stringContaining('a.md: 1 TypeScript code fences have no'),
				expect.stringContaining('b.md: 1 TypeScript code fences have no'),
			])
	})

	it('accepts a document that kept everything and gained a sample', () => {
		expect(documentGuardProblems([report('a.md', { before: 3, run: 4 }, 2)], { 'a.md': expected(2, 0, 2, 2) }))
			.toEqual([])
	})

	it('makes the recorded number of unmarked fences a ratchet: it fails when the count drops too', () => {
		expect(documentGuardProblems([report('a.md', { run: 1 }, 27)], { 'a.md': expected(0, 0, 1, 28) }))
			.toEqual([expect.stringContaining('a.md: only 27 TypeScript code fences have no marker, but 28 are recorded; lower `unmarked` for this document in scripts/docs-samples.unit.test.ts to 27.')])
		expect(documentGuardProblems([report('a.md', { run: 1 }, 29)], { 'a.md': expected(0, 0, 1, 28) }))
			.toEqual([expect.stringContaining('a.md: 29 TypeScript code fences have no')])
	})
})

describe('build output', () => {
	it('names the missing files and the command to run when the packages are not built', () => {
		const root = mkdtempSync(join(tmpdir(), 'widget-docs-samples-root-'))
		try {
			for (const directory of ['packages/core', 'packages/vue', 'packages/inspector', 'packages/docs-generator']) {
				mkdirSync(join(root, directory), { recursive: true })
				writeFileSync(join(root, directory, 'package.json'), JSON.stringify({ exports: { '.': { types: './dist/index.d.mts', import: './dist/index.mjs' } } }))
			}
			const message = missingBuildOutput(root)
			expect(message)
				.toContain('packages/core/dist/index.mjs')
			expect(message)
				.toContain('packages/inspector/dist/index.d.mts')
			expect(message)
				.toContain('packages/docs-generator/dist/index.mjs')
			expect(message)
				.toContain('pnpm build')
		}
		finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

// Without a build the samples cannot be resolved. That is one failure here, with the message that says what to do,
// instead of a failure of every test below.
const missingBuild = missingBuildOutput()

describe('the built packages', () => {
	it('exist, because the samples resolve them through their package.json exports', () => {
		if (missingBuild !== null)
			throw new Error(missingBuild)
	})
})

describe.skipIf(missingBuild !== null)('documentation samples', () => {
	// Type-checking resolves the built packages and each runnable sample is a child process.
	const timeout = 180_000

	it('every marked sample is well-formed, type-checks against the built packages, and prints what its comments say', { timeout }, async () => {
		const documents = discoverDocuments(workspaceRoot)
			.map(path => ({ path, text: readDocument(workspaceRoot, path) }))
		const result = await checkDocuments(documents, { isExempt })
		// One message with every problem, so a renamed marker is reported next to the other failures.
		expect([...result.failures, ...documentGuardProblems(result.documents, expectations)]
			.join('\n'))
			.toBe('')
		// The samples state their output in comments; they were compared, not skipped. Raise this when comments are
		// added; a drop means output stopped being compared. The floor is the measured count (113: 69 in the Core guide,
		// 10 in its README, 23 in the 0.4 migration guide, 2 in the generator's page, 8 in Core's plugin-authoring skill
		// and 1 in Vue's renderer skill). It was 90 until the 0.1 migration guide's samples became historical (written
		// against 0.1, no longer compiled, marked `skip`), which removed their compared output.
		expect(result.compared.length)
			.toBeGreaterThanOrEqual(113)
		// An exemption that is no longer needed has to be removed.
		const used = new Set(result.exempted.map(claim => `${claim.document}\n${claim.sample}\n${claim.text}`))
		expect(exemptComments.filter(entry => !used.has(`${entry.document}\n${entry.sample}\n${entry.comment}`)))
			.toEqual([])
	})

	it('names the document, the sample and the line when a sample no longer compiles, runs or prints what it claims', { timeout }, async () => {
		const text = [
			'<!-- sample: broken-types after -->',
			fence('import { createWidgetSystem } from \'@deviltea/widget-core\'\n\nconst count: number = \'one\'\nexport const system = createWidgetSystem'),
			'',
			'<!-- sample: broken-output run -->',
			fence('console.log(1 + 1) // 3'),
			'',
			'<!-- sample: broken-run run -->',
			fence('throw new Error(\'the sample fails\')'),
			'',
			'<!-- sample: fine run -->',
			fence('import { createWidgetSystem } from \'@deviltea/widget-core\'\n\nconsole.log(typeof createWidgetSystem) // function'),
			'',
			'<!-- sample: old before -->',
			fence('const neverCompiled: number = \'0.0.6 syntax\''),
			'',
			'<!-- sample: renamed-marker -->',
			fence('const unmarked = 1'),
		].join('\n')
		const lineOf = (needle: string) => text.split('\n')
			.findIndex(line => line.includes(needle)) + 1
		const result = await checkDocuments([{ path: 'docs/example.md', text }])
		expect(result.failures)
			.toEqual([
				`docs/example.md:${lineOf('<!-- sample: renamed-marker -->')}: malformed sample marker; expected \`<!-- sample: <name> <before|after|run|skip> -->\`: <!-- sample: renamed-marker -->`,
				expect.stringContaining(`docs/example.md:${lineOf('const count')}: sample "broken-types" (after, marker at line 1) does not type-check: TS2322: Type 'string' is not assignable to type 'number'`),
				expect.stringContaining(`docs/example.md:${lineOf('// 3')}: sample "broken-output" (run, marker at line ${lineOf('sample: broken-output')}) printed something other than its comment says: the comment claims "3" but the statement printed "2"`),
				expect.stringMatching(new RegExp(`^docs/example\\.md:${lineOf('sample: broken-run')}: sample "broken-run" \\(run, marker at line ${lineOf('sample: broken-run')}\\) exited with 1:\\n.*the sample fails`, 's')),
			])
		// The fence under the malformed marker is unmarked, so a document that is not listed is refused too.
		expect(documentGuardProblems(result.documents, {}))
			.toEqual([expect.stringContaining('docs/example.md: 1 TypeScript code fences have no')])
	})

	it('holds indirect output and a status word to the printed text', { timeout }, async () => {
		const text = [
			'<!-- sample: indirect run -->',
			fence('const listeners: Array<() => void> = []\nlisteners.push(() => console.log(\'pressed\'))\nfunction press() {\n\tfor (const listener of listeners)\n\t\tlistener()\n}\npress() // rejected\nconsole.log(\'ready\', \'Ada\') // failed Ada'),
		].join('\n')
		const result = await checkDocuments([{ path: 'docs/example.md', text }])
		expect(result.failures)
			.toEqual([
				expect.stringContaining('docs/example.md:9: sample "indirect" (run, marker at line 1) printed something other than its comment says: the comment claims "rejected" but the statement printed "pressed"'),
				expect.stringContaining('docs/example.md:10: sample "indirect" (run, marker at line 1) printed something other than its comment says: the comment claims "failed Ada" but the statement printed "ready Ada"'),
			])
	})
})
