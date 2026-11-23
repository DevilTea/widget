import { describe, expect, it } from 'vitest'
import { endOfLine, jsonSyntaxErrorOffset, jsonSyntaxErrorSpan, locateJsonMember, locateJsonPath, locateJsonValue, scanJsonSyntaxError } from './json-locate'

const text = `{
  "id": "root",
  "slots": {
    "items": [
      { "id": "a", "type": "Text", "config": { "text": "héllo \\"x\\"" } },
      { "id": "b", "type": "Counter" }
    ]
  },
  "meta": [1, -2.5e3, true, null]
}`

function slice(span: { start: number, end: number } | null | undefined): string | undefined {
	return span === null || span === undefined ? undefined : text.slice(span.start, span.end)
}

describe('locateJsonPath', () => {
	it('locates the root and object members with their keys', () => {
		const root = locateJsonPath(text, [])!
		expect(root)
			.toMatchObject({ kind: 'object', key: null, exact: true, resolvedPath: [] })
		expect(root.value)
			.toEqual({ start: 0, end: text.length })

		const id = locateJsonPath(text, ['id'])!
		expect(slice(id.value))
			.toBe('"root"')
		expect(slice(id.key))
			.toBe('"id"')
		expect(id.kind)
			.toBe('primitive')
	})

	it('locates array items and nested members, including strings with escapes and non-ASCII text', () => {
		const second = locateJsonPath(text, ['slots', 'items', 1])!
		expect(slice(second.value))
			.toBe('{ "id": "b", "type": "Counter" }')
		expect(second.key)
			.toBeNull()
		expect(second.kind)
			.toBe('object')

		const escaped = locateJsonPath(text, ['slots', 'items', 0, 'config', 'text'])!
		expect(slice(escaped.value))
			.toBe('"héllo \\"x\\""')

		expect(slice(locateJsonPath(text, ['meta', 1])!.value))
			.toBe('-2.5e3')
		expect(slice(locateJsonPath(text, ['meta', 3])!.value))
			.toBe('null')
	})

	it('resolves a missing path to its deepest existing ancestor and marks it inexact', () => {
		const location = locateJsonPath(text, ['slots', 'items', 5, 'type'])!
		expect(location.exact)
			.toBe(false)
		expect(location.resolvedPath)
			.toEqual(['slots', 'items'])
		expect(location.kind)
			.toBe('array')
		expect(slice(location.key))
			.toBe('"items"')

		const wrongKind = locateJsonPath(text, ['id', 'deeper'])!
		expect(wrongKind.resolvedPath)
			.toEqual(['id'])
		expect(wrongKind.exact)
			.toBe(false)
	})

	it('uses the last of duplicate keys, like JSON.parse', () => {
		const duplicate = '{ "a": 1, "a": 22 }'
		const location = locateJsonPath(duplicate, ['a'])!
		expect(duplicate.slice(location.value.start, location.value.end))
			.toBe('22')
	})

	it('returns null for text that is not JSON', () => {
		for (const broken of ['', '{', '{ "a": }', '{ "a": 1,, }', '[1 2]', '{ "a": 1 } trailing', '{\'a\': 1}', '{ "a": tru }']) {
			expect(locateJsonPath(broken, []))
				.toBeNull()
		}
	})

	it('finds a member span from its key through its value', () => {
		const itemPath = ['slots', 'items', 0]
		expect(slice(locateJsonMember(text, itemPath, 'id')))
			.toBe('"id": "a"')
		expect(locateJsonMember(text, itemPath, 'missing'))
			.toBeNull()
		expect(locateJsonMember(text, ['meta'], '0'))
			.toBeNull()
	})
})

describe('locateJsonValue (the JSON toggle of the Edit tab reveals the selected widget)', () => {
	it('spans the whole object of the widget at the path', () => {
		const span = locateJsonValue(text, ['slots', 'items', 1])!
		expect(text.slice(span.start, span.end))
			.toBe('{ "id": "b", "type": "Counter" }')
	})

	it('is null for a path the text does not have, or text that does not parse: it never lands on an ancestor', () => {
		expect(locateJsonValue(text, ['slots', 'items', 5]))
			.toBeNull()
		expect(locateJsonValue('{ "id": ', []))
			.toBeNull()
	})
})

describe('jsonSyntaxErrorOffset', () => {
	it('reads the V8 position, falling back to line and column, then to the end of the text', () => {
		const source = '{\n  "a": 1,\n  oops\n}'
		expect(jsonSyntaxErrorOffset('Expected double-quoted property name in JSON at position 14 (line 3 column 3)', source))
			.toBe(14)
		expect(jsonSyntaxErrorOffset('JSON.parse: expected property name or \'}\' at line 3 column 3 of the JSON data', source))
			.toBe(source.indexOf('oops'))
		expect(jsonSyntaxErrorOffset('JSON Parse error: Expected \'}\'', source))
			.toBe(source.indexOf('oops'))
		expect(jsonSyntaxErrorOffset('at position 9999', source))
			.toBe(source.length)
	})

	it('produces a one-character span that stays inside the text', () => {
		const source = '{ "a": '
		expect(jsonSyntaxErrorSpan('Unexpected end of JSON input', source))
			.toEqual({ start: source.length - 1, end: source.length })
		expect(jsonSyntaxErrorSpan('x at position 2', source))
			.toEqual({ start: 2, end: 3 })
		expect(jsonSyntaxErrorSpan('anything', ''))
			.toEqual({ start: 0, end: 0 })
	})

	it('locates positionless engine messages (V8 "Unexpected token") with its own scan of the same text', () => {
		const source = '{\n  "languages": x["en"]\n}'
		let message = ''
		try {
			JSON.parse(source)
		}
		catch (error) {
			message = (error as Error).message
		}
		expect(source.slice(jsonSyntaxErrorOffset(message, source))
			.startsWith('x['))
			.toBe(true)
	})

	it('scans to where text stops being JSON, and reports null for valid JSON', () => {
		expect(scanJsonSyntaxError('{ "a": 1 }'))
			.toBeNull()
		expect(scanJsonSyntaxError('{ "a": 1,, }'))
			.toBe(9)
		expect(scanJsonSyntaxError('{ "a": '))
			.toBe(7)
		expect(scanJsonSyntaxError('{ "a": 1 } x'))
			.toBe(11)
		expect(scanJsonSyntaxError('["bad \\q escape"]'))
			.toBe(1)
		expect(scanJsonSyntaxError(''))
			.toBe(0)
	})

	it('matches what the running engine reports for a real JSON.parse failure', () => {
		const source = '{ "a": 1, nope }'
		let message = ''
		try {
			JSON.parse(source)
		}
		catch (error) {
			message = (error as Error).message
		}
		const span = jsonSyntaxErrorSpan(message, source)
		// V8 points at the token that cannot start a property name.
		expect(source.slice(span.start, span.start + 1))
			.toBe('n')
	})
})

describe('endOfLine', () => {
	it('stops before the line break, including CRLF', () => {
		expect(endOfLine('ab\ncd', 0))
			.toBe(2)
		expect(endOfLine('ab\r\ncd', 0))
			.toBe(2)
		expect(endOfLine('ab', 0))
			.toBe(2)
	})
})
