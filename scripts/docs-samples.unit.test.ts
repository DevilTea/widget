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
 * What the documents are known to contain. `before` and `compiled` are minimums (a sample added later is picked
 * up and checked without editing this list; only a removal is caught); `unmarked` is a ceiling on TypeScript
 * fences that carry no marker. A document that is not listed may have no unmarked TypeScript fence at all.
 *
 * Why not "every fence is marked" everywhere: `docs/site/packages/widget-core.md` and the other pages listed
 * below were written with illustrative fragments between their runnable samples, and marking them would edit
 * their prose. They are held at today's count instead (lower the number when you mark one; the check never
 * lets it grow). The migration guide is already complete, so it is held at zero.
 */
const expectations: Record<string, DocumentExpectation> = {
	// 17 samples written against the published 0.0.6 and 19 against the workspace packages.
	'docs/site/migration/0.1.md': { before: 17, compiled: 19, unmarked: 0 },
	'docs/site/packages/widget-core.md': { before: 0, compiled: 25, unmarked: 28 },
	'packages/core/README.md': { before: 0, compiled: 3, unmarked: 3 },
	// No marked sample yet: these pages hold unmarked fragments only (see the pull request that added this check).
	'docs/site/packages/widget-vue.md': { before: 0, compiled: 0, unmarked: 11 },
	'docs/site/packages/widget-inspector.md': { before: 0, compiled: 0, unmarked: 2 },
	'packages/vue/README.md': { before: 0, compiled: 0, unmarked: 2 },
	'packages/inspector/README.md': { before: 0, compiled: 0, unmarked: 5 },
	'docs/architecture/widget-api-conventions.md': { before: 0, compiled: 0, unmarked: 2 },
}

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

	it('finds the samples of the repository documents through discovery rather than a list', () => {
		const documents = discoverDocuments(workspaceRoot)
		expect(documents)
			.toEqual(expect.arrayContaining(['docs/site/migration/0.1.md', 'docs/site/packages/widget-core.md', 'packages/core/README.md']))
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
		['valid', 'invalid', false],
		['10', '1', false],
		['{ ok: true, value: ... }', 'total -> { ok: true, value: 2 }', true],
		['{ ok: true, value: ... }', '{ ok: false }', false],
		['\'Badge configuration\'', 'Badge configuration', true],
		['[ \'a\', \'b\' ]', '[\n  \'a\',\n  \'b\'\n]', true],
	])('claim %j against output %j: %s', (claim, output, expected) => {
		expect(claimMatches(claim, output))
			.toBe(expected)
	})

	const code = [
		'console.log(1 + 1) // 2',
		'console.log(\'a\', { ok: true }) // { ok: true }',
		'console.log(\'x\')',
		'// x',
		'for (const value of [1, 2])',
		'\tconsole.log(value)',
		'// 1',
		'// 2',
		'console.log(5) // 6: the sum',
		'notify() // changed 7',
		'notify() // a return value, never printed',
		'console.log(\'schema\') // the schema above',
	].join('\n')
	const print = (text: string, ...lines: number[]) => ({ text, lines })

	it('accepts claims that agree with the output and lists what it cannot compare', () => {
		const comparison = compareOutput(code, [
			print('2', 1),
			print('a { ok: true }', 2),
			print('x', 3),
			print('1', 6),
			print('2', 6),
			print('5', 9),
		])
		expect(comparison.failures.map(failure => failure.line))
			.toEqual([9])
		expect(comparison.failures[0]!.message)
			.toContain('claims "6: the sum" but the statement printed "5"')
		expect(comparison.uncompared.map(claim => claim.line))
			.toEqual([10, 11, 12])
	})

	it('fails a claim whose statement printed nothing, and a block with the wrong number of lines', () => {
		const comparison = compareOutput('if (false)\n\tconsole.log(1) // 1\nconsole.log(2)\n// 2\n// 3', [print('2', 3)])
		expect(comparison.failures.map(failure => failure.line))
			.toEqual([2, 5])
	})

	it('compares an indirect claim only when it quotes the output', () => {
		const comparison = compareOutput('notify() // pressed\nnotify() // pressd', [print('pressed', 5, 1), print('pressed', 5, 2)])
		expect(comparison.failures.map(failure => failure.line))
			.toEqual([])
		expect(comparison.compared)
			.toBe(1)
		const wrong = compareOutput('notify() // pressed twice', [print('pressed', 5, 1)])
		expect(wrong.failures.map(failure => failure.line))
			.toEqual([])
		const changed = compareOutput('notify() // pressed', [print('released', 5, 1)])
		expect(changed.failures)
			.toEqual([])
		const quoted = compareOutput('notify() // loaded Bob', [print('loaded Ada', 5, 1)])
		expect(quoted.failures.map(failure => failure.line))
			.toEqual([1])
	})
})

