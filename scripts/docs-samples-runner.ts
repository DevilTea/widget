import type { DocSample } from './docs-samples'
import type { OutputClaim, RecordedOutput } from './docs-samples-output'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { extractSamples } from './docs-samples'
import { compareOutput } from './docs-samples-output'
import { packageEntry, packageIds, workspaceRoot } from './release-package'

export { workspaceRoot }

const workspacePackages = packageIds.map(id => packageEntry(id))

export interface DocumentInput {
	/** Repository-relative path, used in messages. */
	path: string
	text: string
}

export interface DocumentReport {
	path: string
	counts: Record<DocSample['kind'], number>
	/** TypeScript fences that carry no marker. */
	unmarked: number
	/** The 1-based lines of those fences. */
	unmarkedLines: number[]
}

/** A comment that was compared with printed output. */
export interface ComparedComment extends OutputClaim {
	document: string
	sample: string
	/** The lines of the document that called `console` for the output the comment was matched with. */
	sources: number[]
}

export interface CheckResult {
	/** One message per problem; each names the document, the sample's marker name and a line of the document. */
	failures: string[]
	documents: DocumentReport[]
	/** Every comment that was compared with printed output. */
	compared: ComparedComment[]
	/** Exempt comments that did not match the output (see `DocumentCheckOptions.isExempt`). */
	exempted: Array<OutputClaim & { document: string, sample: string }>
}

export interface DocumentCheckOptions {
	root?: string
	/** Comments on a printing statement that are not expected output (existing remarks), by document, sample and text. */
	isExempt?: (document: string, sample: string, comment: string) => boolean
}

/** What a document is known to contain; see `documentGuardProblems`. */
export interface DocumentExpectation {
	/** At least this many `before` samples (never compiled, so only their presence guards them). */
	before: number
	/** At least this many `after` samples. */
	after: number
	/** At least this many `run` samples. */
	run: number
	/** Exactly this many TypeScript fences without a marker (a ratchet: lower it when you mark one). */
	unmarked: number
}

/**
 * Guards against vacuous success. A document listed in `expectations` must still hold its samples of each kind,
 * and must hold exactly the recorded number of unmarked TypeScript fences: more means a fence was added or a
 * marker was renamed, fewer means one was marked and the number has to come down, so it can only ever shrink. A
 * document that is not listed may not hold any unmarked TypeScript fence: every fence is either a marked sample or
 * `skip`, so a new document starts under the strictest rule.
 */
export function documentGuardProblems(reports: DocumentReport[], expectations: Record<string, DocumentExpectation>): string[] {
	const problems: string[] = []
	const byPath = new Map(reports.map(report => [report.path, report]))
	for (const [path, expected] of Object.entries(expectations)) {
		const report = byPath.get(path)
		if (report === undefined) {
			problems.push(`${path}: expected document is missing; update the expectations in scripts/docs-samples.unit.test.ts if it moved.`)
			continue
		}
		for (const kind of ['before', 'after', 'run'] as const) {
			if (report.counts[kind] < expected[kind])
				problems.push(`${path}: found ${report.counts[kind]} "${kind}" samples, expected at least ${expected[kind]}; a marker was renamed, malformed, changed to another kind or removed.`)
		}
	}
	for (const report of reports) {
		const recorded = expectations[report.path]?.unmarked ?? 0
		if (report.unmarked > recorded) {
			const where = report.unmarked <= 12 ? ` (at lines ${report.unmarkedLines.join(', ')})` : ''
			problems.push(`${report.path}: ${report.unmarked} TypeScript code fences have no \`<!-- sample: <name> <before|after|run|skip> -->\` marker, ${recorded} are recorded${where}. Mark the fence, mark it \`skip\` if it is deliberately not compiled, or fix the marker if one was renamed.`)
		}
		else if (report.unmarked < recorded) {
			problems.push(`${report.path}: only ${report.unmarked} TypeScript code fences have no marker, but ${recorded} are recorded; lower \`unmarked\` for this document in scripts/docs-samples.unit.test.ts to ${report.unmarked}.`)
		}
	}
	return problems
}

/**
 * The files a consumer resolves through `exports` must exist; a build that has not run is the usual reason they
 * do not. Returns a message, or `null` when every entry exists.
 */
