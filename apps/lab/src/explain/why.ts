/**
 * The "Why it behaves this way" sentences of the Explain tab (Lab UX phase 2, M13), built generically from facts the Lab
 * already has: Core's Blueprint inspection (each Property's declared dependencies) and the plugin's generated config JSON
 * Schema (field descriptions). There is no per-showcase code here.
 *
 * One sentence per (Property of the selected widget, other widget, operation): "options reads #mode's value", "amountBase
 * calls #currency's convert". Dependencies on the widget itself are left out (they are the widget's own logic, and Relations
 * lists them), and so are absent or invalid references, which name no member that has a value.
 *
 * Core does not say which config field produced a dependency (a dependency's `path` is the plugin's own container key, such
 * as a question id). So the config field is an inference, made the same way for every plugin: a string value of the
 * widget's authored config that equals the other widget's id names it. When the dependency's path starts with a top-level
 * config key (`["rules", "guests"]`), only that field is searched. Otherwise a matching value counts only when the generated
 * schema marks it as a widget reference (the sentence `widgetDocs()` writes for `@widgetRef`), preferring one that names the
 * other widget's type, so a string that merely equals the id (`{ inputType: "email" }` beside a widget `email`) is not taken
 * for one. The field shown is the top-level config field, or, inside a list of objects, the field of the list item
 * (`options[1].enabledWhen.question` -> `enabledWhen`), with the description the generated schema has for it. A plugin whose
 * reads come from its slots (no config value names the other widget) gets no field, which is the honest answer.
 *
 * Pure and framework-agnostic; the live values ("now: ...") are the view's job (they come from the Preview Runtime).
 */
import type { BlueprintInspection, BlueprintInspectionDependency, InspectionNodeId, ResolvedBlueprintInspectionNode } from '@deviltea/widget-core/inspection'
import type { ConfigPath, FieldModel, JsonSchema } from '../lab/config-schema'
import { docText } from '../author/widget-docs'
import { describeField } from '../lab/config-schema'

export type WhyOperation = 'reads' | 'invokes'

export interface WhyMember {
	readonly type: 'state' | 'property' | 'method'
	readonly name: string
}

export interface WhyTarget {
	readonly nodeId: InspectionNodeId
	readonly widgetId: string
	readonly widgetType: string
}

/** A config field of the selected widget whose value names the other widget. */
export interface WhyConfigField {
	/** The field's key: a top-level config key, or the key inside a list item. */
	readonly name: string
	/** Where the field is in the authored config (the first occurrence when several list items name the widget). */
	readonly path: ConfigPath
	/** The field's description from the generated config schema, line wraps joined; `''` when it has none. */
	readonly description: string
}

