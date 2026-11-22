/**
 * The Author "Problems" list: the last Apply's failures as plain rows, each with a source range for jumping
 * and for editor markers.
 *
 * A row is either the Lab-only JSON `SyntaxError` of the last Apply (`SourceParseError`) or one Core Blueprint
 * diagnostic of the committed Document. Core's `code` and `message` pass through verbatim; the only thing
 * derived here is *where* the diagnostic points in the source text. Core locates a diagnostic through a
 * Blueprint node (and a member name or a node-relative `path`), and `blueprint.getSourcePath(node)` is the
 * node's absolute source path, so the range is `getSourcePath(node)` plus the diagnostic's own relative
 * part, resolved against the JSON text by `json-locate.ts`. A diagnostic with no resolvable range falls back
 * to the nearest existing ancestor in the text.
 */

import type { BlueprintDiagnostic, BlueprintDiagnosticLocation, WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { BlueprintInspection, InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { JsonPath, JsonPathSegment, JsonSpan } from './json-locate'
import type { SourceParseError } from './types'
import { endOfLine, jsonSyntaxErrorSpan, locateJsonMember, locateJsonPath } from './json-locate'

export interface LabProblem {
	/** Stable within one list: the position in `collectProblems()`'s result. */
	readonly key: string
	readonly kind: 'syntax' | 'diagnostic'
	/** Core's diagnostic code, verbatim; `null` for a JSON syntax error (Lab-owned, no Core code). */
	readonly code: string | null
	/** Core's (or the JavaScript engine's) message, verbatim. */
	readonly message: string
	/** Core's own location, rendered as `widget "id : type" · property "name"`; `null` for source/syntax problems. */
	readonly locationLabel: string | null
	/** The Document inspection node the diagnostic belongs to, so the Problems list can also focus it. */
	readonly nodeId: InspectionNodeId | null
	/** Absolute source path the diagnostic points at; `null` for a syntax error. */
	readonly sourcePath: JsonPath | null
	/**
	 * Where the problem is inside its widget's `config`, relative to the config (`[]` for the config itself), when its source
	 * path runs through `<node>.config`; else `null` (a syntax error, a source-level diagnostic, a widget-level one such as a
	 * dependency or structure diagnostic, which Core locates at the widget or a member, not at a field). Structure shows a
	 * problem with a `configPath` at that field, and one with only a `nodeId` at the widget's header (Lab UX phase 2).
	 */
	readonly configPath: JsonPath | null
	/** `true` when the range should prefer the widget's `id`/`type` member over its whole object. */
	readonly widgetLevel: boolean
	/** Syntax problems only: the text that failed to parse, so the offset in the message maps onto it. */
	readonly syntaxSourceText: string | null
	/**
	 * Only for a `property-evaluation-cycle` diagnostic: which cycle it belongs to. Core shares one `related` list
	 * between every diagnostic of a cycle, so the list's identity names the cycle; `members` is that list as
	 * `id.member` labels, in Core's member order. Presentation only: the row's own code and message stay Core's.
	 */
	readonly cycle: LabProblemCycle | null
}

export interface LabProblemCycle {
	/** Stable within one list: the position of the cycle's first diagnostic. */
	readonly id: string
	/** Every member of the cycle (properties and methods), `widgetId.memberName`, in Core's order. */
	readonly members: readonly string[]
}

/** One entry of the Problems list: a single problem, or several diagnostics of the same evaluation cycle shown as one. */
export type LabProblemEntry
	= | { readonly kind: 'problem', readonly key: string, readonly problem: LabProblem }
		| { readonly kind: 'cycle', readonly key: string, readonly members: readonly string[], readonly problems: readonly LabProblem[] }

function jsonSegments(path: readonly PropertyKey[] | undefined): JsonPathSegment[] {
	return path === undefined ? [] : path.filter((segment): segment is JsonPathSegment => typeof segment !== 'symbol')
}

function describeLocation(location: BlueprintDiagnosticLocation, inspection: BlueprintInspection): string | null {
	if (location.type === 'source')
		return null
	const nodeId = inspection.getNodeId(location.node)
	const node = nodeId === null ? null : inspection.getNode(nodeId)
	const widget = node === null
		? 'unresolved node'
		: node.resolved
			? `${node.node.id} : ${node.node.type}`
			: `${node.id ?? '?'} : ${node.type ?? '?'} (unresolved)`
	const base = `widget "${widget}"`
	switch (location.type) {
		case 'widget': return base
		case 'slot': return `${base} · slot "${location.slot}"`
		case 'slot-child': return `${base} · slot "${location.slot}"[${location.index}]`
		case 'property': return `${base} · property "${location.name}"`
		case 'method': return `${base} · method "${location.name}"`
	}
}

/** Absolute source path of what a diagnostic is about, or `null` when Core has no source path for its node. */
export function diagnosticSourcePath(blueprint: WidgetSystemBlueprint, diagnostic: BlueprintDiagnostic): JsonPath | null {
	const location = diagnostic.location
	const relative = jsonSegments('path' in diagnostic ? diagnostic.path : undefined)
	if (location.type === 'source')
		return relative
	const nodePath = blueprint.getSourcePath(location.node)
	if (nodePath === null)
		return null
	if (diagnostic.code === 'invalid-widget-config')
		return [...nodePath, 'config', ...relative]
	if ('path' in diagnostic && diagnostic.path !== undefined)
		return [...nodePath, ...relative]
	switch (location.type) {
		case 'slot': return [...nodePath, 'slots', location.slot]
		case 'slot-child': return [...nodePath, 'slots', location.slot, location.index]
		default: return nodePath
	}
}

/** The part of `sourcePath` inside the node's `config` (`[]` for the config itself), or `null` when it does not run through it. */
function configRelativePath(sourcePath: JsonPath | null, nodePath: JsonPath | null): JsonPath | null {
	if (sourcePath === null || nodePath === null || sourcePath.length <= nodePath.length || sourcePath[nodePath.length] !== 'config')
		return null
	if (nodePath.some((segment, index) => sourcePath[index] !== segment))
		return null
	return sourcePath.slice(nodePath.length + 1)
}

/** `true` when the diagnostic is about a widget as a whole (or one of its members), not about a field inside it. */
function isWidgetLevel(diagnostic: BlueprintDiagnostic): boolean {
	const location = diagnostic.location
	if (location.type === 'source')
		return false
	if ('path' in diagnostic && diagnostic.path !== undefined)
		return false
	return location.type !== 'slot'
}

export function collectProblems(
	blueprint: WidgetSystemBlueprint,
	inspection: BlueprintInspection,
	parseError: SourceParseError | null,
): readonly LabProblem[] {
	const problems: LabProblem[] = []
	if (parseError !== null) {
		problems.push({
			key: 'syntax',
			kind: 'syntax',
			code: null,
			message: parseError.message,
			locationLabel: null,
			nodeId: null,
			sourcePath: null,
			configPath: null,
			widgetLevel: false,
			syntaxSourceText: parseError.sourceText,
			cycle: null,
		})
	}
	// Core shares one `related` list between the diagnostics of a cycle; its identity is the cycle's identity.
	const cycles = new Map<object, LabProblemCycle>()
	blueprint.diagnostics.forEach((diagnostic, index) => {
		const location = diagnostic.location
		let cycle: LabProblemCycle | null = null
		if (diagnostic.code === 'property-evaluation-cycle') {
			cycle = cycles.get(diagnostic.related) ?? null
			if (cycle === null) {
				cycle = { id: `cycle-${index}`, members: diagnostic.related.map(related => cycleMemberLabel(related, inspection)) }
				cycles.set(diagnostic.related, cycle)
			}
		}
		const sourcePath = diagnosticSourcePath(blueprint, diagnostic)
		problems.push({
			key: `diagnostic-${index}`,
			kind: 'diagnostic',
			code: diagnostic.code,
			message: diagnostic.message,
			locationLabel: describeLocation(location, inspection),
			nodeId: location.type === 'source' ? null : inspection.getNodeId(location.node),
			sourcePath,
			configPath: location.type === 'source' ? null : configRelativePath(sourcePath, blueprint.getSourcePath(location.node)),
			widgetLevel: isWidgetLevel(diagnostic),
			syntaxSourceText: null,
			cycle,
		})
	})
	return problems
}

function cycleMemberLabel(location: BlueprintDiagnosticLocation, inspection: BlueprintInspection): string {
	const nodeId = location.type === 'source' ? null : inspection.getNodeId(location.node)
	const node = nodeId === null ? null : inspection.getNode(nodeId)
	const widget = node === null ? '?' : node.resolved ? node.node.id : (node.id ?? '?')
	return location.type === 'property' || location.type === 'method' ? `${widget}.${location.name}` : widget
}

/**
 * Where the Structure view shows each problem while `selectedNodeId` is selected (Lab UX phase 2, report item 12). One
 * source for both Author views: the same `LabStore.problems` the JSON view lists, split by location only.
 * - `atFields`: the selected widget's problems inside its config (`configPath`); each config field claims its own
 *   (`claimsFieldProblem()`).
 * - `atNode`: the selected widget's other problems (a dependency, a structure check, a member), shown at its header.
 * - `elsewhere`: problems of other widgets (a row selects that widget) and problems with no widget (a JSON syntax error,
 *   a source-level diagnostic), in a compact list.
 * Order is Core's (a syntax error first) in each group.
 */
export interface StructureProblemPlacement {
	readonly atFields: readonly LabProblem[]
	readonly atNode: readonly LabProblem[]
	readonly elsewhere: readonly LabProblem[]
}

export function placeStructureProblems(problems: readonly LabProblem[], selectedNodeId: InspectionNodeId | null): StructureProblemPlacement {
	const atFields: LabProblem[] = []
	const atNode: LabProblem[] = []
	const elsewhere: LabProblem[] = []
	for (const problem of problems) {
		if (selectedNodeId === null || problem.nodeId !== selectedNodeId)
			elsewhere.push(problem)
		else if (problem.configPath !== null)
			atFields.push(problem)
		else
			atNode.push(problem)
	}
	return { atFields, atNode, elsewhere }
}

/**
 * Whether the config field at `path` shows `problem`: the problem's `configPath` is that field, or lies under it and no
 * field below shows it — `childKeys` are the keys (or indices) of the fields rendered under this one, `null` for a leaf (a
 * switch, a list, a text, number or JSON box). So a problem inside a value edited as JSON shows at that box, and one about
 * a key that is not there (a required key that is missing) shows at its object.
 */
export function claimsFieldProblem(path: readonly JsonPathSegment[], childKeys: readonly JsonPathSegment[] | null, problem: LabProblem): boolean {
	const target = problem.configPath
	if (target === null || target.length < path.length)
		return false
	if (path.some((segment, index) => String(target[index]) !== String(segment)))
		return false
	if (target.length === path.length || childKeys === null)
		return true
	const next = String(target[path.length])
	return !childKeys.some(key => String(key) === next)
}

/**
 * The rows the Problems list shows: every problem as it is, except that the diagnostics of one evaluation cycle
 * (two or more) become a single `cycle` entry that lists its members. The diagnostics themselves are untouched and
 * the list still counts them one by one; only the presentation is grouped. Order follows the first member of each
 * group.
 */
export function groupProblems(problems: readonly LabProblem[]): readonly LabProblemEntry[] {
	const sizes = new Map<string, number>()
	for (const problem of problems) {
		if (problem.cycle !== null)
			sizes.set(problem.cycle.id, (sizes.get(problem.cycle.id) ?? 0) + 1)
	}
	const entries: LabProblemEntry[] = []
	const groups = new Map<string, LabProblem[]>()
	for (const problem of problems) {
		const cycle = problem.cycle
		if (cycle === null || (sizes.get(cycle.id) ?? 0) < 2) {
			entries.push({ kind: 'problem', key: problem.key, problem })
			continue
		}
		let members = groups.get(cycle.id)
		if (members === undefined) {
			members = []
			groups.set(cycle.id, members)
			entries.push({ kind: 'cycle', key: cycle.id, members: cycle.members, problems: members })
		}
		members.push(problem)
	}
	return entries
}

/**
 * The text range a problem points at inside `text` (the current editor text), or `null` when the text does
 * not parse (nothing can be located). A single primitive value is highlighted whole; a widget gets its
 * `"id"` (else `"type"`) member; any other object or array gets its property key, or, for an array item or
 * the root, the line it opens on, so a squiggle never spans a whole subtree. Path segments that no longer
 * exist in `text` resolve to the nearest existing ancestor.
 */
export function problemSpan(problem: LabProblem, text: string): JsonSpan | null {
	if (problem.kind === 'syntax')
		return jsonSyntaxErrorSpan(problem.message, problem.syntaxSourceText ?? text)
	const path = problem.sourcePath ?? []
	const location = locateJsonPath(text, path)
	if (location === null)
		return null
	if (location.kind === 'primitive')
		return location.value
	if (problem.widgetLevel && location.exact) {
		const member = locateJsonMember(text, location.resolvedPath, 'id') ?? locateJsonMember(text, location.resolvedPath, 'type')
		if (member !== null)
			return member
	}
	if (location.key !== null)
		return location.key
	return { start: location.value.start, end: Math.max(location.value.start + 1, endOfLine(text, location.value.start)) }
}
