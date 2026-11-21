/**
 * `--check`: the documentation gate. A problem is a member without JSDoc, a JSDoc tag outside the tag set
 * (`tsdoc.json`), or a name the types and the runtime disagree on.
 */

import type { Doc, Shape, SystemIr } from './ir'

export interface CheckProblem {
	kind: 'missing-doc' | 'unknown-tag' | 'name-mismatch'
	/** For example `Onboarding.state.current` or `type InterestOptionRaw.label`. */
	where: string
	message: string
}

export interface CheckResult {
	ok: boolean
	problems: CheckProblem[]
	/** Members looked at, and how many of them have a JSDoc summary. */
	members: number
	documented: number
}

export function checkIr(ir: SystemIr): CheckResult {
	const problems: CheckProblem[] = []
	let members = 0
	let documented = 0

	const visit = (where: string, doc: Doc): void => {
		members++
		if (doc.summary === '')
			problems.push({ kind: 'missing-doc', where, message: `${where} has no JSDoc.` })
		else
			documented++
		for (const tag of doc.unknownTags)
			problems.push({ kind: 'unknown-tag', where, message: `${where} uses the unknown tag @${tag}.` })
	}
	const visitShape = (where: string, shape: Shape): void => {
		if (shape.kind === 'object') {
			for (const property of shape.properties) {
				visit(`${where}.${property.name}`, property.doc)
				visitShape(`${where}.${property.name}`, property.shape)
			}
		}
		else if (shape.kind === 'array') {
			visitShape(`${where}[]`, shape.items)
		}
		else if (shape.kind === 'record') {
			visitShape(`${where}{}`, shape.value)
		}
		else if (shape.kind === 'union') {
			shape.members.forEach(member => visitShape(where, member))
		}
	}

	for (const plugin of ir.plugins) {
		visit(plugin.type, plugin.doc)
		// A named config type is checked once, under its own name, below.
		if (plugin.config !== null)
			visitShape(`${plugin.type}.config.raw`, plugin.config.rawShape)
		for (const slot of plugin.slots)
			visit(`${plugin.type}.slots.${slot.name}`, slot.doc)
		for (const member of plugin.state)
			visit(`${plugin.type}.state.${member.name}`, member.doc)
		for (const member of plugin.properties)
			visit(`${plugin.type}.properties.${member.name}`, member.doc)
		for (const member of plugin.methods)
			visit(`${plugin.type}.methods.${member.name}`, member.doc)
		for (const member of plugin.events)
			visit(`${plugin.type}.events.${member.name}`, member.doc)
		for (const member of plugin.reasons ?? [])
			visit(`${plugin.type}.reasons.${member.name}`, member.doc)
	}
	for (const [name, type] of Object.entries(ir.types)) {
		visit(`type ${name}`, type.doc)
		visitShape(`type ${name}`, type.shape)
	}
	for (const mismatch of ir.mismatches)
		problems.push({ kind: 'name-mismatch', where: mismatch.split(':')[0]!, message: mismatch })

	return { ok: problems.length === 0, problems, members, documented }
}

export function formatCheck(result: CheckResult): string {
	const lines = result.problems.map(problem => `${problem.kind}: ${problem.message}`)
	lines.push(`${result.documented}/${result.members} members documented, ${result.problems.length} problem(s).`)
	return lines.join('\n')
}
