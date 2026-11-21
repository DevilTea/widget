/**
 * `--check`: the documentation gate.
 *
 * Errors (the check fails):
 * - `missing-doc` on a plugin, an Interfaces member (slot, State, Property, Method, Method parameter, Event,
 *   reason), a field of an inline object type one of them uses, or a field reachable from `config.raw`;
 * - `unknown-tag`: a JSDoc tag outside the tag set (`tsdoc.json`);
 * - `name-mismatch`: a name the types and the runtime disagree on.
 *
 * Warnings (reported, never failing): `missing-doc` on a named type that is only reachable from a resolved config,
 * a State or Property value, a Method signature or an Event payload. Those are read by renderer authors, not
 * written by document authors.
 *
 * Until 0.3.0 the runtime still carries descriptions, so a plugin, an Event and a slot of the string-union form
 * (which has no place for JSDoc) count as documented when the runtime description is non-empty.
 */

import type { Doc, Shape, SystemIr } from './ir'

export interface CheckProblem {
	kind: 'missing-doc' | 'unknown-tag' | 'name-mismatch'
	severity: 'error' | 'warning'
	/** For example `Onboarding.state.current` or `type InterestOptionRaw.label`. */
	where: string
	message: string
}

export interface CheckResult {
	/** No error-severity problem. */
	ok: boolean
	problems: CheckProblem[]
	/** Members looked at, and how many of them are documented. */
	members: number
	documented: number
}

type Severity = CheckProblem['severity']

export function checkIr(ir: SystemIr): CheckResult {
	const problems: CheckProblem[] = []
	const seen = new Set<string>()
	let members = 0
	let documented = 0

	const visit = (where: string, doc: Doc, severity: Severity, fallback: string | null = null): void => {
		// A union lists the same field once per member that declares it.
		if (seen.has(where))
			return
		seen.add(where)
		members++
		if (doc.summary === '' && (fallback === null || fallback.trim() === ''))
			problems.push({ kind: 'missing-doc', severity, where, message: `${where} has no JSDoc.` })
		else
			documented++
		for (const tag of doc.unknownTags)
			problems.push({ kind: 'unknown-tag', severity: 'error', where, message: `${where} uses the unknown tag @${tag}.` })
	}
	/** Visits the fields of the inline object types in `shape`. A named type is checked once, under its own name. */
	const visitShape = (where: string, shape: Shape, severity: Severity): void => {
		if (shape.kind === 'object') {
			for (const property of shape.properties) {
				visit(`${where}.${property.name}`, property.doc, severity)
				visitShape(`${where}.${property.name}`, property.shape, severity)
			}
		}
		else if (shape.kind === 'array') {
			visitShape(`${where}[]`, shape.items, severity)
		}
		else if (shape.kind === 'record') {
			visitShape(`${where}{}`, shape.value, severity)
		}
		else if (shape.kind === 'union') {
			shape.members.forEach(member => visitShape(where, member, severity))
		}
	}

	const authored = new Set<string>()
	const reach = (shape: Shape): void => {
		if (shape.kind === 'ref') {
			if (authored.has(shape.name) || ir.types[shape.name] === undefined)
				return
			authored.add(shape.name)
			reach(ir.types[shape.name]!.shape)
		}
		else if (shape.kind === 'array') {
			reach(shape.items)
		}
		else if (shape.kind === 'record') {
			reach(shape.value)
		}
		else if (shape.kind === 'union') {
			shape.members.forEach(reach)
		}
		else if (shape.kind === 'object') {
			shape.properties.forEach(property => reach(property.shape))
		}
	}

	for (const plugin of ir.plugins) {
		visit(plugin.type, plugin.doc, 'error', plugin.runtimeDescription)
		if (plugin.config !== null) {
			reach(plugin.config.rawShape)
			visitShape(`${plugin.type}.config.raw`, plugin.config.rawShape, 'error')
		}
		for (const slot of plugin.slots)
			visit(`${plugin.type}.slots.${slot.name}`, slot.doc, 'error', plugin.slotForm === 'union' ? slot.runtimeDescription : null)
		for (const member of plugin.state) {
			visit(`${plugin.type}.state.${member.name}`, member.doc, 'error')
			visitShape(`${plugin.type}.state.${member.name}`, member.shape, 'error')
		}
		for (const member of plugin.properties) {
			visit(`${plugin.type}.properties.${member.name}`, member.doc, 'error')
			visitShape(`${plugin.type}.properties.${member.name}`, member.shape, 'error')
		}
		for (const method of plugin.methods) {
			const where = `${plugin.type}.methods.${method.name}`
			visit(where, method.doc, 'error')
			for (const param of method.params) {
				members++
				if (param.doc === '')
					problems.push({ kind: 'missing-doc', severity: 'error', where: `${where}(${param.name})`, message: `${where} has no @param for "${param.name}".` })
				else
					documented++
				visitShape(`${where}(${param.name})`, param.shape, 'error')
			}
			visitShape(`${where}()`, method.returnShape, 'error')
		}
		for (const event of plugin.events) {
			visit(`${plugin.type}.events.${event.name}`, event.doc, 'error', event.runtimeDescription)
			event.payload.forEach((item, index) => visitShape(`${plugin.type}.events.${event.name}[${item.label ?? index}]`, item.shape, 'error'))
		}
		for (const reason of plugin.reasons ?? []) {
			visit(`${plugin.type}.reasons.${reason.name}`, reason.doc, 'error')
			visitShape(`${plugin.type}.reasons.${reason.name}`, reason.shape, 'error')
		}
	}
	for (const [name, type] of Object.entries(ir.types)) {
		const severity: Severity = authored.has(name) ? 'error' : 'warning'
		visit(`type ${name}`, type.doc, severity)
		visitShape(`type ${name}`, type.shape, severity)
	}
	for (const mismatch of ir.mismatches)
		problems.push({ kind: 'name-mismatch', severity: 'error', where: mismatch.split(':')[0]!, message: mismatch })

	return { ok: problems.every(problem => problem.severity !== 'error'), problems, members, documented }
}

export function formatCheck(result: CheckResult): string {
	const lines = result.problems.map(problem => `${problem.severity === 'error' ? problem.kind : `warning (${problem.kind})`}: ${problem.message}`)
	const errors = result.problems.filter(problem => problem.severity === 'error').length
	lines.push(`${result.documented}/${result.members} members documented, ${errors} error(s), ${result.problems.length - errors} warning(s).`)
	return lines.join('\n')
}
