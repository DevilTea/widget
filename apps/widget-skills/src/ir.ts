/**
 * The intermediate representation the extractor produces and every emitter consumes. It is plain JSON data:
 * no TypeScript compiler objects leak into it, so the emitters are pure functions of the IR.
 *
 * The shape comes from the TypeScript types; the prose comes from `plugin.docs`, the documentation written in the
 * builder (Core 0.4), which the runtime import reads (`RuntimeFacts`).
 */

/** The prose of one member: its description, split at the first blank line. */
export interface Doc {
	/** The first paragraph of the description. Empty when the member has none (not written, or `undocumented`). */
	summary: string
	/** The rest of the description after the first blank line; empty when there is none. */
	remarks: string
}

export type Shape
	= | {
		kind: 'string'
		/** The plugin types a `WidgetRef<Types>` names: the string is the id of a widget of one of them. */
		widgetRef?: string[]
	}
	| { kind: 'number' | 'boolean' | 'null' | 'unknown' }
	| { kind: 'literal', value: string | number | boolean }
	| {
		kind: 'array'
		items: Shape
		/** The description of each item (`items` in the docs), when one is written and the item is not a named type. */
		itemsDoc?: Doc
	}
	| {
		kind: 'record'
		value: Shape
		/** The description of each value (`values` in the docs), when one is written and the value is not a named type. */
		valuesDoc?: Doc
	}
	| {
		kind: 'object'
		properties: ShapeProperty[]
		additional?: Shape
		/** The description of the values of the other keys (`values` in the docs), likewise. */
		additionalDoc?: Doc
	}
	| { kind: 'union', members: Shape[] }
	| { kind: 'ref', name: string }

export interface ShapeProperty {
	name: string
	optional: boolean
	shape: Shape
	doc: Doc
}

/** A named type (interface or alias) a member mentions; `{ kind: 'ref' }` shapes point here by name. */
export interface NamedType {
	name: string
	/** The declaration as written, with its leading comment when that is a `/** ... *\/` block. */
	text: string
	/** Where the declaration lives, relative to the working directory. */
	file: string
	shape: Shape
	/** The type's own description: from its `defineTypeDocs`, or from a docs position that holds the type itself (`raw`, `items`, ...). */
	doc: Doc
}

export interface MemberIr {
	name: string
	typeText: string
	/** The value's shape, so the emitters can visit the fields of an inline object type. */
	shape: Shape
	doc: Doc
}

export interface StateIr extends MemberIr {
	/** From `inspectPlugin`; `null` when the runtime was not consulted. */
	authorWritable: boolean | null
}

export interface MethodIr {
	name: string
	/** `name(a: A, b?: B): R` */
	signature: string
	params: { name: string, typeText: string, optional: boolean, doc: string, shape: Shape }[]
	returnText: string
	returnShape: Shape
	returnsDoc: string
	doc: Doc
}

export interface EventIr {
	name: string
	payload: { label: string | null, typeText: string, shape: Shape, doc: string }[]
	doc: Doc
}

export interface SlotIr {
	name: string
	doc: Doc
	/**
	 * The plugin types the slot expects: the members of a plain union, or the `Types` of a
	 * `WidgetContract<Shape, Types>`. `null` when it names none (`WidgetChild`, a contract without `Types`): any widget.
	 */
	expected: string[] | null
	/** The printed `Shape` of a `WidgetContract` expectation (the members a child must have), or `null`. */
	contract: string | null
	/** The expectation as written in the types, for example `'Note'` or `WidgetChild`. */
	expectationText: string
}

export interface ReasonIr {
	name: string
	/** The `details` a diagnostic with this reason carries; `null` for a `void` reason (no `details`). */
	payload: { typeText: string, shape: Shape } | null
	doc: Doc
}

export interface ConfigIr {
	/** The `description` of `.config()`. */
	doc: Doc
	rawText: string
	resolvedText: string
	/** The raw config without `null`/`undefined`. */
	rawShape: Shape
	/** The resolved config, so its fields carry their docs. */
	resolvedShape: Shape
	/** Whether `raw` admits `null`, which is how a plugin says the config may be omitted. */
	omittable: boolean
}

/** The capability names of `plugin.capabilities`. */
export const CAPABILITIES = ['config', 'slots', 'state', 'properties', 'methods', 'events'] as const

export type Capability = typeof CAPABILITIES[number]

