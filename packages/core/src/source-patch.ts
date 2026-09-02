import type { JsonValue } from './json'
import { isJsonValue, jsonEqual } from './json'

export type SourcePath = readonly (string | number)[] | string

export type SourcePatchOperation
	= | { readonly op: 'add', readonly path: SourcePath, readonly value: JsonValue }
		| { readonly op: 'remove', readonly path: SourcePath }
		| { readonly op: 'replace', readonly path: SourcePath, readonly value: JsonValue }
		| { readonly op: 'move', readonly from: SourcePath, readonly path: SourcePath }
		| { readonly op: 'copy', readonly from: SourcePath, readonly path: SourcePath }
		| { readonly op: 'test', readonly path: SourcePath, readonly value: JsonValue }

export type SourcePatch = readonly SourcePatchOperation[]

export type SourcePatchOperationFailureCode
	= | 'invalid-path'
		| 'path-not-found'
		| 'path-not-traversable'
		| 'invalid-array-index'
		| 'invalid-move-target'
		| 'test-failed'
		| 'source-access-failed'

export interface SourcePatchOperationFailure {
	readonly code: SourcePatchOperationFailureCode
	readonly operationIndex: number
	readonly message: string
}

interface ParsedPath {
	readonly segments: readonly (string | number)[]
	readonly append: boolean
	readonly pointer: boolean
}

interface PatchError {
	readonly code: SourcePatchOperationFailureCode
	readonly message: string
}

type PatchResult<T> = { readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: PatchError }

const PATCH_ERROR_MESSAGES: Record<SourcePatchOperationFailureCode, string> = {
	'invalid-path': 'The SourcePath is malformed.',
	'path-not-found': 'The SourcePath does not identify an existing location.',
	'path-not-traversable': 'The SourcePath passes through a non-traversable value.',
	'invalid-array-index': 'The SourcePath contains an invalid Array index.',
	'invalid-move-target': 'The move destination is invalid relative to its source.',
	'test-failed': 'The test operation did not match the addressed value.',
	'source-access-failed': 'The source could not be inspected safely.',
}

function failure(code: SourcePatchOperationFailureCode, message = PATCH_ERROR_MESSAGES[code]): PatchResult<never> {
	return { ok: false, error: { code, message } }
}

function parsePath(path: unknown): PatchResult<ParsedPath> {
	if (typeof path === 'string') {
		if (path === '')
			return { ok: true, value: { segments: [], append: false, pointer: true } }
		if (!path.startsWith('/'))
			return failure('invalid-path')

		const rawSegments = path.slice(1)
			.split('/')
		const segments: string[] = []
		for (const rawSegment of rawSegments) {
			let segment = ''
			for (let index = 0; index < rawSegment.length; index++) {
				const character = rawSegment[index]
				if (character !== '~') {
					segment += character
					continue
				}
				const escape = rawSegment[++index]
				if (escape === '0')
					segment += '~'
				else if (escape === '1')
					segment += '/'
				else
					return failure('invalid-path')
			}
			segments.push(segment)
		}
		return { ok: true, value: { segments, append: segments.at(-1) === '-', pointer: true } }
	}

	if (!Array.isArray(path))
		return failure('invalid-path')

	const segments: (string | number)[] = []
	for (const segment of path) {
		if (typeof segment === 'string')
			segments.push(segment)
		else if (typeof segment === 'number' && Number.isFinite(segment))
			segments.push(segment)
		else
			return failure('invalid-path')
	}
	return { ok: true, value: { segments, append: false, pointer: false } }
}

type StructuralContainerKind = 'array' | 'object' | 'opaque'

function inspectStructuralContainer(value: unknown): PatchResult<StructuralContainerKind> {
	if (typeof value !== 'object' || value === null)
		return { ok: true, value: 'opaque' }
	try {
		if (Array.isArray(value))
			return { ok: true, value: 'array' }
		const prototype = Object.getPrototypeOf(value)
		return { ok: true, value: prototype === Object.prototype || prototype === null ? 'object' : 'opaque' }
	}
	catch {
		return failure('source-access-failed')
	}
}

function isCanonicalArrayIndex(key: string): boolean {
	return /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < 4_294_967_295
}

