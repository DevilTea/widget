/**
 * Plugin documentation written in the builder: descriptions, field docs, shared type docs and the
 * serializable `plugin.docs` they produce.
 *
 * Normative contract: DevilTea/widget Discussion #12, "Descriptions live in the plugin builder; JSON Schema is
 * inferred from the types (0.4.0)" (https://github.com/DevilTea/widget/discussions/12#discussioncomment-19850339).
 * Completeness (every key, every position) is checked by the types only; at run time Core checks that each
 * docs value is well formed (a description is a string or `undocumented`, an object has only the expected keys)
 * and stores the result as plain data. Core never reads the prose.
 */

// -------------------------------------------------------------------------------------------------
// The `undocumented` marker
// -------------------------------------------------------------------------------------------------

/**
 * A marker accepted wherever a description or a docs object is required. It type-checks; documentation tooling
 * reports it as an error. Written as a description (`description: undocumented`), it also waives the nested docs
 * of that entry (its `fields`, `items`, `values`, `params`, `returns`, `payload`, `details`, `raw` and `resolved`),
 * which stay allowed and checked when given. In `plugin.docs` it becomes `null`.
 *
 * The marker is a string constant with a literal type, so it keeps its type in a definition object held by a
 * variable (a `unique symbol` would widen to `symbol` there).
 */
export const undocumented: Undocumented = '@deviltea/widget-core:undocumented'

/** The type of the {@link undocumented} marker. */
export type Undocumented = '@deviltea/widget-core:undocumented'

/** A description: Markdown prose, or the {@link undocumented} marker. */
export type WidgetDescription = string | Undocumented

// -------------------------------------------------------------------------------------------------
// Widget references
// -------------------------------------------------------------------------------------------------

declare const widgetRefTypes: unique symbol

/**
 * The id of a widget of one of `Types`. Any string is accepted without a cast, and a value reads back as a
 * `string`; tooling reads `Types` from the type ({@link WidgetRefTypesOf}). Type-level only, like slot
 * expectations: nothing is checked at run time.
 */
export type WidgetRef<Types extends string> = string & { readonly [widgetRefTypes]?: Types }

/** The plugin types a {@link WidgetRef} names, or `never` for a type that is not a widget reference. */
export type WidgetRefTypesOf<T> = T extends { readonly [widgetRefTypes]?: infer Types } ? Exclude<Types, undefined> : never

// -------------------------------------------------------------------------------------------------
// Field docs (types)
// -------------------------------------------------------------------------------------------------

declare const typeDocsType: unique symbol

type IsAny<T> = 0 extends 1 & T ? true : false

type AnyFunction = (...args: any[]) => any

/** Keys of every member of a union. */
type KeysOfUnion<T> = T extends unknown ? keyof T : never

/** The value at `K` in whichever members of a union have it. */
type ValueAt<T, K extends PropertyKey> = T extends unknown ? K extends keyof T ? T[K] : never : never

/** Whether an object type has a key that is not a literal: a `Record<string, …>`, an index signature, a pattern. */
type HasNonLiteralKey<O> = true extends (keyof O extends infer Key
	? Key extends PropertyKey ? (Record<never, never> extends Record<Key, 1> ? true : false) : never
	: never)
	? true
	: false

/** The object part of a value type: what can carry nested docs (functions, primitives and branded primitives such as `WidgetRef` cannot). */
type ObjectPart<T> = IsAny<T> extends true ? never : Exclude<Extract<T, object>, AnyFunction | string | number | boolean | bigint | symbol>

type ArrayPart<O> = Extract<O, readonly unknown[]>

/** The dictionary members of an object part: documented by their `values`. */
type RecordPart<O> = O extends readonly unknown[] ? never : O extends unknown ? (HasNonLiteralKey<O> extends true ? O : never) : never

/** The closed object members of an object part (with at least one key): documented field by field. */
type ClosedPart<O> = O extends readonly unknown[]
	? never
	: O extends unknown
		? HasNonLiteralKey<O> extends true ? never : [Exclude<keyof O, symbol>] extends [never] ? never : O
		: never

