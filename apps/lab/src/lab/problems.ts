/**
 * The Author "Problems" list: why the JSON text cannot be applied, and the committed Document's diagnostics, as plain rows,
 * each with a source range for jumping and for editor markers.
 *
 * A row is the Lab-only JSON `SyntaxError` of the current text (`SourceParseError`), Core's refusal of a commit of the
 * current text (`LabJsonBlock` of kind `commit`: its failure code and message, located by its operand path), or one Core
 * Blueprint diagnostic of the committed Document. Core's `code` and `message` pass through verbatim; the only thing
 * derived here is *where* the diagnostic points in the source text. Core locates a diagnostic through a
 * Blueprint node (and a member name or a node-relative `path`), and `blueprint.getSourcePath(node)` is the
 * node's absolute source path, so the range is `getSourcePath(node)` plus the diagnostic's own relative
 * part, resolved against the JSON text by `json-locate.ts`. A diagnostic with no resolvable range falls back
 * to the nearest existing ancestor in the text.
 *
 * One refinement: a dependency diagnostic whose target id the owner widget's config writes in a value its schema marks as a
 * widget reference is located at that value (every such value, when there are several), not at the widget
 * (`reference-locations.ts`). The schema is the showcase's generated config schema, so `collectProblems()` takes the map.
 */

