/**
 * Explicit projection and recovery tooling for the alternative separated Widget source
 * representation.
 *
 * `WidgetSource` remains the only canonical nested authored representation. This module never
 * participates in Blueprint/Document source admission or attempts to detect a representation from
 * an `unknown` source. Callers opt into this representation explicitly by calling one of the
 * functions below.
 */

import type { DiagnosticBase } from './diagnostic'
import type { JsonValue } from './json'
import type { WidgetId } from './types'
import { isJsonValue, MAX_JSON_DEPTH } from './json'

/** The tree half of a {@link SeparatedWidgetSource}. */
export interface SeparatedWidgetStructure {
	readonly id: WidgetId
	readonly slots?: Readonly<Record<string, readonly SeparatedWidgetStructure[]>>
}

/** One entry in the flat Widget data list. */
export interface SeparatedWidgetData {
	readonly id: WidgetId
	readonly type: string
	readonly config?: JsonValue
	/** The authored `meta` extension value, carried through losslessly and never interpreted. */
	readonly meta?: JsonValue
}

/**
 * Explicit alternative source representation: a nested structural tree plus a flat data list.
 * The list is intentionally not a map so duplicate IDs remain observable and diagnosable.
 */
export interface SeparatedWidgetSource {
	readonly structure: SeparatedWidgetStructure
	readonly widgets: readonly SeparatedWidgetData[]
}

/**
 * A representation-aware source location, independent from Blueprint semantic locations. `widgets` and
 * `structure` locate a fact in a separated input (`index` is absent when the fact concerns the whole `widgets`
 * value); `source` locates a fact in the nested source given to {@link separateWidgetSource} by its path there.
 */
export type SeparatedSourceLocation
	= | {
		readonly area: 'widgets'
		readonly index?: number
		readonly path?: readonly PropertyKey[]
	}
	| {
		readonly area: 'source'
		readonly path: readonly PropertyKey[]
	}
	| {
		readonly area: 'structure'
		readonly path: readonly PropertyKey[]
	}

/** Stable codes for separated-source normalization facts. */
export type SeparatedWidgetSourceDiagnosticCode
	= | 'invalid-separated-source'
		| 'invalid-separated-structure'
		| 'invalid-separated-widget'
		| 'duplicate-widget-id'
		| 'missing-widget-data'
		| 'unused-widget-data'
		| 'duplicate-structure-id'

/**
 * Representation diagnostics are deliberately separate from Blueprint semantic diagnostics. The
 * source location always identifies the separated input area and never relies on WidgetId
 * uniqueness.
 */
export type SeparatedWidgetSourceDiagnostic
	= | (DiagnosticBase<'invalid-separated-source', SeparatedSourceLocation> & {
		readonly reason: 'missing-structure' | 'invalid-widgets'
	})
	| (DiagnosticBase<'invalid-separated-structure', SeparatedSourceLocation> & {
		readonly reason: 'invalid-node' | 'invalid-slots' | 'invalid-slot-children' | 'max-depth-exceeded'
	})
	| (DiagnosticBase<'invalid-separated-widget', SeparatedSourceLocation> & {
		readonly reason: 'invalid-entry' | 'invalid-id' | 'invalid-type' | 'invalid-config' | 'invalid-meta' | 'unexpected-field'
	})
	| (DiagnosticBase<'duplicate-widget-id', SeparatedSourceLocation> & {
		readonly widgetId: WidgetId
	})
	| (DiagnosticBase<'missing-widget-data', SeparatedSourceLocation> & {
		readonly widgetId: WidgetId
	})
	| (DiagnosticBase<'unused-widget-data', SeparatedSourceLocation> & {
		readonly widgetId: WidgetId
	})
	| (DiagnosticBase<'duplicate-structure-id', SeparatedSourceLocation> & {
		readonly widgetId: WidgetId
	})

/**
 * Result of {@link separateWidgetSource}. `separated` is best-effort: it is non-null whenever `diagnostics` is
 * empty, and null only when the root itself cannot be projected. When `diagnostics` is empty,
 * `normalizeSeparatedWidgetSource(separated).source` is structurally equal to the projected source.
 */
export interface SeparatedWidgetSourceProjection {
	readonly separated: SeparatedWidgetSource | null
	readonly diagnostics: readonly SeparatedWidgetSourceDiagnostic[]
}