function getArrayIndex(path: ParsedPath, segment: string | number, allowAppend = false): PatchResult<number | null> {
	const key = String(segment)
	if (!path.pointer && typeof segment === 'string' && !isCanonicalArrayIndex(key))
		return { ok: true, value: null }
	if (key === '-' && allowAppend)
		return { ok: true, value: null }
	if (key === '-' || !isCanonicalArrayIndex(key))
		return failure('invalid-array-index')
	return { ok: true, value: Number(key) }
}

function ownDescriptor(container: object, key: string): PatchResult<PropertyDescriptor | undefined> {
	try {
		return { ok: true, value: Object.getOwnPropertyDescriptor(container, key) }
	}
	catch {
		return failure('source-access-failed')
	}
}

function readOwn(container: object, key: string): PatchResult<{ readonly descriptor: PropertyDescriptor, readonly value: unknown }> {
	const descriptor = ownDescriptor(container, key)
	if (!descriptor.ok)
		return descriptor
	if (descriptor.value === undefined)
		return failure('path-not-found')
	if (!('value' in descriptor.value))
		return failure('path-not-traversable', 'The addressed source property is accessor-backed.')
	return { ok: true, value: { descriptor: descriptor.value, value: descriptor.value.value } }
}

function readArrayLength(array: object): PatchResult<number> {
	const descriptor = ownDescriptor(array, 'length')
	if (!descriptor.ok)
		return descriptor
	if (descriptor.value === undefined || !('value' in descriptor.value) || typeof descriptor.value.value !== 'number')
		return failure('source-access-failed')
	return { ok: true, value: descriptor.value.value }
}

function readAt(source: unknown, path: ParsedPath): PatchResult<unknown> {
	let current = source
	for (let index = 0; index < path.segments.length; index++) {
		const segment = path.segments[index]!
		const key = String(segment)
		const container = inspectStructuralContainer(current)
		if (!container.ok)
			return container
		if (container.value === 'opaque')
			return failure('path-not-traversable')
		if (container.value === 'array') {
			const indexResult = getArrayIndex(path, segment)
			if (!indexResult.ok)
				return indexResult
			const length = readArrayLength(current as object)
			if (!length.ok)
				return length
			if (indexResult.value !== null && indexResult.value >= length.value)
				return failure('invalid-array-index')
		}
		const result = readOwn(current as object, key)
		if (!result.ok)
			return result
		current = result.value.value
	}
	return { ok: true, value: current }
}

function ownEntries(container: object): PatchResult<readonly (readonly [PropertyKey, PropertyDescriptor])[]> {
	try {
		const entries: Array<readonly [PropertyKey, PropertyDescriptor]> = []
		for (const key of Reflect.ownKeys(container)) {
			const descriptor = Object.getOwnPropertyDescriptor(container, key)
			if (descriptor === undefined)
				return failure('source-access-failed')
			entries.push([key, descriptor])
		}
		return { ok: true, value: entries }
	}
	catch {
		return failure('source-access-failed')
	}
}

function define(target: object, key: PropertyKey, descriptor: PropertyDescriptor): PatchResult<void> {
	try {
		Object.defineProperty(target, key, descriptor)
		return { ok: true, value: undefined }
	}
	catch {
		return failure('source-access-failed')
	}
}

function createContainer(source: object, lengthDelta = 0): PatchResult<object> {
	try {
		if (Array.isArray(source)) {
			const array: unknown[] = []
			array.length = source.length + lengthDelta
			return { ok: true, value: array }
		}
		return { ok: true, value: Object.create(Object.getPrototypeOf(source)) }
	}
	catch {
		return failure('source-access-failed')
	}
}

