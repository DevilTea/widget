#!/usr/bin/env node
/**
 * `widget-docs-generator` command line (the package's bin, `dist/cli.mjs`).
 *
 *   widget-docs-generator --module <path> --export <name> [--tsconfig <path>] [--source-tsconfig <path>] [--example <json>] --out <dir>
 *   widget-docs-generator --check --module <path> --export <name> [--tsconfig <path>] [--source-tsconfig <path>]
 *
 * It needs no TypeScript loader. Unless `--no-runtime` is given, the System's module is **imported and therefore
 * executed**, with everything it imports, through tsx in a worker thread (as the Vite plugin does), to read
 * `plugin.docs`, to cross-check the names against `system.catalog` and `inspectPlugin` and to compile the `--example`
 * document. tsx gets the tsconfig the type checker uses, with the `paths` of `--source-tsconfig` on top. Only point it
 * at a module you would run.
 */

import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { checkIr, formatCheck } from './check'
import { absolutePaths } from './docs-cache'
import { extractIr, readProgramConfig } from './extract'
import { generateFiles, MANIFEST_FILE } from './generate'
import { importAndCompile, importRuntimeFacts } from './runtime-facts'
import { emitFullSchema } from './schema'
import { validateSchema } from './validate'

/** Removes the files the previous run wrote into `out` and this run does not, by the previous run's manifest. */
function removeStaleFiles(out: string, written: readonly string[]): string[] {
	const manifestPath = join(out, MANIFEST_FILE)
	if (!existsSync(manifestPath))
		return []
	let previous: unknown
	try {
		previous = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { files?: unknown }).files
	}
	catch {
		return []
	}
	if (!Array.isArray(previous))
		return []
	const removed: string[] = []
	for (const path of previous) {
		// The manifest is a file on disk: never follow an entry out of the output directory.
		if (typeof path !== 'string' || written.includes(path) || !resolve(out, path)
			.startsWith(out + sep)) {
			continue
		}
		rmSync(resolve(out, path), { force: true })
		removed.push(path)
	}
	return removed
}

async function main(): Promise<number> {
	const { values } = parseArgs({
		options: {
			'module': { type: 'string' },
			'export': { type: 'string' },
			'tsconfig': { type: 'string' },
			'source-tsconfig': { type: 'string' },
			'out': { type: 'string' },
			'example': { type: 'string' },
			'check': { type: 'boolean', default: false },
			'no-runtime': { type: 'boolean', default: false },
			'root': { type: 'string' },
		},
	})
	if (values.module === undefined || values.export === undefined || (!values.check && values.out === undefined)) {
		process.stderr.write('Usage: widget-docs-generator --module <path> --export <name> [--tsconfig <path>] [--source-tsconfig <path>] [--root <dir>] [--example <json>] (--out <dir> | --check) [--no-runtime]\n')
		return 2
	}
	const modulePath = resolve(values.module)
	// tsx imports the module as the type checker reads it: its tsconfig, with the source tsconfig's `paths` on top.
	const config = readProgramConfig({ modulePath, tsconfigPath: values.tsconfig, sourceTsconfigPath: values['source-tsconfig'] })
	const importOptions = {
		...(config.tsconfigPath === undefined ? {} : { tsconfig: config.tsconfigPath }),
		...(values['source-tsconfig'] === undefined ? {} : { paths: absolutePaths(config.compilerOptions) }),
	}
	const runtime = values['no-runtime'] ? undefined : await importRuntimeFacts(modulePath, values.export, importOptions)
	const ir = extractIr({
		modulePath,
		exportName: values.export,
		tsconfigPath: values.tsconfig,
		sourceTsconfigPath: values['source-tsconfig'],
		runtime,
		cwd: values.root === undefined ? process.cwd() : resolve(values.root),
	})
	const check = checkIr(ir)
	if (values.check) {
		process.stdout.write(`${formatCheck(check)}\n`)
		return check.ok ? 0 : 1
	}
	if (ir.mismatches.length > 0) {
		process.stderr.write(`The types and the runtime disagree:\n${ir.mismatches.map(line => `- ${line}`)
			.join('\n')}\n`)
		return 1
	}

	let example: unknown
	if (values.example !== undefined) {
		example = JSON.parse(readFileSync(resolve(values.example), 'utf8'))
		if (values['no-runtime']) {
			process.stderr.write('--example needs the runtime: the example is only published after it compiles.\n')
			return 2
		}
		const outcome = await importAndCompile(modulePath, values.export, example, importOptions)
		const schemaErrors = validateSchema(emitFullSchema(ir), example)
		if (outcome.status !== 'valid' || schemaErrors.length > 0) {
			process.stderr.write(`The example ${values.example} is not a valid document:\n${[...outcome.diagnostics.map(diagnostic => `- ${diagnostic.code}: ${diagnostic.message}`), ...schemaErrors.map(error => `- schema: ${error}`)].join('\n')}\n`)
			return 1
		}
	}

	const out = resolve(values.out!)
	const files = generateFiles(ir, { example })
	const removed = removeStaleFiles(out, Object.keys(files))
	for (const [path, content] of Object.entries(files)) {
		const target = join(out, path)
		mkdirSync(dirname(target), { recursive: true })
		writeFileSync(target, content)
	}
	const sizes = Object.entries(files)
		.map(([path, content]) => `${String(Buffer.byteLength(content))
			.padStart(7)}  ${path}`)
	const errors = check.problems.filter(problem => problem.severity === 'error').length
	process.stdout.write(`${sizes.join('\n')}\n${removed.map(path => `removed stale ${path}\n`)
		.join('')}${check.documented}/${check.members} descriptions documented; --check would report ${errors} error(s) and ${check.problems.length - errors} warning(s).\n`)
	return 0
}

main()
	.then((code) => {
		process.exitCode = code
	}, (error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
		process.exitCode = 1
	})
