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
	/** `true` when the range should prefer the widget's `id`/`type` member over its whole object. */
	readonly widgetLevel: boolean
	/** Syntax problems only: the text that failed to parse, so the offset in the message maps onto it. */
	readonly syntaxSourceText: string | null
}

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
			widgetLevel: false,
			syntaxSourceText: parseError.sourceText,
		})
	}
	blueprint.diagnostics.forEach((diagnostic, index) => {
		const location = diagnostic.location
		problems.push({
			key: `diagnostic-${index}`,
			kind: 'diagnostic',
			code: diagnostic.code,
			message: diagnostic.message,
			locationLabel: describeLocation(location, inspection),
			nodeId: location.type === 'source' ? null : inspection.getNodeId(location.node),
			sourcePath: diagnosticSourcePath(blueprint, diagnostic),
			widgetLevel: isWidgetLevel(diagnostic),
			syntaxSourceText: null,
		})
	})
	return problems
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