import type { BlueprintDiagnostic, BlueprintDiagnosticLocation, WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { BlueprintInspection, InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { JsonSchema } from './config-schema'
import type { JsonPath, JsonPathSegment, JsonSpan } from './json-locate'
import type { LabJsonBlock } from './types'
import { endOfLine, jsonSyntaxErrorSpan, locateJsonMember, locateJsonPath } from './json-locate'
import { referenceConfigPaths, schemaWidgetRefs } from './reference-locations'

export interface LabProblem {
	/** Stable within one list: the position in `collectProblems()`'s result. */
	readonly key: string
	/** `commit`: Core refused committing the current JSON text (a `json-incompatible-value` patch failure, for example). */
	readonly kind: 'syntax' | 'commit' | 'diagnostic'
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
	 * A dependency diagnostic whose target id is written in a widget reference of the config has the reference's path here
	 * (`reference-locations.ts`).
	 */
	readonly configPath: JsonPath | null
	/**
	 * The problem's other locations, after `sourcePath` / `configPath`: only a dependency diagnostic whose target id the config
	 * writes in more than one widget reference has any (each value is wrong). Absent or empty for every other problem. Each one is
	 * a squiggle and is shown at its field in Structure; the Problems row still jumps to the first.
	 */
	readonly moreLocations?: readonly LabProblemLocation[]
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

export interface LabProblemLocation {
	readonly sourcePath: JsonPath
	readonly configPath: JsonPath
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

/**
 * The config paths of a dependency diagnostic's broken widget reference in its owner widget's authored config (`source.config`,
 * the committed Document's fragment), read with the owner plugin's config schema; `null` when it stays at the widget.
 */
function referenceLocations(
	blueprint: WidgetSystemBlueprint,
	diagnostic: BlueprintDiagnostic,
	configSchemas: Readonly<Record<string, JsonSchema>>,
): readonly LabProblemLocation[] | null {
	const location = diagnostic.location
	if (location.type === 'source' || !('dependency' in diagnostic) || !location.node.resolved)
		return null
	const owner = location.node
	const schema = Object.hasOwn(configSchemas, owner.type) ? configSchemas[owner.type]! : null
	const nodePath = blueprint.getSourcePath(owner)
	if (schema === null || nodePath === null)
		return null
	const source: unknown = owner.source
	const rawConfig = typeof source === 'object' && source !== null && !Array.isArray(source) ? (source as { readonly config?: unknown }).config : undefined
	const paths = referenceConfigPaths(diagnostic, rawConfig, schemaWidgetRefs(schema, rawConfig))
	return paths === null ? null : paths.map(configPath => ({ sourcePath: [...nodePath, 'config', ...configPath], configPath }))
}

/**
 * `configSchemas` is the showcase's config JSON Schema map (`ShowcaseEntry.configSchemas`); without one, no dependency
 * diagnostic is located inside a config.
 */
export function collectProblems(
	blueprint: WidgetSystemBlueprint,
	inspection: BlueprintInspection,
	jsonBlock: LabJsonBlock | null,
	configSchemas: Readonly<Record<string, JsonSchema>> = {},
): readonly LabProblem[] {
	const problems: LabProblem[] = []
	if (jsonBlock?.kind === 'commit') {
		const failure = jsonBlock.failure
		const reason = 'reason' in failure && failure.reason !== undefined ? String(failure.reason) : null
		problems.push({
			key: 'commit',
			kind: 'commit',
			code: failure.code,
			message: failure.message,
			locationLabel: reason,
			nodeId: null,
			// The commit is one root replacement, so the operand-relative path is the absolute source path.
			sourcePath: 'path' in failure && failure.path !== undefined ? jsonSegments(failure.path) : [],
			configPath: null,
			widgetLevel: false,
			syntaxSourceText: null,
			cycle: null,
		})
	}
	const parseError = jsonBlock?.kind === 'syntax' ? jsonBlock.error : null
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
		const nodeId = location.type === 'source' ? null : inspection.getNodeId(location.node)
		const references = referenceLocations(blueprint, diagnostic, configSchemas)
		if (references !== null) {
			const [first, ...more] = references
			problems.push({
				key: `diagnostic-${index}`,
				kind: 'diagnostic',
				code: diagnostic.code,
				message: diagnostic.message,
				locationLabel: describeLocation(location, inspection),
				nodeId,
				sourcePath: first!.sourcePath,
				configPath: first!.configPath,
				moreLocations: more,
				widgetLevel: false,
				syntaxSourceText: null,
				cycle,
			})
			return
		}
		const sourcePath = diagnosticSourcePath(blueprint, diagnostic)
		problems.push({
			key: `diagnostic-${index}`,
			kind: 'diagnostic',
			code: diagnostic.code,
			message: diagnostic.message,
			locationLabel: describeLocation(location, inspection),
			nodeId,
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
 * a key that is not there (a required key that is missing) shows at its object. A problem with several locations
 * (`moreLocations`) is claimed by the field of each.
 */
export function claimsFieldProblem(path: readonly JsonPathSegment[], childKeys: readonly JsonPathSegment[] | null, problem: LabProblem): boolean {
	if (problem.configPath === null)
		return false
	return [problem.configPath, ...(problem.moreLocations ?? []).map(location => location.configPath)]
		.some(target => claimsConfigPath(path, childKeys, target))
}

function claimsConfigPath(path: readonly JsonPathSegment[], childKeys: readonly JsonPathSegment[] | null, target: JsonPath): boolean {
	if (target.length < path.length)
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
	return pathSpan(problem, problem.sourcePath ?? [], text)
}

/**
 * Every text range a problem points at inside `text`: `problemSpan()`'s, then one per `moreLocations` entry, located the same
 * way (each is a squiggle). Empty when the text does not parse.
 */
export function problemSpans(problem: LabProblem, text: string): readonly JsonSpan[] {
	const first = problemSpan(problem, text)
	if (first === null)
		return []
	const more = (problem.moreLocations ?? []).flatMap((location) => {
		const span = pathSpan(problem, location.sourcePath, text)
		return span === null ? [] : [span]
	})
	return [first, ...more]
}

/** One editor squiggle: a range of the text with the code and message its hover shows. */
export interface ProblemMarker {
	readonly start: number
	readonly end: number
	readonly code: string | null
	readonly message: string
}

/**
 * The squiggles for `problems` over `text`: one per location of each problem (`problemSpans()`), with the same range, code and
 * message drawn once. Two diagnostics of one widget that name the same missing widget (one per member that reads it) are located
 * at the same values (`reference-locations.ts` cannot tell which value a member read), so each value gets one squiggle, not one per
 * diagnostic; the Problems list keeps both rows.
 */
export function problemMarkers(problems: readonly LabProblem[], text: string): readonly ProblemMarker[] {
	const seen = new Set<string>()
	const markers: ProblemMarker[] = []
	for (const problem of problems) {
		for (const span of problemSpans(problem, text)) {
			const key = JSON.stringify([span.start, span.end, problem.code, problem.message])
			if (seen.has(key))
				continue
			seen.add(key)
			markers.push({ start: span.start, end: span.end, code: problem.code, message: problem.message })
		}
	}
	return markers
}

/**
 * `problems` with each code and message once (the first one kept, order unchanged): what one field lists, so two diagnostics of
 * one widget about the same reference read as one line there.
 */
export function uniqueProblemTexts(problems: readonly LabProblem[]): readonly LabProblem[] {
	const seen = new Set<string>()
	return problems.filter((problem) => {
		const key = JSON.stringify([problem.code, problem.message])
		if (seen.has(key))
			return false
		seen.add(key)
		return true
	})
}

function pathSpan(problem: LabProblem, path: JsonPath, text: string): JsonSpan | null {
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