export interface PluginIr {
	type: string
	/** The name of the `XxxInterfaces` type, when it has one. */
	interfacesName: string | null
	doc: Doc
	/** Declaration presence read from the types: a capability exists when its key is a required member of the Interfaces. */
	capabilities: Record<Capability, boolean>
	config: ConfigIr | null
	slots: SlotIr[]
	state: StateIr[]
	properties: MemberIr[]
	methods: MethodIr[]
	events: EventIr[]
	/** `null` when the Interfaces declare no `reasons`. */
	reasons: ReasonIr[] | null
	/** Names of the `SystemIr.types` entries this plugin's members mention, transitively. */
	typeNames: string[]
}

/** A documentation problem found while reading `plugin.docs` against the types (see `prose.ts`). */
export interface DocsIssue {
	/**
	 * - `undocumented`: the author wrote `undocumented` (`null` in `plugin.docs`);
	 * - `missing-doc`: the types declare a member, field or position the docs do not document;
	 * - `name-mismatch`: the docs name a member, field or position the types do not have, or a `ref` names type docs
	 *   whose name differs from the type's;
	 * - `docs-conflict`: one named type is documented differently in two places (two type docs with one name, or two
	 *   inline docs of the same type), so its single `$defs` entry cannot hold both.
	 */
	kind: 'undocumented' | 'missing-doc' | 'name-mismatch' | 'docs-conflict'
	/** The plugin type and the path in its `plugin.docs`, for example `Survey: config.raw.fields.title`. */
	where: string
	message: string
}

export interface SystemIr {
	irVersion: 3
	system: string
	module: string
	plugins: PluginIr[]
	types: Record<string, NamedType>
	/** Differences between the types and the runtime (`system.catalog`, `inspectPlugin`). Empty when they agree. */
	mismatches: string[]
	/** Whether the prose was read from `plugin.docs` (the System was imported). Without it every text is empty. */
	prose: boolean
	/** Problems in `plugin.docs`, in plugin order. Empty when the prose was not read. */
	docsIssues: DocsIssue[]
	/** Descriptions in `plugin.docs` (each written once in the System), and how many of them are prose rather than `undocumented`. */
	docsCount: { descriptions: number, documented: number }
}

/** The documentation of one value in `plugin.docs` (Core's `WidgetDocsNode`), as plain JSON. */
export interface DocsNode {
	description?: string | null
	fields?: Record<string, DocsNode | null>
	items?: DocsNode | null
	values?: DocsNode | null
	ref?: string
}

/** A plugin's `plugin.docs` (Core's `WidgetPluginDocs`), as plain JSON. */
export interface PluginDocsData {
	description: string | null
	config: { description: string | null, raw?: DocsNode | null, resolved?: DocsNode | null } | null
	slots: Record<string, { description: string | null }> | null
	state: Record<string, DocsNode> | null
	properties: Record<string, DocsNode> | null
	methods: Record<string, { description: string | null, params?: (DocsNode | null)[], returns?: DocsNode | null }> | null
	events: Record<string, { description: string | null, payload?: (DocsNode | null)[] }> | null
	reasons: Record<string, { description: string | null, details?: DocsNode | null }> | null
	types: Record<string, DocsNode>
}

/** What the runtime says, as plain data (see `runtime-facts.ts`). */
export interface RuntimeFacts {
	plugins: {
		type: string
		/** `plugin.capabilities`, as the catalog reports it. */
		capabilities: Record<Capability, boolean>
		/** The slot names from the catalog, `null` without the capability. */
		slots: string[] | null
		state: { name: string, authorWritable: boolean }[] | null
		properties: string[] | null
		events: string[] | null
		/** `plugin.docs`, as JSON; `null` when the plugin has none (a Core before 0.4). */
		docs: PluginDocsData | null
	}[]
}

export function emptyDoc(): Doc {
	return { summary: '', remarks: '' }
}

/** Splits a description into its first paragraph and the rest. */
export function docOfDescription(description: string | null | undefined): Doc {
	if (description === null || description === undefined)
		return emptyDoc()
	const text = description.trim()
	const split = /\n[ \t]*\n/.exec(text)
	return split === null
		? { summary: text, remarks: '' }
		: { summary: text.slice(0, split.index)
				.trim(), remarks: text.slice(split.index + split[0].length)
				.trim() }
}
