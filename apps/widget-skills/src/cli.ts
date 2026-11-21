/**
 * `widget-skills` command line.
 *
 *   tsx src/cli.ts --module <path> --export <name> [--tsconfig <path>] [--source-tsconfig <path>] --out <dir>
 *   tsx src/cli.ts --check --module <path> --export <name> [--tsconfig <path>] [--source-tsconfig <path>]
 *
 * Run it under a TypeScript loader (tsx): the System's module is imported to cross-check the names against
 * `system.catalog` and `inspectPlugin`. `--no-runtime` skips that import (and the cross-check).
 */

import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { checkIr, formatCheck } from './check'
import { extractIr } from './extract'
import { generateFiles } from './generate'
import { loadRuntimeFacts } from './runtime-facts'

async function main(): Promise<number> {
	const { values } = parseArgs({
		options: {
			'module': { type: 'string' },
			'export': { type: 'string' },
			'tsconfig': { type: 'string' },
			'source-tsconfig': { type: 'string' },
			'out': { type: 'string' },
			'check': { type: 'boolean', default: false },
			'no-runtime': { type: 'boolean', default: false },
			'root': { type: 'string' },
		},
	})
	if (values.module === undefined || values.export === undefined || (!values.check && values.out === undefined)) {
		process.stderr.write('Usage: widget-skills --module <path> --export <name> [--tsconfig <path>] [--source-tsconfig <path>] (--out <dir> | --check) [--no-runtime]\n')
		return 2
	}
	const modulePath = resolve(values.module)
	const runtime = values['no-runtime'] ? undefined : await loadRuntimeFacts(modulePath, values.export)
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
	const out = resolve(values.out!)
	const files = generateFiles(ir)
	for (const [path, content] of Object.entries(files)) {
		const target = join(out, path)
		mkdirSync(dirname(target), { recursive: true })
		writeFileSync(target, content)
	}
	const sizes = Object.entries(files)
		.map(([path, content]) => `${String(Buffer.byteLength(content))
			.padStart(7)}  ${path}`)
	process.stdout.write(`${sizes.join('\n')}\n${check.documented}/${check.members} members documented (${check.problems.filter(problem => problem.kind === 'missing-doc').length} without JSDoc).\n`)
	return 0
}

main()
	.then((code) => {
		process.exitCode = code
	}, (error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
		process.exitCode = 1
	})
