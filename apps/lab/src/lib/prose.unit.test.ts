import { describe, expect, it } from 'vitest'
import { splitInlineCode, templateParts } from './prose'

describe('splitInlineCode', () => {
	it('turns Markdown code spans into code segments and keeps the text around them', () => {
		expect(splitInlineCode('Properties: `text` (label), `visible` and `errors`.'))
			.toEqual([
				{ text: 'Properties: ', code: false },
				{ text: 'text', code: true },
				{ text: ' (label), ', code: false },
				{ text: 'visible', code: true },
				{ text: ' and ', code: false },
				{ text: 'errors', code: true },
				{ text: '.', code: false },
			])
	})

	it('leaves a lone backtick, an empty span and text without code alone', () => {
		expect(splitInlineCode('a ` b'))
			.toEqual([{ text: 'a ` b', code: false }])
		expect(splitInlineCode('empty `` span'))
			.toEqual([{ text: 'empty `` span', code: false }])
		expect(splitInlineCode('plain'))
			.toEqual([{ text: 'plain', code: false }])
		expect(splitInlineCode(''))
			.toEqual([])
	})

	it('reads a span with JSON inside as one piece', () => {
		expect(splitInlineCode('include `{ code: "rule", message }`'))
			.toEqual([{ text: 'include ', code: false }, { text: '{ code: "rule", message }', code: true }])
	})
})

describe('templateParts', () => {
	it('splits a message into text and placeholders in the language\'s order', () => {
		expect(templateParts('{property} reads {widget}\'s {members}'))
			.toEqual([{ param: 'property' }, { text: ' reads ' }, { param: 'widget' }, { text: '\'s ' }, { param: 'members' }])
		expect(templateParts('{member}（目前：{value}）'))
			.toEqual([{ param: 'member' }, { text: '（目前：' }, { param: 'value' }, { text: '）' }])
		expect(templateParts('no placeholders'))
			.toEqual([{ text: 'no placeholders' }])
	})
})
