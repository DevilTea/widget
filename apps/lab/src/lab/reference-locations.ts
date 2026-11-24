/**
 * Where a widget reference is written in a widget's authored config, read from public facts only: the config value itself and
 * the plugin's generated config JSON Schema, in which `widgetDocs()` annotates a value typed `WidgetRef<Types>` with `x-widgetRef`
 * (the plugin types it names).
 *
 * Core reports a dependency diagnostic (`missing-dependency-target`, ...) at the widget or the member that declared the
 * dependency, with the dependency's target (`dependency.target.widgetId`), but not the config path the id came from: a plugin
 * builds its dependencies in code from config values, so only a tool that reads the config can say where the id is written.
 * `referenceConfigPaths()` is that reading:
 * 1. in the owner widget's config, every value the schema marks as a widget reference and that equals the target id (for
 *    `missing-dependency-capability` / `-member`, only where the target's type is not one the reference allows);
 * 2. with at least one match, the problem is at those paths (several matches are several locations, all wrong);
 * 3. with none (no `WidgetRef` type, an id that does not come from config, a `self`, `root` or `parent` target, a code the
 *    rule does not apply to), `null`: the caller keeps the widget-level placement.
 * The text is never searched, and neither is a description: only a string value whose own schema carries `x-widgetRef` is
 * matched. The schema is followed the way the Structure editor reads it, so an item of a `WidgetRef[]` and a value of a
 * `Record<string, WidgetRef>` (where the generator writes the mark on the item or value schema) are located too. An id written
 * as an object key (trip-budget's `percents`) is not a value, so it is not found and the problem stays at the widget; nothing
 * is located wrongly.
 *
 * Pure and framework-free (no Vue, no Lab store, no i18n), so another inspector tool can take it as it is; the only import is
 * `config-schema.ts`, which is pure too. `explain/why.ts` reads the widget-reference mark through the same helpers.
 */
import type { BlueprintDependencyReference } from '@deviltea/widget-core'
import type { ConfigPath, FieldModel, JsonSchema } from './config-schema'
import { describeField } from './config-schema'

/**
 * The dependency diagnostic codes the rule applies to, by what Core says each one means:
 * - `missing-dependency-target`: no widget of the Document has the target id, so a config value that writes the id names
 *   nothing; it is located at that value.
 * - `missing-dependency-capability`, `missing-dependency-member`: the widget with the target id exists, and its plugin lacks
 *   the capability or the member the dependency's operation needs. It is located at the value only when that widget's type
 *   (Core's `related` location of the target) is not one of the types the schema allows there (`WidgetRef<'A' | 'B'>`): the value
 *   names a widget the plugin's own contract rules out. When the type is allowed, the value keeps the contract, the fault is in
 *   what the plugin reads, and the problem stays at the widget.
 * Left out:
 * - `ambiguous-dependency-target`: several widgets share the id; no value can choose between them (the fix is a unique id),
 *   and those widgets already carry `duplicate-widget-id`;
 * - `unresolved-dependency-target`: the target widget did not resolve and has its own diagnostic there;
 * - `property-dependency-has-side-effects`: a Property depends on a Method that writes State or emits, which is the plugin's code.
 */
export const LOCATED_DEPENDENCY_CODES: ReadonlySet<string> = new Set([
	'missing-dependency-target',
	'missing-dependency-capability',
	'missing-dependency-member',
])

/** The codes located only when the target's type is outside the reference's allowed types. */
const TYPE_CHECKED_CODES: ReadonlySet<string> = new Set(['missing-dependency-capability', 'missing-dependency-member'])

/** The facts of a diagnostic the matcher reads: Core's `code` and, for a dependency diagnostic, its `dependency`. */
export interface ReferenceDiagnosticFacts {
	readonly code: string
	readonly dependency?: BlueprintDependencyReference
	/**
	 * The plugin type of the widget the target id names, from Core's `related` location of the target; `null` or absent when the
	 * diagnostic does not give it (then a type-checked code stays at the widget).
	 */
	readonly targetType?: string | null
}

/** The plugin types the schema allows for the config value at `path`, or `null` when the schema does not mark it as a widget reference. */
export type WidgetRefAccessor = (path: ConfigPath) => readonly string[] | null

