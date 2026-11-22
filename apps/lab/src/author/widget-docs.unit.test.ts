import { describe, expect, it } from 'vitest'
import { getShowcase } from '../showcases/registry'
import { docText, memberDocText } from './widget-docs'

describe('docText', () => {
	it('joins the source line wraps of a paragraph into one line', () => {
		expect(docText({ summary: 'The survey root; it aggregates every question\'s\nvisible/required/value state.', remarks: '' }))
			.toBe('The survey root; it aggregates every question\'s visible/required/value state.')
	})

	it('keeps paragraph breaks, the summary/remarks break and list items', () => {
		expect(docText({ summary: 'One\nline.', remarks: 'First\nparagraph.\n\nItems:\n- a\n  wrapped\n- b\n1. c' }))
			.toBe('One line.\n\nFirst paragraph.\n\nItems:\n- a wrapped\n- b\n1. c')
	})

	it('reads an undocumented member as an empty string', () => {
		expect(docText(undefined))
			.toBe('')
		expect(docText(null))
			.toBe('')
		expect(memberDocText({}, 'missing'))
			.toBe('')
		expect(memberDocText(undefined, 'missing'))
			.toBe('')
	})

	it('shows the real generated Survey summary without the comment\'s line wraps', () => {
		const docs = getShowcase('survey')!.docs
		expect(docs.plugins.Survey!.summary)
			.toContain('\n')
		expect(docText(docs.plugins.Survey))
			.not
			.toMatch(/(?<!\n)\n(?!\n)/)
	})
})