function rebuildObject(
	container: object,
	segment: string | number,
	action: 'add' | 'remove' | 'replace',
	value?: unknown,
	pointer = true,
	allowArrayAppend = false,
): PatchResult<object> {
	const entries = ownEntries(container)
	if (!entries.ok)
		return entries

	const containerKind = inspectStructuralContainer(container)
	if (!containerKind.ok)
		return containerKind
	const isArray = containerKind.value === 'array'
	const arrayLength = isArray ? readArrayLength(container) : { ok: true as const, value: 0 }
	if (!arrayLength.ok)
		return arrayLength
	const key = String(segment)
	const append = isArray && pointer && segment === '-' && allowArrayAppend
	const effectiveKey = append ? String(arrayLength.value) : key
	const arrayIndexResult = isArray
		? getArrayIndex({ segments: [], append: false, pointer }, segment, allowArrayAppend)
		: { ok: true as const, value: null }
	if (!arrayIndexResult.ok)
		return arrayIndexResult
	const arrayIndex = append ? arrayLength.value : arrayIndexResult.value
	if (isArray && pointer && segment === '-' && !allowArrayAppend)
		return failure('invalid-array-index')
	if (isArray && arrayIndex !== null) {
		if (action === 'add' && arrayIndex > arrayLength.value)
			return failure('invalid-array-index')
		if (action !== 'add' && arrayIndex >= arrayLength.value)
			return failure('invalid-array-index')
	}
	const exists = entries.value.some(([entryKey]) => entryKey === effectiveKey)
	if (action !== 'add' && !exists)
		return failure('path-not-found')

	const target = createContainer(container, isArray && arrayIndex !== null ? action === 'add' ? 1 : -1 : 0)
	if (!target.ok)
		return target

	for (const [entryKey, descriptor] of entries.value) {
		if (entryKey === 'length' && isArray)
			continue
		if (action !== 'add' && entryKey === effectiveKey)
			continue

		let outputKey = entryKey
		if (isArray && typeof entryKey === 'string' && arrayIndex !== null && isCanonicalArrayIndex(entryKey)) {
			const entryIndex = Number(entryKey)
			if (action === 'add' && entryIndex >= arrayIndex)
				outputKey = String(entryIndex + 1)
			else if (action === 'remove' && entryIndex > arrayIndex)
				outputKey = String(entryIndex - 1)
			else if (action === 'remove' && entryIndex === arrayIndex)
				continue
		}

		const result = define(target.value, outputKey, descriptor)
		if (!result.ok)
			return result
	}

	if (action !== 'remove') {
		const result = define(target.value, isArray && arrayIndex !== null && action === 'add' ? String(arrayIndex) : effectiveKey, {
			value,
			enumerable: true,
			writable: true,
			configurable: true,
		})
		if (!result.ok)
			return result
	}

	return { ok: true, value: target.value }
}

function modifyAt(
	source: unknown,
	path: ParsedPath,
	modify: (container: object, segment: string | number) => PatchResult<object>,
): PatchResult<unknown> {
	if (path.segments.length === 0)
		return modify({ value: source } as object, 'value')

	function visit(container: unknown, index: number): PatchResult<object> {
		const containerKind = inspectStructuralContainer(container)
		if (!containerKind.ok)
			return containerKind
		if (containerKind.value === 'opaque')
			return failure('path-not-traversable')
		const segment = path.segments[index]!
		const key = String(segment)
		if (index === path.segments.length - 1)
			return modify(container as object, segment)
		if (containerKind.value === 'array') {
			const indexResult = getArrayIndex(path, segment)
			if (!indexResult.ok)
				return indexResult
			const length = readArrayLength(container as object)
			if (!length.ok)
				return length
			if (indexResult.value !== null && indexResult.value >= length.value)
				return failure('invalid-array-index')
		}
		const child = readOwn(container as object, key)
		if (!child.ok)
			return child
		const next = visit(child.value.value, index + 1)
		if (!next.ok)
			return next
		return rebuildObject(container as object, segment, 'replace', next.value, path.pointer)
	}

	const result = visit(source, 0)
	return result
}

function modifyRoot(source: unknown, value: unknown): PatchResult<unknown> {
	void source
	return { ok: true, value }
}

