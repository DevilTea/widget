/**
 * `--check`: the documentation gate. Every problem is an error (the check fails):
 *
 * - `undocumented`: an `undocumented` marker in `plugin.docs` (`null`), with its plugin and docs path;
 * - `missing-doc`: a field or position the types declare and documented docs leave out (possible only for an untyped
 *   plugin, since Core's types require it), or a plugin without `plugin.docs`;
 * - `name-mismatch`: a name the types and the runtime disagree on (capabilities, slots, State, Properties, Events), or
 *   the types and `plugin.docs` disagree on (every section, Methods included, field names, the number of parameters or
 *   payload positions, and the name of the type docs a `ref` names);
 * - `docs-conflict`: a named type documented differently in two places (two type docs with one name, or two inline
 *   docs of the same type), so its one `$defs` entry cannot hold both;
 * - `no-docs`: the System was not imported (`--no-runtime`, `runtime: false`), so no prose was read at all.
 *
 * The prose is read from `plugin.docs` (`prose.ts`); JSDoc is not read.
 */

import type { SystemIr } from './ir'

export interface CheckProblem {
	kind: 'undocumented' | 'missing-doc' | 'name-mismatch' | 'docs-conflict' | 'no-docs'
	severity: 'error' | 'warning'
	/** For example `Survey: config.raw.fields.title`, or `Survey.slots` for a runtime name mismatch. */
	where: string
	message: string
}

export interface CheckResult {
	/** No error-severity problem. */
	ok: boolean
	problems: CheckProblem[]
	/** Descriptions in `plugin.docs`, and how many of them are prose rather than `undocumented`. */
	members: number
	documented: number
}

export function checkIr(ir: SystemIr): CheckResult {
	const problems: CheckProblem[] = []
	if (!ir.prose)
		problems.push({ kind: 'no-docs', severity: 'error', where: ir.system, message: `${ir.system} was not imported, so no plugin.docs was read: the documentation cannot be checked (run with the runtime).` })
	for (const issue of ir.docsIssues)
		problems.push({ kind: issue.kind, severity: 'error', where: issue.where, message: issue.message })
	for (const mismatch of ir.mismatches)
		problems.push({ kind: 'name-mismatch', severity: 'error', where: mismatch.split(':')[0]!, message: mismatch })
	return {
		ok: problems.every(problem => problem.severity !== 'error'),
		problems,
		members: ir.docsCount.descriptions,
		documented: ir.docsCount.documented,
	}
}

export function formatCheck(result: CheckResult): string {
	const lines = result.problems.map(problem => `${problem.severity === 'error' ? problem.kind : `warning (${problem.kind})`}: ${problem.message}`)
	const errors = result.problems.filter(problem => problem.severity === 'error').length
	lines.push(`${result.documented}/${result.members} descriptions documented, ${errors} error(s), ${result.problems.length - errors} warning(s).`)
	return lines.join('\n')
}
