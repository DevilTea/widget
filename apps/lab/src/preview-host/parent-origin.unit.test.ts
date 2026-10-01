import { describe, expect, it } from 'vitest'
import { derivePreviewParentOrigin } from './parent-origin'

describe('derivePreviewParentOrigin', () => {
	it('returns only the canonical origin from the browser referrer', () => {
		expect(derivePreviewParentOrigin('https://lab.example.test/workbench?tab=preview#runtime'))
			.toBe('https://lab.example.test')
	})

	it.each([
		'',
		'not a URL',
		'about:blank',
		'data:text/html,preview',
		'file:///tmp/lab.html',
	])('fails closed for a missing, invalid, or opaque referrer: %s', (referrer) => {
		expect(derivePreviewParentOrigin(referrer))
			.toBeNull()
	})
})