function copyValue(value: unknown): PatchResult<unknown> {
	if (value === null || typeof value !== 'object')
		return { ok: true, value }
	const containerKind = inspectStructuralContainer(value)
	if (!containerKind.ok)
		return containerKind
	if (containerKind.value === 'opaque')
		return { ok: true, value }

	const seen = new WeakMap<object, object>()
	function clone(current: object): PatchResult<object> {
		const previous = seen.get(current)
		if (previous !== undefined)
			return { ok: true, value: previous }
		const result = createContainer(current)
		if (!result.ok)
			return result
		seen.set(current, result.value)
		const entries = ownEntries(current)
		if (!entries.ok)
			return entries
		const currentKind = inspectStructuralContainer(current)
		if (!currentKind.ok)
			return currentKind
		for (const [key, descriptor] of entries.value) {
			if (key === 'length' && currentKind.value === 'array')
				continue
			if (!('value' in descriptor))
				return failure('path-not-traversable', 'Accessor-backed source properties cannot be copied.')
			const child = descriptor.value
			let copied: PatchResult<unknown> = { ok: true, value: child }
			if (child !== null && typeof child === 'object') {
				const childKind = inspectStructuralContainer(child)
				if (!childKind.ok)
					return childKind
				if (childKind.value !== 'opaque')
					copied = clone(child)
			}
			if (!copied.ok)
				return copied
			const defined = define(result.value, key, { ...descriptor, value: copied.value })
			if (!defined.ok)
				return defined
		}
		return result
	}

	return clone(value)
}

function structurallyEqual(left: unknown, right: unknown): boolean {
	const matched = new WeakMap<object, object>()

	function equal(currentLeft: unknown, currentRight: unknown): boolean {
		if (Object.is(currentLeft, currentRight))
			return true
		if (typeof currentLeft !== 'object' || currentLeft === null || typeof currentRight !== 'object' || currentRight === null)
			return false
		const leftKind = inspectStructuralContainer(currentLeft)
		const rightKind = inspectStructuralContainer(currentRight)
		if (!leftKind.ok || !rightKind.ok)
			return false
		if (leftKind.value === 'opaque' || rightKind.value === 'opaque')
			return false

		const previous = matched.get(currentLeft)
		if (previous !== undefined)
			return previous === currentRight
		matched.set(currentLeft, currentRight)

		try {
			if (Object.getPrototypeOf(currentLeft) !== Object.getPrototypeOf(currentRight))
				return false

			const leftKeys = Reflect.ownKeys(currentLeft)
			const rightKeys = Reflect.ownKeys(currentRight)
			if (leftKeys.length !== rightKeys.length)
				return false

			for (const key of leftKeys) {
				if (!Object.hasOwn(currentRight, key))
					return false
				const leftDescriptor = Object.getOwnPropertyDescriptor(currentLeft, key)
				const rightDescriptor = Object.getOwnPropertyDescriptor(currentRight, key)
				if (leftDescriptor === undefined || rightDescriptor === undefined)
					return false

				const leftData = 'value' in leftDescriptor
				const rightData = 'value' in rightDescriptor
				if (leftData !== rightData)
					return false
				if (leftData) {
					if (!equal(leftDescriptor.value, rightDescriptor.value))
						return false
				}
				else if (leftDescriptor.get !== rightDescriptor.get || leftDescriptor.set !== rightDescriptor.set) {
					return false
				}
			}
			return true
		}
		catch {
			return false
		}
	}

	return equal(left, right)
}

function samePathSegment(left: string | number, right: string | number): boolean {
	return String(left) === String(right)
}

function isPrefix(prefix: readonly (string | number)[], value: readonly (string | number)[]): boolean {
	return prefix.length < value.length && prefix.every((segment, index) => samePathSegment(segment, value[index]!))
}

function samePath(left: readonly (string | number)[], right: readonly (string | number)[]): boolean {
	return left.length === right.length && left.every((segment, index) => samePathSegment(segment, right[index]!))
}

function operationError(index: number, error: PatchError): SourcePatchOperationFailure {
	return Object.freeze({ code: error.code, operationIndex: index, message: error.message })
}

interface InternalAppliedSourcePatch {
	readonly changed: boolean
	readonly source: unknown
}

type InternalApplySourcePatchResult
	= { readonly ok: true, readonly value: InternalAppliedSourcePatch }
		| { readonly ok: false, readonly failure: SourcePatchOperationFailure }

