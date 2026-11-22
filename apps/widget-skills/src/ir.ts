/**
 * The intermediate representation the extractor produces and every emitter consumes. It is plain JSON data:
 * no TypeScript compiler objects leak into it, so the emitters are pure functions of the IR.
 */

/** The JSDoc tags that constrain a value. Anything outside these and `PROSE_TAGS` is reported by `--check`. */
export const CONSTRAINT_TAGS = [
	'format',
	'pattern',
	'minimum',
	'maximum',
	'exclusiveMinimum',
	'exclusiveMaximum',
	'multipleOf',
	'minLength',
	'maxLength',
	'minItems',
	'maxItems',
	'uniqueItems',
	'minProperties',
	'maxProperties',
	'propertyNames',
	'integer',
	'default',
	'examples',
	'widgetRef',
] as const

export type ConstraintTag = typeof CONSTRAINT_TAGS[number]

/** Tags that carry prose or structure rather than a value constraint. */
export const PROSE_TAGS = ['remarks', 'param', 'returns', 'see', 'example', 'deprecated', 'throws', 'defaultValue', 'typeParam', 'privateRemarks', 'internal', 'alpha', 'beta', 'public', 'experimental'] as const

export interface Doc {
	/** The text before the first block tag. Empty when the member has no JSDoc. */
	summary: string
	remarks: string
	/** Known constraint tags, by tag name without `@`; the value is the raw tag text. */
	tags: Partial<Record<ConstraintTag, string>>
	/** Tag names (without `@`) outside `CONSTRAINT_TAGS` and `PROSE_TAGS`. */
	unknownTags: string[]
	/** The `@example` blocks, in order. Absent when there is none. */
	example?: string[]
	/** The `@deprecated` text (empty when the tag has none). Absent when the member is not deprecated. */
	deprecated?: string
	/** The `@see` references, in order. Absent when there is none. */
	see?: string[]
	/** The `@defaultValue` text. Absent when there is none. */
	defaultValue?: string
}

export type Shape
	= | { kind: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
		| { kind: 'literal', value: string | number | boolean }
		| { kind: 'array', items: Shape }
		| { kind: 'record', value: Shape }
		| { kind: 'object', properties: ShapeProperty[], additional?: Shape }
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
	/** The declaration as written, with its leading JSDoc. */
	text: string
	/** Where the declaration lives, relative to the working directory. */
	file: string
	shape: Shape
	doc: Doc
}

export interface MemberIr {
	name: string
	typeText: string
	/** The value's shape, so `--check` can visit the fields of an inline object type. */
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
	payload: { label: string | null, typeText: string, shape: Shape }[]
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
	/** The JSDoc on the `config` member of the Interfaces. */
	doc: Doc
	rawText: string
	resolvedText: string
	/** The raw config without `null`/`undefined`. */
	rawShape: Shape
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

export interface SystemIr {
	irVersion: 2
	system: string
	module: string
	plugins: PluginIr[]
	types: Record<string, NamedType>
	/** Differences between the types and the runtime (`system.catalog`, `inspectPlugin`). Empty when they agree. */
	mismatches: string[]
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
	}[]
}

export function emptyDoc(): Doc {
	return { summary: '', remarks: '', tags: {}, unknownTags: [] }
}
