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
}

export type Shape
	= | { kind: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
		| { kind: 'literal', value: string | number | boolean }
		| { kind: 'array', items: Shape }
		| { kind: 'record', value: Shape }
		| { kind: 'object', properties: ShapeProperty[] }
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
	runtimeDescription: string | null
}

export interface SlotIr {
	name: string
	doc: Doc
	/** The widget types the slot expects, or `null` when the type does not say (the 0.2 string-union form). */
	expected: string[] | null
	runtimeDescription: string | null
}

export interface ReasonIr {
	name: string
	payloadText: string
	shape: Shape
	doc: Doc
}

export interface ConfigIr {
	rawText: string
	resolvedText: string
	/** The raw config without `null`/`undefined`. */
	rawShape: Shape
	/** Whether `raw` admits `null`, which is how a plugin says the config may be omitted. */
	omittable: boolean
	runtimeDescription: string | null
}

export interface PluginIr {
	type: string
	/** The name of the `XxxInterfaces` type, when it has one. */
	interfacesName: string | null
	doc: Doc
	runtimeDescription: string | null
	config: ConfigIr | null
	/** `union` is the 0.2 form (`slots: 'a' | 'b'`), `record` the 0.3 form (`slots: { a: Expected }`). */
	slotForm: 'union' | 'record' | null
	/** `slots: string`: any slot name is accepted, so `slots` lists only what the runtime declares. */
	slotsOpen: boolean
	slots: SlotIr[]
	state: StateIr[]
	properties: MemberIr[]
	methods: MethodIr[]
	events: EventIr[]
	reasons: ReasonIr[] | null
	/** Names of the `SystemIr.types` entries this plugin's members mention, transitively. */
	typeNames: string[]
}

export interface SystemIr {
	irVersion: 1
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
		description: string
		configDescription: string | null
		hasConfig: boolean
		hasMethods: boolean
		slots: { name: string, description: string }[] | null
		state: { name: string, authorWritable: boolean }[] | null
		properties: string[] | null
		events: { name: string, description: string }[] | null
	}[]
}

export function emptyDoc(): Doc {
	return { summary: '', remarks: '', tags: {}, unknownTags: [] }
}