describe('document guards', () => {
	const report = (path: string, counts: Partial<Record<'before' | 'after' | 'run' | 'skip', number>>, unmarked = 0) => ({ path, counts: { before: 0, after: 0, run: 0, skip: 0, ...counts }, unmarked, unmarkedLines: Array.from({ length: unmarked }, (_, index) => index + 1) })

	it('names a document that lost samples or gained an unmarked fence', () => {
		const problems = documentGuardProblems(
			[report('a.md', { before: 1, after: 1 }, 1), report('b.md', {}, 1)],
			{ 'a.md': { before: 2, compiled: 2, unmarked: 0 }, 'gone.md': { before: 0, compiled: 0, unmarked: 0 } },
		)
		expect(problems)
			.toEqual([
				expect.stringContaining('a.md: found 1 "before" samples, expected at least 2'),
				expect.stringContaining('a.md: found 1 "after"/"run" samples, expected at least 2'),
				expect.stringContaining('gone.md: expected document is missing'),
				expect.stringContaining('a.md: 1 TypeScript code fences have no'),
				expect.stringContaining('b.md: 1 TypeScript code fences have no'),
			])
	})

	it('accepts a document that kept everything and gained a sample', () => {
		expect(documentGuardProblems([report('a.md', { before: 3, run: 4 }, 2)], { 'a.md': { before: 2, compiled: 2, unmarked: 2 } }))
			.toEqual([])
	})
})

describe('build output', () => {
	it('names the missing files and the command to run when the packages are not built', () => {
		const root = mkdtempSync(join(tmpdir(), 'widget-docs-samples-root-'))
		try {
			for (const directory of ['packages/core', 'packages/vue', 'packages/inspector']) {
				mkdirSync(join(root, directory), { recursive: true })
				writeFileSync(join(root, directory, 'package.json'), JSON.stringify({ exports: { '.': { types: './dist/index.d.mts', import: './dist/index.mjs' } } }))
			}
			const message = missingBuildOutput(root)
			expect(message)
				.toContain('packages/core/dist/index.mjs')
			expect(message)
				.toContain('packages/inspector/dist/index.d.mts')
			expect(message)
				.toContain('pnpm build')
		}
		finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it('finds every file the workspace packages export once they are built', () => {
		expect(missingBuildOutput())
			.toBeNull()
	})
})

describe('documentation samples', () => {
	// Type-checking resolves the built packages and each runnable sample is a child process.
	const timeout = 180_000

	it('every marked sample is well-formed, type-checks against the built packages, and prints what its comments say', { timeout }, async () => {
		const documents = discoverDocuments(workspaceRoot)
			.map(path => ({ path, text: readDocument(workspaceRoot, path) }))
		const result = await checkDocuments(documents)
		// One message with every problem, so a renamed marker is reported next to the other failures.
		expect([...result.failures, ...documentGuardProblems(result.documents, expectations)]
			.join('\n'))
			.toBe('')
		// The samples state their output in comments; they were compared, not skipped.
		expect(result.comparedClaims)
			.toBeGreaterThan(50)
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
})