export function applySourcePatch(source: unknown, patch: SourcePatch): InternalApplySourcePatchResult {
	if (!Array.isArray(patch))
		return { ok: false, failure: operationError(0, { code: 'invalid-path', message: 'SourcePatch must be an array.' }) }

	let working = source
	for (let operationIndex = 0; operationIndex < patch.length; operationIndex++) {
		const operation = patch[operationIndex] as unknown
		if (typeof operation !== 'object' || operation === null || !('op' in operation))
			return { ok: false, failure: operationError(operationIndex, { code: 'invalid-path', message: 'SourcePatch operation is malformed.' }) }

		const op = (operation as { op?: unknown }).op
		const pathResult = parsePath((operation as { path?: unknown }).path)
		if (!pathResult.ok)
			return { ok: false, failure: operationError(operationIndex, pathResult.error) }
		const path = pathResult.value

		let next: PatchResult<unknown>
		switch (op) {
			case 'add':
			case 'replace': {
				const value = (operation as { value?: unknown }).value
				if (!isJsonValue(value))
					return { ok: false, failure: operationError(operationIndex, { code: 'source-access-failed', message: 'SourcePatch operands must be JsonValue.' }) }
				const copied = copyValue(value)
				if (!copied.ok)
					return { ok: false, failure: operationError(operationIndex, copied.error) }
				if (path.segments.length === 0)
					next = modifyRoot(working, copied.value)
				else
					next = modifyAt(working, path, (container, segment) => rebuildObject(container, segment, op, copied.value, path.pointer, op === 'add' && path.append))
				break
			}
			case 'remove':
				if (path.segments.length === 0)
					return { ok: false, failure: operationError(operationIndex, { code: 'invalid-path', message: PATCH_ERROR_MESSAGES['invalid-path'] }) }
				else
					next = modifyAt(working, path, (container, segment) => rebuildObject(container, segment, 'remove', undefined, path.pointer))
				break
			case 'test': {
				const value = (operation as { value?: unknown }).value
				if (!isJsonValue(value))
					return { ok: false, failure: operationError(operationIndex, { code: 'source-access-failed', message: 'SourcePatch operands must be JsonValue.' }) }
				const actual = readAt(working, path)
				if (!actual.ok)
					return { ok: false, failure: operationError(operationIndex, actual.error) }
				if (!jsonEqual(actual.value, value))
					return { ok: false, failure: operationError(operationIndex, { code: 'test-failed', message: PATCH_ERROR_MESSAGES['test-failed'] }) }
				next = { ok: true, value: working }
				break
			}
			case 'copy':
			case 'move': {
				const fromResult = parsePath((operation as { from?: unknown }).from)
				if (!fromResult.ok)
					return { ok: false, failure: operationError(operationIndex, fromResult.error) }
				const from = fromResult.value
				if (op === 'move' && isPrefix(from.segments, path.segments))
					return { ok: false, failure: operationError(operationIndex, { code: 'invalid-move-target', message: PATCH_ERROR_MESSAGES['invalid-move-target'] }) }
				const sourceValue = readAt(working, from)
				if (!sourceValue.ok)
					return { ok: false, failure: operationError(operationIndex, sourceValue.error) }
				if (op === 'move' && samePath(from.segments, path.segments)) {
					next = { ok: true, value: working }
					break
				}
				const copied = copyValue(sourceValue.value)
				if (!copied.ok)
					return { ok: false, failure: operationError(operationIndex, copied.error) }
				if (op === 'copy') {
					next = path.segments.length === 0
						? modifyRoot(working, copied.value)
						: modifyAt(working, path, (container, segment) => rebuildObject(container, segment, 'add', copied.value, path.pointer, path.append))
					break
				}

				const removed = from.segments.length === 0
					? failure('invalid-path')
					: modifyAt(working, from, (container, segment) => rebuildObject(container, segment, 'remove', undefined, from.pointer))
				if (!removed.ok) {
					return { ok: false, failure: operationError(operationIndex, removed.error) }
				}
				next = path.segments.length === 0
					? modifyRoot(removed.value, copied.value)
					: modifyAt(removed.value, path, (container, segment) => rebuildObject(container, segment, 'add', copied.value, path.pointer, path.append))
				break
			}
			default:
				return { ok: false, failure: operationError(operationIndex, { code: 'invalid-path', message: 'SourcePatch operation is malformed.' }) }
		}

		if (!next.ok)
			return { ok: false, failure: operationError(operationIndex, next.error) }
		working = next.value
	}

	return { ok: true, value: { changed: !structurallyEqual(source, working), source: working } }
}
