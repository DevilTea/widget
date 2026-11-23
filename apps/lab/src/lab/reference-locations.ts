/**
 * Where a widget reference is written in a widget's authored config, read from public facts only: the config value itself and
 * the plugin's generated config JSON Schema, in which `widgetDocs()` marks a value tagged `@widgetRef` with a fixed sentence.
 *
 * Core reports a dependency diagnostic (`missing-dependency-target`, ...) at the widget or the member that declared the
 * dependency, with the dependency's target (`dependency.target.widgetId`), but not the config path the id came from: a plugin
 * builds its dependencies in code from config values, so only a tool that reads the config can say where the id is written.
 * `referenceConfigPaths()` is that reading:
 * 1. in the owner widget's config, every value the schema marks as a widget reference and that equals the target id;
 * 2. with at least one match, the problem is at those paths (several matches are several locations, all wrong);
 * 3. with none (no `@widgetRef` tag, an id that does not come from config, a `self`, `root` or `parent` target, a code the
 *    rule does not apply to), `null`: the caller keeps the widget-level placement.
 * The text is never searched.
 *
 * Pure and framework-free (no Vue, no Lab store, no i18n), so another inspector tool can take it as it is; the only import is
 * `config-schema.ts`, which is pure too. `explain/why.ts` reads the `@widgetRef` mark through the same helpers.
 */
import type { BlueprintDependencyReference } from '@deviltea/widget-core'
import type { ConfigPath, FieldModel, JsonSchema } from './config-schema'
import { describeField } from './config-schema'

/**
 * The dependency diagnostic codes whose target id, when the config writes it in a widget reference, is located at that value.
 * Each says the id names nothing this dependency can use, so changing the value is a fix:
 * - `missing-dependency-target`: no widget has the id (a typo);
 * - `ambiguous-dependency-target`: several widgets have it;
 * - `missing-dependency-capability`, `missing-dependency-member`: the widget it names has no such capability or member (the
 *   wrong widget is named).
 * Left out: `unresolved-dependency-target` (the reference is right, the target widget is broken and has its own diagnostic
 * there) and `property-dependency-has-side-effects` (the plugin's code reads a Method that writes; no config value is wrong).
 */
export const LOCATED_DEPENDENCY_CODES: ReadonlySet<string> = new Set([
	'missing-dependency-target',
	'ambiguous-dependency-target',
	'missing-dependency-capability',
	'missing-dependency-member',
])

/** The facts of a diagnostic the matcher reads: Core's `code` and, for a dependency diagnostic, its `dependency`. */
export interface ReferenceDiagnosticFacts {
	readonly code: string
	readonly dependency?: BlueprintDependencyReference
}

/** The plugin types the schema allows for the config value at `path`, or `null` when the schema does not mark it as a widget reference. */
export type WidgetRefAccessor = (path: ConfigPath) => readonly string[] | null

/**
 * The sentence `widgetDocs()` appends to the description of a config value tagged `@widgetRef A | B` (`apps/widget-skills/src/schema.ts`):
 * "Must be the id of a widget of type A | B in the same document." Group 1 is the type list.
 */
const WIDGET_REF_SENTENCE = /Must be the id of a widget of type (.+?) in the same document\./

/** The plugin types a schema description names as a widget reference, or `null` when it marks no widget reference. */
export function widgetRefTypesOf(description: string): readonly string[] | null {
	const match = WIDGET_REF_SENTENCE.exec(description.replace(/\s+/g, ' '))
	return match === null
		? null
		: match[1]!.split('|')
				.map(type => type.trim())
				.filter(type => type !== '')
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

/** The `@widgetRef` reading of `schema` over `rawConfig`; a `null` schema marks nothing. */
export function schemaWidgetRefs(schema: JsonSchema | null, rawConfig: unknown): WidgetRefAccessor {
	return (path) => {
		if (schema === null)
			return null
		const description = fieldModelAt(schema, rawConfig, path)?.description ?? null
		return description === null ? null : widgetRefTypesOf(description)
	}
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
	const paths = stringValuePaths(rawConfig, target.widgetId)
		.filter(path => widgetRefAt(path) !== null)
	return paths.length === 0 ? null : paths
}