type RecordValue<R> = R extends unknown ? R[keyof R] : never

/** The keys a closed part documents: every key of every member, optional keys included. */
type ClosedKeys<C> = Exclude<KeysOfUnion<C>, symbol>

/**
 * The `fields` of a closed object type (or a union of them): an entry for every key that appears in any member,
 * optional keys included.
 */
export type ObjectFieldDocs<C> = { readonly [Key in ClosedKeys<C>]-?: FieldDoc<ValueAt<C, Key>> }

/**
 * Whether a value of type `T` needs nested docs: it has a closed object part, or holds one in its arrays or
 * dictionaries. The search is shallow-bounded, so a recursive open type such as `JsonValue` ends as `false`
 * instead of recursing forever; a closed object is found at any depth that matters in practice.
 */
type NeedsDocs<T, Depth extends readonly unknown[] = []> = Depth['length'] extends 4
	? false
	: ObjectPart<T> extends infer O
		? [O] extends [never]
				? false
				: [ClosedPart<O>] extends [never]
						? true extends (
							| ([ArrayPart<O>] extends [never] ? false : NeedsDocs<ArrayPart<O>[number], [...Depth, 0]>)
							| ([RecordPart<O>] extends [never] ? false : NeedsDocs<RecordValue<RecordPart<O>>, [...Depth, 0]>)
						)
							? true
							: false
						: true
		: false

/** `items` or `values`: required when the element type needs docs of its own, optional otherwise. */
type ContainerDocs<Key extends 'items' | 'values', Element> = NeedsDocs<Element> extends true
	? { readonly [K in Key]: FieldDocs<Element> }
	: { readonly [K in Key]?: FieldDocs<Element> }

/** The nested docs written inline, without `ref`. */
type InlineShapeDocs<O>
	= & ([ClosedPart<O>] extends [never] ? unknown : { readonly fields: ObjectFieldDocs<ClosedPart<O>> })
		& ([ArrayPart<O>] extends [never] ? unknown : ContainerDocs<'items', ArrayPart<O>[number]>)
		& ([RecordPart<O>] extends [never] ? unknown : ContainerDocs<'values', RecordValue<RecordPart<O>>>)

/** A reference to shared type docs: the docs value, or a thunk returning it (for recursion). */
export type TypeDocsRef<T> = TypeDocs<T> | (() => TypeDocs<T>)

/** Every nested-docs key, so that `ref` and inline docs exclude each other. */
interface NoInlineShapeDocs {
	readonly fields?: never
	readonly items?: never
	readonly values?: never
}

/**
 * What a value of type `T` needs beyond its description:
 *
 * - a closed object type, or a union of them: `fields`, with an entry for every key of every member;
 * - an array: `items`, the docs of its element (required when the element needs docs of its own);
 * - a dictionary (`Record<string, …>`, an index signature): `values`, the docs of its values (likewise);
 * - a primitive, a literal union, a function, `unknown` or `any`: nothing.
 *
 * `null` and `undefined` are ignored (`X | null` is documented as `X`), and the parts of a union combine
 * (`boolean | Condition` needs the `fields` of `Condition`). Instead of inline docs, an object part can name
 * shared docs with `ref` (see {@link defineTypeDocs}); `ref` and inline docs exclude each other.
 */
export type ShapeDocs<T> = ShapeDocsOf<ObjectPart<NonNullable<T>>>

// `NonNullable` first: for a generic `Raw`, the docs of `Raw | null` and of `Raw` are then the same type.
type ShapeDocsOf<O> = [O] extends [never]
	? unknown
	: (NoInlineShapeDocs & { readonly ref: TypeDocsRef<O> }) | (InlineShapeDocs<O> & { readonly ref?: never })

/** The nested docs of `T` with every key optional: what an `undocumented` description still allows. */
type OptionalShapeDocs<T> = OptionalShapeDocsOf<ObjectPart<NonNullable<T>>>

