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
import type { WidgetSource } from './internal/contract'
import type { JsonValue } from './json'
import type { AnyWidgetPluginTuple } from './plugin'
import type { WidgetId } from './types'
import { isJsonValue } from './json'

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
}

/**
 * Explicit alternative source representation: a nested structural tree plus a flat data list.
 * The list is intentionally not a map so duplicate IDs remain observable and diagnosable.
 */
export interface SeparatedWidgetSource {
	readonly structure: SeparatedWidgetStructure
	readonly widgets: readonly SeparatedWidgetData[]
}

/** A representation-aware source location, independent from Blueprint semantic locations. */
export type SeparatedSourceLocation
	= | {
		readonly area: 'widgets'
		readonly index: number
		readonly path?: readonly PropertyKey[]
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
		readonly reason: 'invalid-node' | 'invalid-slots' | 'invalid-slot-children'
	})
	| (DiagnosticBase<'invalid-separated-widget', SeparatedSourceLocation> & {
		readonly reason: 'invalid-entry' | 'invalid-id' | 'invalid-type'
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

/**
 * Projects canonical nested authored source into the explicit separated representation.
 * Projection preserves nested slot order and emits flat data in deterministic depth-first order.
 */
export function separateWidgetSource<const Plugins extends AnyWidgetPluginTuple>(
	source: WidgetSource<Plugins>,
): SeparatedWidgetSource {
	const widgets: SeparatedWidgetData[] = []

	function projectNode(node: WidgetSource<Plugins>): SeparatedWidgetStructure {
		const value = node as unknown as Record<string, unknown>
		const id = value.id as WidgetId
		const data: SeparatedWidgetData = {
			id,
			type: value.type as string,
		}
		if (Object.hasOwn(value, 'config'))
			(data as { config?: JsonValue }).config = cloneJsonValue(value.config as JsonValue)
		widgets.push(Object.freeze(data))

		const structure: { id: WidgetId, slots?: Record<string, readonly SeparatedWidgetStructure[]> } = { id }
		if (Object.hasOwn(value, 'slots')) {
			const slotsValue = value.slots as Record<string, readonly WidgetSource<Plugins>[]>
			const slots: Record<string, readonly SeparatedWidgetStructure[]> = Object.create(null) as Record<string, readonly SeparatedWidgetStructure[]>
			const slotNames = ownStringKeys(slotsValue)
			if (slotNames === null)
				throw new TypeError('WidgetSource slots could not be inspected safely.')
			for (const slot of slotNames) {
				const children = slotsValue[slot]!
				slots[slot] = Object.freeze(children.map(projectNode))
			}
			structure.slots = slots
		}
		return Object.freeze(structure)
	}

	const structure = projectNode(source)
	return Object.freeze({ structure, widgets: Object.freeze(widgets) })
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
			' separated source must contain an accessible structure root.',
			{ reason: 'missing-structure' },
		)
	}

	const widgetsArray = readArrayInfo(widgetsProperty.value)
	if (!widgetsProperty.found || !widgetsProperty.accessible || !widgetsArray.isArray || !widgetsArray.accessible) {
		addDiagnostic(
			'invalid-separated-source',
			{ area: 'widgets', index: 0 },
			' separated source widgets must be an Array.',
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