export function missingBuildOutput(root = workspaceRoot): string | null {
	const missing: string[] = []
	for (const { directory } of workspacePackages) {
		const packageJson = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8')) as { exports?: Record<string, Record<string, string>> }
		for (const conditions of Object.values(packageJson.exports ?? {})) {
			for (const target of Object.values(conditions)) {
				if (typeof target === 'string' && !existsSync(join(root, directory, target)))
					missing.push(`${directory}/${target.replace(/^\.\//, '')}`)
			}
		}
	}
	if (missing.length === 0)
		return null
	return `The documentation samples resolve the workspace packages through their package.json \`exports\`, which point at a build that is missing: ${missing.join(', ')}. Run \`pnpm build\` first (\`pnpm check\` does).`
}

/** A directory that resolves the workspace packages the way an application that installed them would. */
function createConsumerDirectory(root: string): string {
	// The real path: Node and TypeScript report module locations after resolving symbolic links such as macOS's /var.
	const directory = realpathSync(mkdtempSync(join(tmpdir(), 'widget-docs-samples-')))
	const modules = join(directory, 'node_modules')
	mkdirSync(join(modules, '@deviltea'), { recursive: true })
	mkdirSync(join(modules, '@types'), { recursive: true })
	for (const { name, directory: packageDirectory } of workspacePackages)
		symlinkSync(join(root, packageDirectory), join(modules, name), 'dir')
	symlinkSync(join(root, 'packages/vue/node_modules/vue'), join(modules, 'vue'), 'dir')
	symlinkSync(join(root, 'node_modules/@types/node'), join(modules, '@types/node'), 'dir')
	mkdirSync(join(directory, 'samples'))
	return directory
}

interface Prepared {
	sample: DocSample
	file: string
}

