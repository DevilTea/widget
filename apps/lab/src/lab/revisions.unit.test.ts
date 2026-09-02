import { describe, expect, it } from 'vitest'
import { getLabRevisionStatus } from './revisions'

describe('getLabRevisionStatus', () => {
	it('marks equal valid revisions as linked and synchronized', () => {
		expect(getLabRevisionStatus(3, 3))
			.toEqual({
				documentRevision: 3,
				previewRevision: 3,
				state: 'linked',
				isLinked: true,
				isDiverged: false,
				isPreviewStale: false,
			})
	})

	it('marks an older valid Preview as diverged and stale', () => {
		const status = getLabRevisionStatus(4, 2)
		expect(status.state)
			.toBe('diverged')
		expect(status.isLinked)
			.toBe(false)
		expect(status.isDiverged)
			.toBe(true)
		expect(status.isPreviewStale)
			.toBe(true)
	})

	it('marks a session without any valid Preview as unlinked, not stale', () => {
		const status = getLabRevisionStatus(1, null)
		expect(status.state)
			.toBe('unlinked')
		expect(status.isDiverged)
			.toBe(false)
		expect(status.isPreviewStale)
			.toBe(false)
	})
})
