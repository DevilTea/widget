/**
 * JSON text locator: maps a source path (`['slots', 'questions', 0, 'config']`) onto character offsets of the
 * JSON text it was parsed from, and a `JSON.parse` failure message onto an offset.
 *
 * Core reports locations as source paths, never as text positions, and the Lab edits plain JSON text, so this
 * is the one place that bridges the two. It is framework-agnostic and never throws: text that does not parse
 * yields `null`, and a path that does not exist resolves to its deepest existing ancestor
 * (`exact: false`) so a caller can still point somewhere useful ("jump to the nearest node").
 */

export type JsonPathSegment = string | number
export type JsonPath = readonly JsonPathSegment[]

/** Half-open character range `[start, end)` of the text. */
export interface JsonSpan {
	readonly start: number
	readonly end: number
}

export interface JsonLocation {
	/** The value found at `resolvedPath`. */
	readonly value: JsonSpan
	/** The property key (quotes included) when the value is an object member; `null` for array items and the root. */
	readonly key: JsonSpan | null
	readonly kind: 'object' | 'array' | 'primitive'
	/** The path that was actually found: the requested path when `exact`, otherwise its deepest existing ancestor. */
	readonly resolvedPath: JsonPath
	readonly exact: boolean
}

interface JsonNode {
	readonly kind: 'object' | 'array' | 'primitive'
	readonly start: number
	readonly end: number
	readonly entries: readonly JsonEntry[]
	readonly items: readonly JsonNode[]
}

interface JsonEntry {
	readonly key: string
	readonly keySpan: JsonSpan
	readonly value: JsonNode
}

class JsonScanError extends Error {}

function parseJsonNode(text: string): JsonNode {
	let index = 0

	function skipWhitespace(): void {
		while (index < text.length && (text[index] === ' ' || text[index] === '\n' || text[index] === '\r' || text[index] === '\t'))
			index++
	}

	function scanString(): { value: string, span: JsonSpan } {
		const start = index
		if (text[index] !== '"')
			throw new JsonScanError()
		index++
		while (index < text.length && text[index] !== '"') {
			index += text[index] === '\\' ? 2 : 1
		}
		if (index >= text.length)
			throw new JsonScanError()
		index++
		return { value: JSON.parse(text.slice(start, index)) as string, span: { start, end: index } }
	}

	function scanValue(): JsonNode {
		skipWhitespace()
		const start = index
		const char = text[index]
		if (char === '{') {
			index++
			const entries: JsonEntry[] = []
			skipWhitespace()
			if (text[index] === '}') {
				index++
				return { kind: 'object', start, end: index, entries, items: [] }
			}
			for (;;) {
				skipWhitespace()
				const key = scanString()
				skipWhitespace()
				if (text[index] !== ':')
					throw new JsonScanError()
				index++
				entries.push({ key: key.value, keySpan: key.span, value: scanValue() })
				skipWhitespace()
				if (text[index] === ',') {
					index++
					continue
				}
				if (text[index] === '}') {
					index++
					return { kind: 'object', start, end: index, entries, items: [] }
				}
				throw new JsonScanError()
			}
		}
		if (char === '[') {
			index++
			const items: JsonNode[] = []
			skipWhitespace()
			if (text[index] === ']') {
				index++
				return { kind: 'array', start, end: index, entries: [], items }
			}
			for (;;) {
				items.push(scanValue())
				skipWhitespace()
				if (text[index] === ',') {
					index++
					continue
				}
				if (text[index] === ']') {
					index++
					return { kind: 'array', start, end: index, entries: [], items }
				}
				throw new JsonScanError()
			}
		}
		if (char === '"') {
			scanString()
			return { kind: 'primitive', start, end: index, entries: [], items: [] }
		}
		const literal = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(index, index + 64))
		if (literal === null)
			throw new JsonScanError()
		index += literal[0].length
		return { kind: 'primitive', start, end: index, entries: [], items: [] }
	}

	const root = scanValue()
	skipWhitespace()
	if (index !== text.length)
		throw new JsonScanError()
	return root
}

let memo: { readonly text: string, readonly root: JsonNode | null } | null = null

function parseMemoized(text: string): JsonNode | null {
	if (memo?.text === text)
		return memo.root
	let root: JsonNode | null
	try {
		root = parseJsonNode(text)
	}
	catch {
		root = null
	}
	memo = { text, root }
	return root
}

/** Locates `path` in `text`; `null` when `text` is not valid JSON. See the module header for partial matches. */
export function locateJsonPath(text: string, path: JsonPath): JsonLocation | null {
	const root = parseMemoized(text)
	if (root === null)
		return null

	let node = root
	let key: JsonSpan | null = null
	let depth = 0
	for (const segment of path) {
		let next: JsonNode | undefined
		let nextKey: JsonSpan | null = null
		if (node.kind === 'object' && typeof segment === 'string') {
			// `JSON.parse` keeps the last of duplicate keys, so does the lookup.
			const entry = node.entries.findLast(candidate => candidate.key === segment)
			next = entry?.value
			nextKey = entry?.keySpan ?? null
		}
		else if (node.kind === 'array' && typeof segment === 'number') {
			next = node.items[segment]
		}
		if (next === undefined)
			break
		node = next
		key = nextKey
		depth++
	}
	return {
		value: { start: node.start, end: node.end },
		key,
		kind: node.kind,
		resolvedPath: path.slice(0, depth),
		exact: depth === path.length,
	}
}

/** The `[start, end)` span of the member `name` of the object at `path` (key through value), or `null` when absent. */
export function locateJsonMember(text: string, path: JsonPath, name: string): JsonSpan | null {
	const location = locateJsonPath(text, [...path, name])
	if (location === null || !location.exact || location.key === null)
		return null
	return { start: location.key.start, end: location.value.end }
}

function offsetOfLineColumn(text: string, line: number, column: number): number {
	let offset = 0
	for (let current = 1; current < line; current++) {
		const next = text.indexOf('\n', offset)
		if (next === -1)
			return text.length
		offset = next + 1
	}
	return Math.min(text.length, offset + Math.max(0, column - 1))
}

/**
 * The character offset a `JSON.parse` `SyntaxError` message points at. V8 reports `at position N`
 * (`(line L column C)` in recent versions); Firefox reports `at line L column C`. A message without a
 * position (Safari) falls back to the end of the text. The message itself is never altered or classified.
 */
export function jsonSyntaxErrorOffset(message: string, text: string): number {
	const position = /\bposition (\d+)/.exec(message)
	if (position !== null)
		return Math.min(Number(position[1]), text.length)
	const lineColumn = /\bline (\d+) column (\d+)/.exec(message)
	if (lineColumn !== null)
		return offsetOfLineColumn(text, Number(lineColumn[1]), Number(lineColumn[2]))
	return text.length
}

/** A one-character span at the syntax error (or the last character when the error is at the very end). */
export function jsonSyntaxErrorSpan(message: string, text: string): JsonSpan {
	const offset = jsonSyntaxErrorOffset(message, text)
	if (text.length === 0)
		return { start: 0, end: 0 }
	return offset >= text.length
		? { start: text.length - 1, end: text.length }
		: { start: offset, end: offset + 1 }
}

/** End offset of the line containing `offset` (the position of its `\n`, or the text end). */
export function endOfLine(text: string, offset: number): number {
	const next = text.indexOf('\n', offset)
	return next === -1 ? text.length : (text[next - 1] === '\r' ? next - 1 : next)
}