type OptionalShapeDocsOf<O> = [O] extends [never]
	? unknown
	: (NoInlineShapeDocs & { readonly ref?: TypeDocsRef<O> }) | Partial<InlineShapeDocs<O> & { readonly ref?: never }>

/**
 * The docs of a value of type `T` whose description is optional: `config.raw` and `config.resolved`, `items`,
 * `values` and a reason's `details`. `undocumented` stands for the whole value.
 */
export type FieldDocs<T>
	= | Undocumented
		| ({ readonly description?: string } & ShapeDocs<T>)
		| ({ readonly description: Undocumented } & OptionalShapeDocs<T>)

/**
 * The docs of one field, parameter, payload position or return value of type `T`: a description plus the nested
 * docs of `T` ({@link ShapeDocs}). `undocumented` stands for the whole entry.
 */
export type FieldDoc<T>
	= | Undocumented
		| ({ readonly description: string } & ShapeDocs<T>)
		| ({ readonly description: Undocumented } & OptionalShapeDocs<T>)

/**
 * The docs part of a member definition (State, Property): a required description plus the nested docs of the
 * value type. Unlike {@link FieldDoc}, it cannot be `undocumented` as a whole, because the definition carries
 * callbacks too.
 */
export type WidgetValueDocs<T>
	= | ({ readonly description: string } & ShapeDocs<T>)
		| ({ readonly description: Undocumented } & OptionalShapeDocs<T>)

/** The `fields` a shared type docs value writes for an object type: inline only. */
type TypeDocsShape<T> = ObjectPart<T> extends infer O
	? [O] extends [never] ? unknown : InlineShapeDocs<O>
	: never

/** What {@link defineTypeDocs} takes: a description plus the inline nested docs of `T`. */
export type TypeDocsInput<T> = { readonly description: WidgetDescription } & TypeDocsShape<T>

/**
 * Shared docs of a named type, declared once with {@link defineTypeDocs} and referenced from fields with `ref`.
 * The brand is invariant in `T`: a `ref` must name docs of exactly the field's object type.
 */
export type TypeDocs<T> = TypeDocsInput<T> & {
	readonly name: string
	/** Type-only invariant brand; no runtime value carries it. */
	readonly [typeDocsType]: (value: T) => T
}

/**
 * `Docs` with every key that `Expected` does not have replaced by a {@link DocsKeyViolation}, at every depth: rejects
 * an unknown key, also one that arrives through a spread or a variable. A `ref` is checked by its own type.
 */
type ExactDocs<Expected, Docs> = Docs extends string | AnyFunction
	? Docs
	: Docs extends object
		? {
				readonly [Key in keyof Docs]: Key extends 'ref'
					? Docs[Key]
					: Key extends KeysOfUnion<Exclude<Expected, string>>
						? ExactDocs<ValueAt<Exclude<Expected, string>, Key>, Docs[Key]>
						: DocsKeyViolation<Key & string>
			}
		: Docs

/** What a docs value with a key its type does not have is checked against; `Key` names the key. */
export interface DocsKeyViolation<Key extends string> {
	readonly 'widget-core: unknown docs key': Key
}

/**
 * Checks a {@link FieldDocs} value against `T` once, where it is written: `defineFieldDocs<T>()(docs)`. Unlike a
 * plain annotation, the check is exact at every depth, so a key `T` does not have is an error even when it
 * reaches the value through a spread or a variable. It returns the value unchanged.
 */
export function defineFieldDocs<T>(): <const Docs extends FieldDocs<T>>(docs: Docs & ExactDocs<FieldDocs<T>, Docs>) => Docs {
	return docs => docs
}

// -------------------------------------------------------------------------------------------------
// Member docs (types)
// -------------------------------------------------------------------------------------------------

/** One docs entry per position of a tuple (a Method's parameters, an Event's payload). */
export type PositionDocs<Args extends readonly unknown[]> = { readonly [Index in keyof Args]-?: FieldDoc<Args[Index]> }