/** Result of explicit separated-source normalization. */
export interface SeparatedWidgetSourceNormalization {
	/**
	 * Best-effort nested source. It is `unknown` because malformed separated input intentionally
	 * remains recoverable rather than being asserted to satisfy `WidgetSource`.
	 */
	readonly source: unknown
	readonly diagnostics: readonly SeparatedWidgetSourceDiagnostic[]
}

interface ReadDataProperty {
	readonly found: boolean
	readonly accessible: boolean
	readonly value?: unknown
}

function readDataProperty(value: object, key: PropertyKey): ReadDataProperty {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (descriptor === undefined)
			return { found: false, accessible: true }
		if (!('value' in descriptor))
			return { found: true, accessible: false }
		return { found: true, accessible: true, value: descriptor.value }
	}
	catch {
		return { found: true, accessible: false }
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null)
		return false
	try {
		if (Array.isArray(value))
			return false
		const prototype = Object.getPrototypeOf(value)
		return prototype === Object.prototype || prototype === null
	}
	catch {
		return false
	}
}

function ownStringKeys(value: object): readonly string[] | null {
	try {
		return Reflect
			.ownKeys(value)
			.filter((key): key is string => typeof key === 'string')
	}
	catch {
		return null
	}
}

interface ReadArrayInfo {
	readonly isArray: boolean
	readonly accessible: boolean
	readonly length?: number
}

function readArrayInfo(value: unknown): ReadArrayInfo {
	try {
		if (!Array.isArray(value))
			return { isArray: false, accessible: true }
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
		if (
			lengthDescriptor === undefined
			|| !('value' in lengthDescriptor)
			|| typeof lengthDescriptor.value !== 'number'
			|| !Number.isSafeInteger(lengthDescriptor.value)
			|| lengthDescriptor.value < 0
		) {
			return { isArray: true, accessible: false }
		}
		return { isArray: true, accessible: true, length: lengthDescriptor.value }
	}
	catch {
		return { isArray: true, accessible: false }
	}
}

function freezeLocation(location: SeparatedSourceLocation): SeparatedSourceLocation {
	if ('path' in location && location.path !== undefined)
		return Object.freeze({ ...location, path: Object.freeze([...location.path]) }) as SeparatedSourceLocation
	return Object.freeze({ ...location }) as SeparatedSourceLocation
}

function freezeDiagnostic<Code extends SeparatedWidgetSourceDiagnosticCode>(
	code: Code,
	location: SeparatedSourceLocation,
	message: string,
	fields: Record<string, unknown> = {},
): SeparatedWidgetSourceDiagnostic {
	return Object.freeze({ code, location: freezeLocation(location), message, ...fields }) as unknown as SeparatedWidgetSourceDiagnostic
}

function cloneJsonValue(value: JsonValue): JsonValue {
	if (value === null || typeof value !== 'object')
		return value

	if (Array.isArray(value)) {
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
		if (lengthDescriptor === undefined || !('value' in lengthDescriptor) || typeof lengthDescriptor.value !== 'number')
			throw new TypeError('A valid JsonValue array must have an accessible length.')
		const copy: JsonValue[] = []
		copy.length = lengthDescriptor.value
		for (let index = 0; index < lengthDescriptor.value; index++) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
			if (descriptor === undefined || !('value' in descriptor))
				throw new TypeError('A valid JsonValue array cannot contain an accessor property.')
			Object.defineProperty(copy, String(index), {
				value: cloneJsonValue(descriptor.value),
				enumerable: descriptor.enumerable,
				writable: true,
				configurable: true,
			})
		}
		return Object.freeze(copy)
	}

	const copy: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string')
			throw new TypeError('A valid JsonValue object cannot contain a symbol property.')
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (descriptor === undefined || !('value' in descriptor))
			throw new TypeError('A valid JsonValue cannot contain an accessor property.')
		Object.defineProperty(copy, key, {
			value: cloneJsonValue(descriptor.value),
			enumerable: descriptor.enumerable,
			writable: true,
			configurable: true,
		})
	}
	return Object.freeze(copy)
}

function copyRecoveryValue(value: unknown): unknown {
	try {
		return isJsonValue(value) ? cloneJsonValue(value) : value
	}
	catch {
		return undefined
	}
}

function diagnosticPath(path: readonly PropertyKey[], key: PropertyKey): readonly PropertyKey[] {
	return [...path, key]
}

/** The own keys of an authored widget node; everything else cannot be carried by the separated representation. */
const SOURCE_WIDGET_FIELDS: ReadonlySet<PropertyKey> = new Set(['id', 'type', 'config', 'slots', 'meta'])