export interface WhySentence {
	/** Stable within one Blueprint: `<property>|<target node>|<operation>`. */
	readonly key: string
	/** The Property of the selected widget. */
	readonly property: string
	readonly operation: WhyOperation
	readonly target: WhyTarget
	/** The members of the other widget, in the order the Property declares them. */
	readonly members: readonly WhyMember[]
	readonly fields: readonly WhyConfigField[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function operationOf(dependency: BlueprintInspectionDependency): WhyOperation | null {
	switch (dependency.reference.operation.type) {
		case 'state-get':
		case 'property-get':
			return 'reads'
		case 'method-invoke':
			return 'invokes'
		default:
			// `state-set` belongs to Methods; a Property never writes.
			return null
	}
}

/** Every path below `value` (prefixed by `prefix`) whose value is exactly the string `needle`. */
function stringLeafPaths(value: unknown, needle: string, prefix: ConfigPath, out: ConfigPath[], depth = 0): void {
	if (depth > 32)
		return
	if (typeof value === 'string') {
		if (value === needle)
			out.push(prefix)
		return
	}
	if (Array.isArray(value)) {
		value.forEach((item, index) => stringLeafPaths(item, needle, [...prefix, index], out, depth + 1))
		return
	}
	if (isRecord(value)) {
		for (const [key, child] of Object.entries(value))
			stringLeafPaths(child, needle, [...prefix, key], out, depth + 1)
	}
}

/** The field a reference at `path` belongs to: the top-level key, or the key inside an item of a top-level list. */
function fieldPathOf(path: ConfigPath): ConfigPath {
	if (path.length >= 3 && typeof path[1] === 'number' && typeof path[2] === 'string')
		return path.slice(0, 3)
	return path.slice(0, 1)
}

/** The schema's description of the value at `path`, read the way the Structure editor reads it; `''` when there is none. */
function describeAt(schema: JsonSchema, rawConfig: unknown, path: ConfigPath): string {
	let model: FieldModel = describeField(schema, schema, rawConfig)
	let value: unknown = rawConfig
	for (const segment of path) {
		const field = model.field
		let child: JsonSchema | null = null
		if (typeof segment === 'string' && field.kind === 'object' && isRecord(value)) {
			child = Object.hasOwn(field.properties, segment) ? field.properties[segment]! : field.additional
			value = value[segment]
		}
		else if (typeof segment === 'number' && field.kind === 'array' && Array.isArray(value)) {
			child = field.items
			value = value[segment]
		}
		if (child === null)
			return ''
		model = describeField(schema, child, value)
	}
	return model.description === null ? '' : docText({ summary: model.description, remarks: '' })
}

/** The top-level config key a dependency path starts with, or `null` when it starts with something else. */
function configScopeOf(rawConfig: Readonly<Record<string, unknown>>, path: readonly (string | number)[]): string | null {
	const first = path[0]
	return typeof first === 'string' && Object.hasOwn(rawConfig, first) ? first : null
}

/**
 * The sentence `widgetDocs()` appends to the description of a config value tagged `@widgetRef A | B` (`apps/widget-skills/src/schema.ts`):
 * "Must be the id of a widget of type A | B in the same document." Group 1 is the type list.
 */
const WIDGET_REF_SENTENCE = /Must be the id of a widget of type (.+?) in the same document\./

/** The plugin types a schema description names as a widget reference, or `null` when it marks no widget reference. */
export function widgetRefTypesOf(description: string): readonly string[] | null {
	const match = WIDGET_REF_SENTENCE.exec(description)
	return match === null
		? null
		: match[1]!.split('|')
				.map(type => type.trim())
				.filter(type => type !== '')
}

function configFieldsNaming(
	rawConfig: unknown,
	schema: JsonSchema | null,
	target: WhyTarget,
	dependencyPaths: readonly (readonly (string | number)[])[],
	claimedKeys: ReadonlySet<string>,
): WhyConfigField[] {
	const widgetId = target.widgetId
	if (!isRecord(rawConfig))
		return []
	const matches: ConfigPath[] = []
	const scopes = new Set(dependencyPaths.map(path => configScopeOf(rawConfig, path)))
	if (scopes.has(null)) {
		// Search the whole config, except the fields another Property's dependency on this widget names by its path: those
		// belong to that Property (`sessions.errors` reads `guests` through `rules`, so `rules` is not why `options` does).
		for (const [key, child] of Object.entries(rawConfig)) {
			if (!claimedKeys.has(key) || scopes.has(key))
				stringLeafPaths(child, widgetId, [key], matches)
		}
	}
	else {
		for (const key of scopes)
			stringLeafPaths(rawConfig[key!], widgetId, [key!], matches)
	}

	// A match inside a field a dependency path names is that dependency's field. Any other match is only a string that happens
	// to equal the widget's id unless the schema marks the value as a widget reference; among those, one naming the target's
	// type is preferred.
	const candidates: { readonly match: ConfigPath, readonly typeMatches: boolean }[] = []
	for (const match of matches) {
		if (typeof match[0] === 'string' && scopes.has(match[0])) {
			candidates.push({ match, typeMatches: true })
			continue
		}
		const types = schema === null ? null : widgetRefTypesOf(describeAt(schema, rawConfig, match))
		if (types !== null)
			candidates.push({ match, typeMatches: types.includes(target.widgetType) })
	}
	const preferred = candidates.some(candidate => candidate.typeMatches)
		? candidates.filter(candidate => candidate.typeMatches)
		: candidates

	const fields: WhyConfigField[] = []
	const seen = new Set<string>()
	for (const { match } of preferred) {
		const fieldPath = fieldPathOf(match)
		const name = String(fieldPath.at(-1))
		const description = schema === null ? '' : describeAt(schema, rawConfig, fieldPath)
		const key = `${name}\u0000${description}`
		if (seen.has(key))
			continue
		seen.add(key)
		fields.push({ name, path: fieldPath, description })
	}
	return fields
}

/**
 * The sentences for the widget `nodeId` of `inspection`: `[]` for an unresolved or unknown node and for a widget whose
 * Properties read no other widget. `configSchema` is the plugin's config JSON Schema (`ShowcaseEntry.configSchemas[type]`),
 * `null` when it has none.
 */
export function buildWhySentences(
	inspection: BlueprintInspection,
	nodeId: InspectionNodeId,
	configSchema: JsonSchema | null,
): readonly WhySentence[] {
	const node = inspection.getNode(nodeId)
	if (node === null || !node.resolved)
		return []
	const resolved = node as ResolvedBlueprintInspectionNode
	const rawConfig = (resolved.node as unknown as { readonly rawConfig?: unknown }).rawConfig

	interface Draft {
		property: string
		operation: WhyOperation
		target: WhyTarget
		members: WhyMember[]
		paths: (readonly (string | number)[])[]
	}
	const drafts = new Map<string, Draft>()
	for (const property of resolved.properties) {
		for (const dependency of property.dependencies) {
			if (dependency.status !== 'resolved' || dependency.target.nodeId === nodeId)
				continue
			const operation = operationOf(dependency)
			if (operation === null)
				continue
			const targetNode = inspection.getNode(dependency.target.nodeId)
			if (targetNode === null || !targetNode.resolved)
				continue
			const key = `${property.name}|${dependency.target.nodeId}|${operation}`
			let draft = drafts.get(key)
			if (draft === undefined) {
				draft = {
					property: property.name,
					operation,
					target: { nodeId: targetNode.nodeId, widgetId: targetNode.node.id, widgetType: targetNode.node.type },
					members: [],
					paths: [],
				}
				drafts.set(key, draft)
			}
			const member = dependency.target.member
			if (!draft.members.some(existing => existing.type === member.type && existing.name === member.name))
				draft.members.push({ type: member.type, name: member.name })
			draft.paths.push(dependency.path)
		}
	}

	// Per other widget, the config keys some dependency on it names by its path.
	const claimed = new Map<InspectionNodeId, Set<string>>()
	if (isRecord(rawConfig)) {
		for (const draft of drafts.values()) {
			for (const path of draft.paths) {
				const scope = configScopeOf(rawConfig, path)
				if (scope === null)
					continue
				const keys = claimed.get(draft.target.nodeId) ?? new Set<string>()
				keys.add(scope)
				claimed.set(draft.target.nodeId, keys)
			}
		}
	}

	return [...drafts.entries()].map(([key, draft]) => ({
		key,
		property: draft.property,
		operation: draft.operation,
		target: draft.target,
		members: draft.members,
		fields: configFieldsNaming(rawConfig, configSchema, draft.target, draft.paths, claimed.get(draft.target.nodeId) ?? new Set()),
	}))
}