type IsExactlyVoid<T> = (<X>() => X extends T ? 1 : 2) extends (<X>() => X extends void ? 1 : 2) ? true : false

/** `params` is required when the Method has a parameter; `returns` when it does not return `void`. */
type MethodShapeDocs<Args extends readonly unknown[], Return>
	= & (Args extends readonly [] ? { readonly params?: readonly [] } : { readonly params: PositionDocs<Args> })
		& (IsExactlyVoid<Return> extends true ? { readonly returns?: never } : { readonly returns: FieldDoc<Return> })

type OptionalMethodShapeDocs<Args extends readonly unknown[], Return>
	= & { readonly params?: PositionDocs<Args> }
		& (IsExactlyVoid<Return> extends true ? { readonly returns?: never } : { readonly returns?: FieldDoc<Return> })

/**
 * The docs part of a Method definition: a description, `params` (one entry per parameter, by position) and
 * `returns`. `params` may be left out when the Method takes no parameter, and `returns` is not written for a
 * `void` Method.
 */
export type WidgetMethodDocs<Args extends readonly unknown[], Return>
	= | ({ readonly description: string } & MethodShapeDocs<Args, Return>)
		| ({ readonly description: Undocumented } & OptionalMethodShapeDocs<Args, Return>)

/** The docs of one Event: a description, and `payload`, one entry per payload position (optional for none). */
export type WidgetEventDocs<Args extends readonly unknown[]>
	= | Undocumented
		| ({ readonly description: string } & (Args extends readonly [] ? { readonly payload?: readonly [] } : { readonly payload: PositionDocs<Args> }))
		| { readonly description: Undocumented, readonly payload?: PositionDocs<Args> }

/** What `details` on a reason whose payload is `void` is checked against: no value satisfies it. */
export interface WidgetVoidReasonDetailsViolation {
	readonly 'widget-core: a reason whose payload is void takes no details': never
}

/**
 * The docs of one diagnostic reason: a description, and `details`, the docs of the payload, required when the
 * payload is not `void` and forbidden when it is.
 */
export type WidgetReasonDocs<Payload> = IsExactlyVoid<Payload> extends true
	? Undocumented | { readonly description: WidgetDescription, readonly details?: WidgetVoidReasonDetailsViolation }
	: | Undocumented
		| { readonly description: string, readonly details: FieldDocs<Payload> }
		| { readonly description: Undocumented, readonly details?: FieldDocs<Payload> }

/** The docs part of the config definition: a description and the docs of `raw` and `resolved`. */
export type WidgetConfigDocs<Raw, Resolved>
	= | { readonly description: string, readonly raw: FieldDocs<Raw>, readonly resolved: FieldDocs<Resolved> }
		| { readonly description: Undocumented, readonly raw?: FieldDocs<Raw>, readonly resolved?: FieldDocs<Resolved> }

/** The docs part of a slot definition. */
export interface WidgetSlotDocs {
	readonly description: WidgetDescription
}

// -------------------------------------------------------------------------------------------------
// `plugin.docs` (serializable data)
// -------------------------------------------------------------------------------------------------

/**
 * The docs of one value in `plugin.docs`. `description` is the prose, or `null` where the author wrote
 * `undocumented`; it is absent where the author left an optional description out. `ref` names an entry of
 * {@link WidgetPluginDocs.types}. A nested position that holds `null` was written as `undocumented`.
 */
export interface WidgetDocsNode {
	readonly description?: string | null
	readonly fields?: { readonly [key: string]: WidgetDocsNode | null }
	readonly items?: WidgetDocsNode | null
	readonly values?: WidgetDocsNode | null
	readonly ref?: string
}

/** A {@link WidgetDocsNode} whose description is always present (`null` for `undocumented`). */
export type WidgetDescribedDocsNode = WidgetDocsNode & { readonly description: string | null }

