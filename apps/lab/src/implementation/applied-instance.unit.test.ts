import { describe, expect, it } from 'vitest'
import { extractAppliedInstance } from './applied-instance'

const sourceText = `{
  "id": "root",
  "type": "Stack",
  "slots": {
    "items": [
      { "id": "title", "type": "Text", "config": { "text": "hello" } },
      {
        "id": "section-1",
        "type": "Section",
        "config": { "title": "Details" },
        "slots": {
          "body": [
            { "id": "note", "type": "Text", "config": { "text": "nested" } }
          ]
        }
      }
    ]
  }
}`

describe('extractAppliedInstance', () => {
	it('finds a top-level widget and pretty-prints its exact JSON fragment', () => {
		const result = extractAppliedInstance(sourceText, 'root')
		expect(result.status)
			.toBe('found')
		expect(result.status === 'found' && JSON.parse(result.json))
			.toEqual({
				id: 'root',
				type: 'Stack',
				slots: { items: expect.any(Array) },
			})
	})

	it('finds a widget nested several slots deep', () => {
		const result = extractAppliedInstance(sourceText, 'note')
		expect(result.status)
			.toBe('found')
		expect(result.status === 'found' && JSON.parse(result.json))
			.toEqual({
				id: 'note',
				type: 'Text',
				config: { text: 'nested' },
			})
	})

	it('finds a widget that itself has slots without including sibling content', () => {
		const result = extractAppliedInstance(sourceText, 'section-1')
		expect(result.status)
			.toBe('found')
		expect(result.status === 'found' && JSON.parse(result.json))
			.toEqual({
				id: 'section-1',
				type: 'Section',
				config: { title: 'Details' },
				slots: { body: [{ id: 'note', type: 'Text', config: { text: 'nested' } }] },
			})
	})

	it('returns not-found for a widget id absent from the applied source', () => {
		const result = extractAppliedInstance(sourceText, 'does-not-exist')
		expect(result)
			.toEqual({ status: 'not-found' })
	})

	it('returns not-found rather than throwing on unparsable source text', () => {
		const result = extractAppliedInstance('{ not json', 'root')
		expect(result)
			.toEqual({ status: 'not-found' })
	})

	it('pretty-prints with 2-space indentation', () => {
		const result = extractAppliedInstance(sourceText, 'title')
		expect(result.status)
			.toBe('found')
		expect(result.status === 'found' && result.json)
			.toBe(JSON.stringify({ id: 'title', type: 'Text', config: { text: 'hello' } }, null, 2))
	})
})