function typecheck(directory: string, prepared: Prepared[]): Map<Prepared, Array<{ line: number, message: string }>> {
	const options: ts.CompilerOptions = {
		strict: true,
		noEmit: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		moduleDetection: ts.ModuleDetectionKind.Force,
		lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
		types: ['node'],
		typeRoots: [join(directory, 'node_modules/@types')],
		skipLibCheck: true,
	}
	const host = ts.createCompilerHost(options)
	const program = ts.createProgram({ rootNames: prepared.map(entry => entry.file), options, host })
	const byFile = new Map(prepared.map(entry => [entry.file, entry]))
	const found = new Map<Prepared, Array<{ line: number, message: string }>>()
	for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
		const message = `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
		const entry = diagnostic.file === undefined ? undefined : byFile.get(diagnostic.file.fileName)
		if (diagnostic.file === undefined || entry === undefined || diagnostic.start === undefined) {
			// Not inside a sample (a missing library, an unresolved type root): attribute it to the first sample.
			const first = prepared[0]!
			found.set(first, [...found.get(first) ?? [], { line: 0, message: `${message} (outside any sample: the consumer environment is broken)` }])
			continue
		}
		const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
		found.set(entry, [...found.get(entry) ?? [], { line, message }])
	}
	return found
}

interface RunOutcome {
	exitCode: number | null
	stderr: string
	timedOut: boolean
	outputs: RecordedOutput[]
}

function runSample(directory: string, prepared: Prepared, index: number): Promise<RunOutcome> {
	const record = join(directory, `record-${index}.jsonl`)
	writeFileSync(record, '')
	const preload = fileURLToPath(new URL('./docs-samples-preload.mjs', import.meta.url))
	return new Promise((resolve) => {
		execFile(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', preload, prepared.file], {
			cwd: directory,
			timeout: 60_000,
			env: { ...process.env, DOCS_SAMPLE_RECORD: record, DOCS_SAMPLE_FILE: prepared.file, NODE_OPTIONS: '' },
			maxBuffer: 16 * 1024 * 1024,
		}, (error, _stdout, stderr) => {
			const outputs = readFileSync(record, 'utf8')
				.split('\n')
				.filter(line => line !== '')
				.map((line) => {
					const parsed = JSON.parse(line) as { text: string, lines: number[] }
					return { text: parsed.text, lines: parsed.lines } satisfies RecordedOutput
				})
			const failure = error as (Error & { code?: number | string, killed?: boolean }) | null
			resolve({
				exitCode: failure === null ? 0 : typeof failure.code === 'number' ? failure.code : null,
				stderr,
				timedOut: failure?.killed === true,
				outputs,
			})
		})
	})
}

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results: R[] = Array.from({ length: items.length })
	let next = 0
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++
			results[index] = await work(items[index]!, index)
		}
	}))
	return results
}

/**
 * Extracts every marked sample of the documents, type-checks the `after` and `run` samples against the built
 * workspace packages, runs the `run` samples and compares their output with their comments.
 */
export async function checkDocuments(documents: DocumentInput[], options: DocumentCheckOptions = {}): Promise<CheckResult> {
	const { root = workspaceRoot, isExempt } = options
	const failures: string[] = []
	const reports: DocumentReport[] = []
	const compiled: DocSample[] = []
	for (const document of documents) {
		const extraction = extractSamples(document.path, document.text)
		failures.push(...extraction.problems)
		const counts = { before: 0, after: 0, run: 0, skip: 0 }
		for (const sample of extraction.samples) {
			counts[sample.kind]++
			if (sample.kind === 'after' || sample.kind === 'run')
				compiled.push(sample)
		}
		reports.push({ path: document.path, counts, unmarked: extraction.unmarkedScriptFences.length, unmarkedLines: extraction.unmarkedScriptFences.map(entry => entry.line) })
	}
	const result: CheckResult = { failures, documents: reports, compared: [], exempted: [] }
	if (compiled.length === 0)
		return result

	const missing = missingBuildOutput(root)
	if (missing !== null) {
		failures.push(missing)
		return result
	}

	const directory = createConsumerDirectory(root)
	try {
		const prepared = compiled.map((sample, index): Prepared => {
			const file = join(directory, 'samples', `${String(index)
				.padStart(3, '0')}-${sample.name}.mts`)
			writeFileSync(file, sample.code)
			return { sample, file }
		})
		const label = (sample: DocSample) => `sample "${sample.name}" (${sample.kind}, marker at line ${sample.markerLine})`
		const docLine = (sample: DocSample, line: number) => sample.codeLine + line - 1

		const diagnostics = typecheck(directory, prepared)
		for (const entry of prepared) {
			for (const { line, message } of diagnostics.get(entry) ?? [])
				failures.push(`${entry.sample.document}:${line === 0 ? entry.sample.markerLine : docLine(entry.sample, line)}: ${label(entry.sample)} does not type-check: ${message}`)
		}

		const runnable = prepared.filter(entry => entry.sample.kind === 'run' && (diagnostics.get(entry) ?? []).length === 0)
		const outcomes = await mapLimit(runnable, Math.max(2, availableParallelism()), (entry, index) => runSample(directory, entry, index))
		runnable.forEach((entry, index) => {
			const { sample } = entry
			const outcome = outcomes[index]!
			if (outcome.timedOut || outcome.exitCode !== 0) {
				const reason = outcome.timedOut ? 'did not finish within 60 seconds' : `exited with ${outcome.exitCode ?? 'a signal'}`
				const detail = outcome.stderr.trim()
					.split('\n')
					.slice(0, 12)
					.join('\n    ')
				failures.push(`${sample.document}:${sample.markerLine}: ${label(sample)} ${reason}:\n    ${detail}`)
				return
			}
			const comparison = compareOutput(sample.code, outcome.outputs, isExempt === undefined ? undefined : claim => isExempt(sample.document, sample.name, claim))
			for (const claim of comparison.compared)
				result.compared.push({ line: docLine(sample, claim.line), text: claim.text, document: sample.document, sample: sample.name, sources: claim.sources.map(line => docLine(sample, line)) })
			for (const failure of comparison.failures) {
				const claimLine = sample.code.split('\n')[failure.line - 1]!.trim()
				failures.push(`${sample.document}:${docLine(sample, failure.line)}: ${label(sample)} printed something other than its comment says: ${failure.message}\n    ${claimLine}`)
			}
			for (const claim of comparison.exempted)
				result.exempted.push({ line: docLine(sample, claim.line), text: claim.text, document: sample.document, sample: sample.name })
		})
	}
	finally {
		rmSync(directory, { recursive: true, force: true })
	}
	return result
}