export interface WidgetConfigDocsData {
	readonly description: string | null
	readonly raw?: WidgetDocsNode | null
	readonly resolved?: WidgetDocsNode | null
}

export interface WidgetSlotDocsData {
	readonly description: string | null
}

export interface WidgetMethodDocsData {
	readonly description: string | null
	readonly params?: readonly (WidgetDescribedDocsNode | null)[]
	readonly returns?: WidgetDescribedDocsNode | null
}

export interface WidgetEventDocsData {
	readonly description: string | null
	readonly payload?: readonly (WidgetDescribedDocsNode | null)[]
}

export interface WidgetReasonDocsData {
	readonly description: string | null
	readonly details?: WidgetDocsNode | null
}

interface DocsRecord<Entry> { readonly [name: string]: Entry }

/**
 * A plugin's documentation as plain, serializable data: strings, `null`, plain objects and arrays only, so
 * `structuredClone` and JSON round-trip it. A section is `null` when the plugin does not declare it (`reasons`:
 * when `.reasons()` was not called). Records keep declaration order. `types` holds the shared type docs the
 * plugin references with `ref`, keyed by their name. It is not part of `system.catalog`, `inspectPlugin`,
 * Blueprints or the Inspector protocol.
 */
export interface WidgetPluginDocs {
	readonly description: string | null
	readonly config: WidgetConfigDocsData | null
	readonly slots: DocsRecord<WidgetSlotDocsData> | null
	readonly state: DocsRecord<WidgetDescribedDocsNode> | null
	readonly properties: DocsRecord<WidgetDescribedDocsNode> | null
	readonly methods: DocsRecord<WidgetMethodDocsData> | null
	readonly events: DocsRecord<WidgetEventDocsData> | null
	readonly reasons: DocsRecord<WidgetReasonDocsData> | null
	readonly types: DocsRecord<WidgetDescribedDocsNode>
}

// -------------------------------------------------------------------------------------------------
// Runtime: shared type docs
// -------------------------------------------------------------------------------------------------

/** Module-private: the captured docs of a `defineTypeDocs` value. */
const typeDocsCaptured: unique symbol = Symbol('@deviltea/widget-core:type-docs')

/**
 * A captured docs value. `ref` holds the shared docs object, or a thunk resolved when the plugin is built
 * (`done()`), after every module-level docs constant exists.
 */
export interface CapturedDocsNode {
	readonly description?: string | null
	readonly fields?: ReadonlyMap<string, CapturedDocsNode | null>
	readonly items?: CapturedDocsNode | null
	readonly values?: CapturedDocsNode | null
	readonly ref?: CapturedTypeDocs | (() => unknown)
}

interface CapturedTypeDocs {
	readonly name: string
	readonly node: CapturedDocsNode
}

/** A docs value is malformed: an uncoded `TypeError` naming where it was written. */
function docsViolation(subject: string, path: string, problem: string): TypeError {
	return new TypeError(`${subject}${path === '' ? '' : ` at "${path}"`} ${problem}. This is a plugin implementation bug.`)
}

function describeDocsValue(value: unknown): string {
	return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
}

function joinPath(path: string, segment: string): string {
	return path === '' ? segment : `${path}.${segment}`
}

/** A description: a string, or `undocumented` (`null`). */
export function captureDescription(value: unknown, subject: string, path: string): string | null {
	if (value === undocumented)
		return null
	if (typeof value !== 'string')
		throw docsViolation(subject, joinPath(path, 'description'), `must be a string or undocumented, got ${describeDocsValue(value)}`)
	return value
}

const NODE_KEYS: ReadonlySet<string> = new Set(['description', 'fields', 'items', 'values', 'ref'])

function readTypeDocs(value: unknown): CapturedTypeDocs | undefined {
	if (typeof value !== 'object' || value === null)
		return undefined
	return (value as { readonly [typeDocsCaptured]?: CapturedTypeDocs })[typeDocsCaptured]
}