/**
 * Projects canonical nested authored source into the explicit separated representation.
 *
 * The input is `unknown`: projection never throws on malformed input. Everything it cannot project
 * faithfully (a malformed shape, a duplicate id, a non-JSON `config`/`meta`, a cyclic or too deep tree, an
 * unrecognized field) is reported as a diagnostic located by its path in the input (`area: 'source'`), and
 * the unprojectable part is left out of the best-effort result. When `diagnostics` is empty,
 * `normalizeSeparatedWidgetSource(separated).source` is structurally equal to `source`.
 *
 * Projection preserves nested slot order and emits flat data in deterministic depth-first order.
 */
export function separateWidgetSource(source: unknown): SeparatedWidgetSourceProjection {
	const diagnostics: SeparatedWidgetSourceDiagnostic[] = []
	const widgets: SeparatedWidgetData[] = []
	const seenIds = new Set<WidgetId>()
	const activeNodes = new Set<object>()

	const addDiagnostic = (
		code: SeparatedWidgetSourceDiagnosticCode,
		path: readonly PropertyKey[],
		message: string,
		fields?: Record<string, unknown>,
	): void => {
		diagnostics.push(freezeDiagnostic(code, { area: 'source', path }, message, fields))
	}

	function readJsonField(node: Record<string, unknown>, key: 'config' | 'meta', path: readonly PropertyKey[], reason: 'invalid-config' | 'invalid-meta'): { readonly present: boolean, readonly value?: JsonValue } {
		const property = readDataProperty(node, key)
		if (!property.found)
			return { present: false }
		if (!property.accessible || !isJsonValue(property.value)) {
			addDiagnostic('invalid-separated-widget', diagnosticPath(path, key), `Widget "${key}" must be an accessible JSON value.`, { reason })
			return { present: false }
		}
		try {
			return { present: true, value: cloneJsonValue(property.value) }
		}
		catch {
			addDiagnostic('invalid-separated-widget', diagnosticPath(path, key), `Widget "${key}" must be an accessible JSON value.`, { reason })
			return { present: false }
		}
	}

	function projectNode(value: unknown, path: readonly PropertyKey[]): SeparatedWidgetStructure | null {
		if (!isPlainObject(value)) {
			addDiagnostic('invalid-separated-structure', path, 'Widget source must be a plain object.', { reason: 'invalid-node' })
			return null
		}
		// Same boundary as Blueprint recovery: this node's own container is nested inside `path.length` others.
		if (path.length >= MAX_JSON_DEPTH) {
			addDiagnostic('invalid-separated-structure', path, `Widget source is nested deeper than the maximum supported depth (${MAX_JSON_DEPTH}).`, { reason: 'max-depth-exceeded' })
			return null
		}
		if (activeNodes.has(value)) {
			addDiagnostic('invalid-separated-structure', path, 'Widget source contains a cyclic reference; the repeated node was omitted.', { reason: 'invalid-node' })
			return null
		}

		const idProperty = readDataProperty(value, 'id')
		if (!idProperty.found || !idProperty.accessible || typeof idProperty.value !== 'string') {
			addDiagnostic('invalid-separated-widget', diagnosticPath(path, 'id'), 'Widget source must have a string id.', { reason: 'invalid-id' })
			return null
		}
		const id = idProperty.value

		activeNodes.add(value)
		try {
			const typeProperty = readDataProperty(value, 'type')
			const hasType = typeProperty.found && typeProperty.accessible && typeof typeProperty.value === 'string'
			if (!hasType)
				addDiagnostic('invalid-separated-widget', diagnosticPath(path, 'type'), 'Widget source must have a string type.', { reason: 'invalid-type' })

			// The flat list keeps duplicate ids observable, but its first entry wins when normalized, so only the first
			// occurrence can carry data: a later one would silently take the first one's type and config back.
			const duplicate = seenIds.has(id)
			if (duplicate)
				addDiagnostic('duplicate-widget-id', diagnosticPath(path, 'id'), `Widget source id "${id}" occurs more than once.`, { widgetId: id })
			seenIds.add(id)

			let keys: readonly PropertyKey[]
			try {
				keys = Reflect.ownKeys(value)
			}
			catch {
				keys = []
			}
			for (const key of keys) {
				if (!SOURCE_WIDGET_FIELDS.has(key))
					addDiagnostic('invalid-separated-widget', diagnosticPath(path, key), `Widget field "${String(key)}" cannot be carried by the separated representation.`, { reason: 'unexpected-field' })
			}

			const config = readJsonField(value, 'config', path, 'invalid-config')
			const meta = readJsonField(value, 'meta', path, 'invalid-meta')
			if (hasType && !duplicate) {
				const data: { id: WidgetId, type: string, config?: JsonValue, meta?: JsonValue } = { id, type: typeProperty.value as string }
				if (config.present)
					data.config = config.value
				if (meta.present)
					data.meta = meta.value
				widgets.push(Object.freeze(data))
			}

			const structure: { id: WidgetId, slots?: Record<string, readonly SeparatedWidgetStructure[]> } = { id }
			const slotsProperty = readDataProperty(value, 'slots')
			const slotsPath = diagnosticPath(path, 'slots')
			if (slotsProperty.found) {
				if (!slotsProperty.accessible || !isPlainObject(slotsProperty.value)) {
					addDiagnostic('invalid-separated-structure', slotsPath, 'Widget slots must be an accessible plain object.', { reason: 'invalid-slots' })
				}
				else {
					const slotNames = ownStringKeys(slotsProperty.value)
					if (slotNames === null) {
						addDiagnostic('invalid-separated-structure', slotsPath, 'Widget slots could not be inspected safely.', { reason: 'invalid-slots' })
					}
					else {
						const slots: Record<string, readonly SeparatedWidgetStructure[]> = Object.create(null) as Record<string, readonly SeparatedWidgetStructure[]>
						for (const slot of slotNames) {
							const slotPath = diagnosticPath(slotsPath, slot)
							const slotProperty = readDataProperty(slotsProperty.value, slot)
							const slotArray = readArrayInfo(slotProperty.value)
							if (!slotProperty.found || !slotProperty.accessible || !slotArray.isArray || !slotArray.accessible) {
								addDiagnostic('invalid-separated-structure', slotPath, 'Widget slot must be an Array.', { reason: 'invalid-slot-children' })
								continue
							}

							const children: SeparatedWidgetStructure[] = []
							const childArray = slotProperty.value as readonly unknown[]
							for (let index = 0; index < slotArray.length!; index++) {
								const childPath = diagnosticPath(slotPath, index)
								const childProperty = readDataProperty(childArray, String(index))
								if (!childProperty.found || !childProperty.accessible) {
									addDiagnostic('invalid-separated-structure', childPath, 'Widget slot child could not be inspected safely.', { reason: 'invalid-slot-children' })
									continue
								}
								const child = projectNode(childProperty.value, childPath)
								if (child !== null)
									children.push(child)
							}
							slots[slot] = Object.freeze(children)
						}
						structure.slots = slots
					}
				}
			}
			return Object.freeze(structure)
		}
		finally {
			activeNodes.delete(value)
		}
	}

	const structure = projectNode(source, [])
	return Object.freeze({
		separated: structure === null ? null : Object.freeze({ structure, widgets: Object.freeze(widgets) }),
		diagnostics: Object.freeze(diagnostics),
	})
}