/**
 * The annotation `widgetDocs()` writes in the full-profile config schema on a value typed `WidgetRef<'A' | 'B'>`
 * (`apps/widget-skills/src/schema.ts`): the plugin types it names, in the order they are written (`"x-widgetRef": ["A", "B"]`).
 */
export const WIDGET_REF_KEYWORD = 'x-widgetRef'

/**
 * The plugin types the schema of one value marks as a widget reference with `x-widgetRef`, or `null` when it marks none (a
 * non-empty list of strings is a mark, anything else is not). The description is not read: the sentence the generator still
 * writes there ("Must be the id of a widget of type A | B in the same document.") is prose for human and LLM readers.
 */
export function widgetRefTypesOf(schema: JsonSchema | null): readonly string[] | null {
	const types: unknown = schema === null ? undefined : schema[WIDGET_REF_KEYWORD]
	return Array.isArray(types) && types.length > 0 && types.every(type => typeof type === 'string')
		? types as readonly string[]
		: null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The schema's reading of the value at `path` of `rawConfig`, the way the Structure editor reads it (a union branch is chosen
 * by the value), or `null` when the schema does not describe that path.
 */
export function fieldModelAt(schema: JsonSchema, rawConfig: unknown, path: ConfigPath): FieldModel | null {
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
			return null
		model = describeField(schema, child, value)
	}
	return model
}

/**
 * The plugin types the schema allows for the value at `path` of `rawConfig` (its `x-widgetRef`, read from the schema
 * `fieldModelAt()` reaches, through `$ref`, a `null` alternative, the union branch the value fits, list items and dictionary
 * values), or `null` when that value is not marked as a widget reference.
 */
export function widgetRefTypesAt(schema: JsonSchema, rawConfig: unknown, path: ConfigPath): readonly string[] | null {
	return widgetRefTypesOf(fieldModelAt(schema, rawConfig, path)?.schema ?? null)
}

/** The widget-reference reading of `schema` over `rawConfig`; a `null` schema marks nothing. */
export function schemaWidgetRefs(schema: JsonSchema | null, rawConfig: unknown): WidgetRefAccessor {
	return path => schema === null ? null : widgetRefTypesAt(schema, rawConfig, path)
}

const MAX_DEPTH = 32

/** Every path below `value` (prefixed by `prefix`) whose value is exactly the string `needle`, in document order. */
export function stringValuePaths(value: unknown, needle: string, prefix: ConfigPath = []): ConfigPath[] {
	const out: ConfigPath[] = []
	const walk = (current: unknown, path: ConfigPath, depth: number): void => {
		if (depth > MAX_DEPTH)
			return
		if (typeof current === 'string') {
			if (current === needle)
				out.push(path)
			return
		}
		if (Array.isArray(current)) {
			current.forEach((item, index) => walk(item, [...path, index], depth + 1))
			return
		}
		if (isRecord(current)) {
			for (const [key, child] of Object.entries(current))
				walk(child, [...path, key], depth + 1)
		}
	}
	walk(value, prefix, 0)
	return out
}

/**
 * The config paths (relative to the owner widget's config, in document order) where the diagnostic's dependency target is written
 * as a widget reference, or `null` when there is none and the problem stays at the widget. See the module comment for the rule.
 * `rawConfig` is the owner widget's authored config (`source.config`); `widgetRefAt` reads the schema over that same config.
 */
export function referenceConfigPaths(
	facts: ReferenceDiagnosticFacts,
	rawConfig: unknown,
	widgetRefAt: WidgetRefAccessor,
): readonly ConfigPath[] | null {
	const target = facts.dependency?.target
	if (!LOCATED_DEPENDENCY_CODES.has(facts.code) || target?.type !== 'widget')
		return null
	const typeChecked = TYPE_CHECKED_CODES.has(facts.code)
	const targetType = facts.targetType ?? null
	if (typeChecked && targetType === null)
		return null
	const paths = stringValuePaths(rawConfig, target.widgetId)
		.filter((path) => {
			const types = widgetRefAt(path)
			return types !== null && (!typeChecked || !types.includes(targetType!))
		})
	return paths.length === 0 ? null : paths
}