/**
 * Captures one docs value by value: `undocumented` (`null`), or an object whose keys are among `description`,
 * `fields`, `items`, `values` and `ref`. A `ref` is shared
 * type docs or a thunk; it cannot be combined with inline nested docs.
 */
export function captureDocsNode(
	value: unknown,
	subject: string,
	path: string,
	descriptionRequired: boolean,
): CapturedDocsNode | null {
	if (value === undocumented)
		return null
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw docsViolation(subject, path, `must be a docs object or undocumented, got ${describeDocsValue(value)}`)

	const source = value as Readonly<Record<string, unknown>>
	for (const key of Object.keys(source)) {
		if (!NODE_KEYS.has(key))
			throw docsViolation(subject, path, `has an unknown docs key "${key}"`)
	}

	const node: {
		description?: string | null
		fields?: ReadonlyMap<string, CapturedDocsNode | null>
		items?: CapturedDocsNode | null
		values?: CapturedDocsNode | null
		ref?: CapturedTypeDocs | (() => unknown)
	} = {}
	if (source.description !== undefined || descriptionRequired)
		node.description = captureDescription(source.description, subject, path)

	if (source.fields !== undefined) {
		const fields = source.fields
		const fieldsPath = joinPath(path, 'fields')
		if (typeof fields !== 'object' || fields === null || Array.isArray(fields))
			throw docsViolation(subject, fieldsPath, `must be an object of field docs, got ${describeDocsValue(fields)}`)
		node.fields = new Map(Object.keys(fields)
			.map(key => [
				key,
				captureDocsNode((fields as Readonly<Record<string, unknown>>)[key], subject, joinPath(fieldsPath, key), true),
			]))
	}
	if (source.items !== undefined)
		node.items = captureDocsNode(source.items, subject, joinPath(path, 'items'), false)
	if (source.values !== undefined)
		node.values = captureDocsNode(source.values, subject, joinPath(path, 'values'), false)

	if (source.ref !== undefined) {
		if (node.fields !== undefined || node.items !== undefined || node.values !== undefined)
			throw docsViolation(subject, path, 'has both "ref" and inline docs ("fields", "items" or "values"); use one')
		const ref = source.ref
		const captured = readTypeDocs(ref)
		if (captured !== undefined)
			node.ref = captured
		else if (typeof ref === 'function')
			node.ref = ref as () => unknown
		else
			throw docsViolation(subject, joinPath(path, 'ref'), `must be type docs created by defineTypeDocs(), or a function returning them, got ${describeDocsValue(ref)}`)
	}
	return node
}

/** Captures a positional list (`params`, `payload`): an array of entries, each `undocumented` or a described docs object. */
export function captureDocsPositions(value: unknown, subject: string, path: string): readonly (CapturedDocsNode | null)[] {
	if (!Array.isArray(value))
		throw docsViolation(subject, path, `must be an array with one docs entry per position, got ${describeDocsValue(value)}`)
	const positions: (CapturedDocsNode | null)[] = []
	for (let index = 0; index < value.length; index++) {
		if (!(index in value))
			throw docsViolation(subject, joinPath(path, String(index)), 'is missing (a hole in the list)')
		positions.push(captureDocsNode(value[index], subject, joinPath(path, String(index)), true))
	}
	return positions
}

/**
 * Declares the docs of a named type once: a description plus its inline nested docs ({@link ShapeDocs}, without
 * `ref` at the top). A field of that type refers to it with `ref: docs`; a recursive type refers to itself with
 * a thunk (`items: { ref: () => conditionDocs }`), since a constant cannot name itself in its own initializer.
 * `name` is the name tooling gives the type (one JSON Schema `$defs` entry); within one plugin, two different
 * type docs may not share a name.
 */