/**
 * Normalizes an explicitly supplied separated representation into a best-effort nested source.
 *
 * Normalization is deterministic and non-destructive: the first flat entry for an ID wins;
 * missing data creates a partial node; unused data is never guessed into the tree; and repeated
 * structural occurrences retain their available data/subtree while omitting the repeated ID.
 */
export function normalizeSeparatedWidgetSource(input: unknown): SeparatedWidgetSourceNormalization {
	const diagnostics: SeparatedWidgetSourceDiagnostic[] = []
	const dataById = new Map<WidgetId, { readonly index: number, readonly value: Record<string, unknown> }>()
	const usedData = new Set<number>()

	const addDiagnostic = (
		code: SeparatedWidgetSourceDiagnosticCode,
		location: SeparatedSourceLocation,
		message: string,
		fields?: Record<string, unknown>,
	): void => {
		diagnostics.push(freezeDiagnostic(code, location, message, fields))
	}

	const envelope = isPlainObject(input) ? input : null
	const structureProperty = envelope === null ? { found: false, accessible: false } : readDataProperty(envelope, 'structure')
	const widgetsProperty = envelope === null ? { found: false, accessible: false } : readDataProperty(envelope, 'widgets')

	if (envelope === null || !structureProperty.found || !structureProperty.accessible) {
		addDiagnostic(
			'invalid-separated-source',
			{ area: 'structure', path: [] },
			'separated source must contain an accessible structure root.',
			{ reason: 'missing-structure' },
		)
	}

	const widgetsArray = readArrayInfo(widgetsProperty.value)
	if (!widgetsProperty.found || !widgetsProperty.accessible || !widgetsArray.isArray || !widgetsArray.accessible) {
		addDiagnostic(
			'invalid-separated-source',
			{ area: 'widgets' },
			'separated source widgets must be an Array.',
			{ reason: 'invalid-widgets' },
		)
	}

	if (widgetsArray.isArray && widgetsArray.accessible) {
		const widgets = widgetsProperty.value as readonly unknown[]
		for (let index = 0; index < widgetsArray.length!; index++) {
			const location: SeparatedSourceLocation = { area: 'widgets', index }
			const entryProperty = readDataProperty(widgets, String(index))
			if (!entryProperty.found || !entryProperty.accessible || !isPlainObject(entryProperty.value)) {
				addDiagnostic('invalid-separated-widget', location, 'flat Widget data entry must be a data object.', { reason: 'invalid-entry' })
				continue
			}

			const entry = entryProperty.value
			const idProperty = readDataProperty(entry, 'id')
			if (!idProperty.found || !idProperty.accessible || typeof idProperty.value !== 'string') {
				addDiagnostic('invalid-separated-widget', { ...location, path: ['id'] }, 'flat Widget data entry must have a string id.', { reason: 'invalid-id' })
				continue
			}

			const typeProperty = readDataProperty(entry, 'type')
			if (!typeProperty.found || !typeProperty.accessible || typeof typeProperty.value !== 'string')
				addDiagnostic('invalid-separated-widget', { ...location, path: ['type'] }, 'flat Widget data entry must have a string type.', { reason: 'invalid-type' })

			const id = idProperty.value
			if (dataById.has(id)) {
				addDiagnostic('duplicate-widget-id', location, `flat Widget data id "${id}" occurs more than once.`, { widgetId: id })
				continue
			}
			dataById.set(id, { index, value: entry })
		}
	}

	const seenStructureIds = new Set<WidgetId>()
	const activeStructureNodes = new Set<object>()

	function normalizeNode(value: unknown, path: readonly PropertyKey[]): unknown {
		if (!isPlainObject(value)) {
			addDiagnostic('invalid-separated-structure', { area: 'structure', path }, 'structure entry must be an object.', { reason: 'invalid-node' })
			return value
		}

		// Same boundary as Blueprint recovery: this node's own container is nested inside `path.length` others.
		if (path.length >= MAX_JSON_DEPTH) {
			addDiagnostic('invalid-separated-structure', { area: 'structure', path }, `structure is nested deeper than the maximum supported depth (${MAX_JSON_DEPTH}); the node was omitted.`, { reason: 'max-depth-exceeded' })
			return Object.create(null)
		}

		const objectValue = value as object
		if (activeStructureNodes.has(objectValue)) {
			addDiagnostic('invalid-separated-structure', { area: 'structure', path }, 'structure contains a cyclic reference; the repeated node was omitted.', { reason: 'invalid-node' })
			return Object.create(null)
		}
		activeStructureNodes.add(objectValue)

		try {
			const idProperty = readDataProperty(value, 'id')
			const rawId = idProperty.accessible ? idProperty.value : undefined
			const hasStringId = idProperty.found && idProperty.accessible && typeof rawId === 'string'
			const repeated = hasStringId && seenStructureIds.has(rawId)
			if (hasStringId && !repeated)
				seenStructureIds.add(rawId)

			const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>
			if (repeated) {
				addDiagnostic(
					'duplicate-structure-id',
					{ area: 'structure', path: diagnosticPath(path, 'id') },
					`structure id "${rawId}" occurs more than once; the later occurrence is de-identified.`,
					{ widgetId: rawId },
				)
			}
			else if (idProperty.found && idProperty.accessible) {
				output.id = copyRecoveryValue(rawId)
				if (!hasStringId)
					addDiagnostic('invalid-separated-structure', { area: 'structure', path: diagnosticPath(path, 'id') }, 'structure entry id must be a string.', { reason: 'invalid-node' })
			}
			else if (!idProperty.found || !idProperty.accessible) {
				addDiagnostic('invalid-separated-structure', { area: 'structure', path: diagnosticPath(path, 'id') }, 'structure entry must have an accessible string id.', { reason: 'invalid-node' })
			}

			if (hasStringId) {
				const data = dataById.get(rawId)
				if (data === undefined) {
					if (!repeated)
						addDiagnostic('missing-widget-data', { area: 'structure', path: diagnosticPath(path, 'id') }, `no flat Widget data exists for structure id "${rawId}".`, { widgetId: rawId })
				}
				else {
					usedData.add(data.index)
					const typeProperty = readDataProperty(data.value, 'type')
					if (typeProperty.found && typeProperty.accessible)
						output.type = copyRecoveryValue(typeProperty.value)
					const configProperty = readDataProperty(data.value, 'config')
					if (configProperty.found && configProperty.accessible)
						output.config = copyRecoveryValue(configProperty.value)
					else if (configProperty.found && !configProperty.accessible)
						addDiagnostic('invalid-separated-widget', { area: 'widgets', index: data.index, path: ['config'] }, 'flat Widget data config could not be inspected safely.', { reason: 'invalid-entry' })
					const metaProperty = readDataProperty(data.value, 'meta')
					if (metaProperty.found && metaProperty.accessible)
						output.meta = copyRecoveryValue(metaProperty.value)
					else if (metaProperty.found && !metaProperty.accessible)
						addDiagnostic('invalid-separated-widget', { area: 'widgets', index: data.index, path: ['meta'] }, 'flat Widget data meta could not be inspected safely.', { reason: 'invalid-entry' })
				}
			}

			const slotsProperty = readDataProperty(value, 'slots')
			if (slotsProperty.found && !slotsProperty.accessible) {
				addDiagnostic('invalid-separated-structure', { area: 'structure', path: diagnosticPath(path, 'slots') }, 'structure slots could not be inspected safely.', { reason: 'invalid-slots' })
			}
			else if (slotsProperty.found && slotsProperty.accessible) {
				if (!isPlainObject(slotsProperty.value)) {
					output.slots = copyRecoveryValue(slotsProperty.value)
					addDiagnostic('invalid-separated-structure', { area: 'structure', path: diagnosticPath(path, 'slots') }, 'structure slots must be an object.', { reason: 'invalid-slots' })
				}
				else {
					const outputSlots: Record<string, unknown> = Object.create(null) as Record<string, unknown>
					const slots = ownStringKeys(slotsProperty.value)
					if (slots === null) {
						addDiagnostic('invalid-separated-structure', { area: 'structure', path: diagnosticPath(path, 'slots') }, 'structure slots could not be inspected safely.', { reason: 'invalid-slots' })
					}
					else {
						for (const slot of slots) {
							const slotProperty = readDataProperty(slotsProperty.value, slot)
							const slotPath = diagnosticPath(diagnosticPath(path, 'slots'), slot)
							const slotArray = readArrayInfo(slotProperty.value)
							if (!slotProperty.found || !slotProperty.accessible || !slotArray.isArray || !slotArray.accessible) {
								if (slotProperty.found && slotProperty.accessible)
									outputSlots[slot] = copyRecoveryValue(slotProperty.value)
								addDiagnostic('invalid-separated-structure', { area: 'structure', path: slotPath }, 'structure slot must be an Array.', { reason: 'invalid-slot-children' })
								continue
							}

							const children: unknown[] = []
							const childArray = slotProperty.value as readonly unknown[]
							for (let index = 0; index < slotArray.length!; index++) {
								const childProperty = readDataProperty(childArray, String(index))
								children.push(childProperty.found && childProperty.accessible
									? normalizeNode(childProperty.value, [...slotPath, index])
									: undefined)
								if (!childProperty.found || !childProperty.accessible)
									addDiagnostic('invalid-separated-structure', { area: 'structure', path: [...slotPath, index] }, 'structure child could not be inspected safely.', { reason: 'invalid-slot-children' })
							}
							outputSlots[slot] = children
						}
						output.slots = outputSlots
					}
				}
			}

			return output
		}
		finally {
			activeStructureNodes.delete(objectValue)
		}
	}

	const normalizedSource = structureProperty.found && structureProperty.accessible
		? normalizeNode(structureProperty.value, [])
		: undefined

	for (const [widgetId, data] of dataById) {
		if (!usedData.has(data.index))
			addDiagnostic('unused-widget-data', { area: 'widgets', index: data.index }, `flat Widget data id "${widgetId}" is not referenced by structure.`, { widgetId })
	}

	return Object.freeze({
		source: normalizedSource,
		diagnostics: Object.freeze(diagnostics),
	})
}
