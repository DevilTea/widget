/**
 * The documentation object `virtual:widget-docs/<name>` exports (see `vite.ts`). Plain JSON: no functions, no
 * `undefined`. This module has no imports, so a consumer can type the virtual module without loading the generator.
 *
 * Every text comes from `plugin.docs`, the descriptions written in the plugin builder (Core 0.4); the shapes and the
 * printed types come from the TypeScript types. A capability section is `null` when the plugin does not declare the
 * capability and `{}` when it declares it empty.
 */

/** Bumped when the shape of `WidgetDocs` changes incompatibly; an added key does not bump it. */
export const WIDGET_DOCS_VERSION = 2

/** Any JSON value. */
export type WidgetDocsJson = null | boolean | number | string | WidgetDocsJson[] | { [key: string]: WidgetDocsJson }

/** A JSON Schema (Draft 2020-12). */
export interface WidgetDocsJsonSchema { [key: string]: WidgetDocsJson }

export interface WidgetDocsText {
	/** The first paragraph of the description; empty when the member has none (or is `undocumented`). */
	summary: string
	/** The rest of the description, after its first blank line; empty when there is none. */
	remarks: string
	/**
	 * `widgetRef`, the plugin types a `WidgetRef<Types>` value names (`A | B`), when the member's value is a widget
	 * reference; otherwise empty. (The 0.3 JSDoc constraint tags that also lived here are retired: constraints are prose.)
	 */
	tags: Record<string, string>
	/** Always empty: the `@example` tag is retired. */
	example: string[]
	/** Always `null`: the `@deprecated` tag is retired. */
	deprecated: string | null
	/** Always empty: the `@see` tag is retired. */
	see: string[]
	/** Always `null`: the `@defaultValue` tag is retired. */
	defaultValue: string | null
}

export interface WidgetDocsConfig extends WidgetDocsText {
	/** Whether `raw` admits `null`: the config may be left out. */
	omittable: boolean
	/** The raw (authored) config type as printed by TypeScript. */
	rawType: string
	/** The resolved config type as printed by TypeScript. */
	resolvedType: string
	/** The JSON Schema (Draft 2020-12, full profile) of the authored config, with field descriptions. */
	schema: WidgetDocsJsonSchema
}

export interface WidgetDocsSlot extends WidgetDocsText {
	/** The plugin types the slot expects; `null` when it names none (`WidgetChild`, a contract without `Types`): any widget. */
	expectedTypes: string[] | null
	/** The members a `WidgetContract` expects of each child, as printed by TypeScript; `null` for any other expectation. */
	contract: string | null
	/** The expectation as written in the Interfaces. */
	expectation: string
}

export interface WidgetDocsMember extends WidgetDocsText {
	/** The value type as printed by TypeScript. */
	type: string
}

export interface WidgetDocsState extends WidgetDocsMember {
	/** From `inspectPlugin`; `null` when the runtime was not consulted. */
	authorWritable: boolean | null
}

export interface WidgetDocsMethod extends WidgetDocsText {
	/** `name(a: A, b?: B): R` */
	signature: string
	params: { name: string, type: string, optional: boolean, summary: string }[]
	returns: { type: string, summary: string }
}

export interface WidgetDocsEvent extends WidgetDocsText {
	/** One entry per payload position: its tuple label, its printed type and its description. */
	payload: { label: string | null, type: string, summary: string }[]
}

export interface WidgetDocsReason extends WidgetDocsText {
	/** The type of the diagnostic's `details`; `null` for a `void` reason (no `details`). */
	details: string | null
}

export interface WidgetPluginDocs extends WidgetDocsText {
	type: string
	/** The named types (keys of `WidgetDocs.types`) this plugin's members mention, transitively. */
	typeNames: string[]
	/** The name of the plugin's `Interfaces` type, when it has one. */
	interfacesName: string | null
	config: WidgetDocsConfig | null
	slots: Record<string, WidgetDocsSlot> | null
	state: Record<string, WidgetDocsState> | null
	properties: Record<string, WidgetDocsMember> | null
	methods: Record<string, WidgetDocsMethod> | null
	events: Record<string, WidgetDocsEvent> | null
	/** `null` when the Interfaces declare no `reasons`. */
	reasons: Record<string, WidgetDocsReason> | null
}

/** A field of a named object type. */
export interface WidgetDocsField extends WidgetDocsText {
	optional: boolean
}

/** A named type (interface or type alias) a plugin's members mention. */
export interface WidgetDocsNamedType extends WidgetDocsText {
	/** The declaration as written, with its leading doc comment, if any. */
	declaration: string
	/** The fields of an object type, by name; `null` for any other type. */
	fields: Record<string, WidgetDocsField> | null
}

/** The prose of one member in the slim docs: the summary and the remarks only. */
export interface WidgetDocsSlimText {
	/** The first paragraph of the description; empty when the member has none. */
	summary: string
	/** The rest of the description; empty when there is none. */
	remarks: string
}

export interface WidgetDocsSlimConfig extends WidgetDocsSlimText {
	/** As `WidgetDocsConfig.schema`. */
	schema: WidgetDocsJsonSchema
}

/** One plugin in the slim docs: what a document author reads (the plugin, its config, its slots and its Events). */
export interface WidgetPluginDocsSlim extends WidgetDocsSlimText {
	config: WidgetDocsSlimConfig | null
	slots: Record<string, WidgetDocsSlimText> | null
	events: Record<string, WidgetDocsSlimText> | null
}

/**
 * The slim docs object (`widgetDocs({ slim: true })`): per plugin the summary and remarks of the plugin, its config,
 * its slots and its Events, and the config schema. No `types` section, no printed types, no tags, State, Properties,
 * Methods or reasons.
 */
export interface WidgetDocsSlim {
	docsVersion: typeof WIDGET_DOCS_VERSION
	/** The System's export name. */
	system: string
	/** Per plugin type, in registration order. */
	plugins: Record<string, WidgetPluginDocsSlim>
}

export interface WidgetDocs {
	docsVersion: typeof WIDGET_DOCS_VERSION
	/** The System's export name. */
	system: string
	/** Per plugin type, in registration order. */
	plugins: Record<string, WidgetPluginDocs>
	/** Every named type a plugin mentions, by name (as in `WidgetPluginDocs.typeNames` and the schemas' `type_<Name>`). */
	types: Record<string, WidgetDocsNamedType>
}