export function defineTypeDocs<T>(name: string, docs: TypeDocsInput<T>): TypeDocs<T> {
	const subject = `Type docs "${String(name)}"`
	if (typeof name !== 'string' || name === '')
		throw new TypeError(`defineTypeDocs() needs a non-empty name, got ${describeDocsValue(name)}.`)
	if (typeof docs === 'object' && docs !== null && (docs as { readonly ref?: unknown }).ref !== undefined)
		throw docsViolation(subject, '', 'cannot be a "ref"; write the type\'s own docs inline')
	const node = captureDocsNode(docs, subject, '', true)
	if (node === null)
		throw docsViolation(subject, '', 'must be a docs object, got undocumented')
	const captured: CapturedTypeDocs = Object.freeze({ name, node })
	return Object.freeze({ ...docs, name, [typeDocsCaptured]: captured }) as unknown as TypeDocs<T>
}

// -------------------------------------------------------------------------------------------------
// Runtime: serialization into `plugin.docs`
// -------------------------------------------------------------------------------------------------

export function createDocsRecord<Value>(entries: Iterable<readonly [string, Value]>): DocsRecord<Value> {
	const record: Record<string, Value> = Object.create(null)
	for (const [key, value] of entries)
		record[key] = value
	return Object.freeze(record)
}

/**
 * Turns captured docs into plain data, resolving every `ref` to a name and collecting the referenced type docs
 * (transitively) into `types`. Called once by `done()`.
 */
export class WidgetDocsSerializer {
	readonly #subject: string
	readonly #types = new Map<string, { readonly source: CapturedTypeDocs, node: WidgetDescribedDocsNode | null }>()

	constructor(subject: string) {
		this.#subject = subject
	}

	node(captured: CapturedDocsNode | null, path: string): WidgetDocsNode | null {
		if (captured === null)
			return null
		const node: {
			description?: string | null
			fields?: DocsRecord<WidgetDocsNode | null>
			items?: WidgetDocsNode | null
			values?: WidgetDocsNode | null
			ref?: string
		} = {}
		if (captured.description !== undefined)
			node.description = captured.description
		if (captured.fields !== undefined)
			node.fields = createDocsRecord([...captured.fields].map(([key, field]) => [key, this.node(field, joinPath(joinPath(path, 'fields'), key))] as const))
		if (captured.items !== undefined)
			node.items = this.node(captured.items, joinPath(path, 'items'))
		if (captured.values !== undefined)
			node.values = this.node(captured.values, joinPath(path, 'values'))
		if (captured.ref !== undefined)
			node.ref = this.#reference(captured.ref, joinPath(path, 'ref'))
		return Object.freeze(node)
	}

	described(captured: CapturedDocsNode | null, path: string): WidgetDescribedDocsNode | null {
		return this.node(captured, path) as WidgetDescribedDocsNode | null
	}

	positions(captured: readonly (CapturedDocsNode | null)[], path: string): readonly (WidgetDescribedDocsNode | null)[] {
		return Object.freeze(captured.map((position, index) => this.described(position, joinPath(path, String(index)))))
	}

	types(): DocsRecord<WidgetDescribedDocsNode> {
		return createDocsRecord([...this.#types].map(([name, entry]) => [name, entry.node!] as const))
	}

	#reference(ref: CapturedTypeDocs | (() => unknown), path: string): string {
		let target: CapturedTypeDocs | undefined
		if (typeof ref === 'function') {
			const resolved = ref()
			target = readTypeDocs(resolved)
			if (target === undefined)
				throw docsViolation(this.#subject, path, `is a function that must return type docs created by defineTypeDocs(), got ${describeDocsValue(resolved)}`)
		}
		else {
			target = ref
		}

		const existing = this.#types.get(target.name)
		if (existing !== undefined) {
			if (existing.source !== target)
				throw docsViolation(this.#subject, path, `names type docs "${target.name}", but another type docs value already has that name`)
			return target.name
		}
		// Registered before its own docs are serialized, so a recursive reference finds it.
		const entry: { readonly source: CapturedTypeDocs, node: WidgetDescribedDocsNode | null } = { source: target, node: null }
		this.#types.set(target.name, entry)
		entry.node = this.described(target.node, `types.${target.name}`)
		return target.name
	}
}
