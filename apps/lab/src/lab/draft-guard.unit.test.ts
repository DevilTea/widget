import { describe, expect, it, vi } from 'vitest'
import { createDraftGuard } from './draft-guard'

describe('draft guard', () => {
	it('runs the action at once when there is no unapplied draft', () => {
		const onChange = vi.fn()
		const run = vi.fn()
		const guard = createDraftGuard(onChange)

		expect(guard.request({ isDirty: false, subject: 'Default', run }))
			.toBe('ran')

		expect(run)
			.toHaveBeenCalledTimes(1)
		expect(guard.getPending())
			.toBeNull()
		expect(onChange).not.toHaveBeenCalled()
	})

	it('holds the action behind a confirmation while a draft is unapplied, then runs it once on confirm', () => {
		const onChange = vi.fn()
		const run = vi.fn()
		const guard = createDraftGuard(onChange)

		expect(guard.request({ isDirty: true, subject: 'AI draft', run }))
			.toBe('confirming')
		expect(run).not.toHaveBeenCalled()
		expect(guard.getPending()?.subject)
			.toBe('AI draft')
		expect(onChange)
			.toHaveBeenCalledTimes(1)

		expect(guard.confirm())
			.toBe(true)
		expect(run)
			.toHaveBeenCalledTimes(1)
		expect(guard.getPending())
			.toBeNull()
		expect(guard.confirm())
			.toBe(false)
		expect(run)
			.toHaveBeenCalledTimes(1)
	})

	it('drops the action on cancel and leaves the caller free to ask again', () => {
		const run = vi.fn()
		const guard = createDraftGuard()

		guard.request({ isDirty: true, subject: 'x', run })
		guard.cancel()
		expect(guard.getPending())
			.toBeNull()
		expect(run).not.toHaveBeenCalled()
		expect(guard.confirm())
			.toBe(false)

		expect(guard.request({ isDirty: true, subject: 'y', run }))
			.toBe('confirming')
	})

	it('ignores a second request while one waits and keeps the first action', () => {
		const first = vi.fn()
		const second = vi.fn()
		const guard = createDraftGuard()

		guard.request({ isDirty: true, subject: 'first', run: first })
		expect(guard.request({ isDirty: true, subject: 'second', run: second }))
			.toBe('ignored')
		expect(guard.request({ isDirty: false, subject: 'third', run: second }))
			.toBe('ignored')

		guard.confirm()
		expect(first)
			.toHaveBeenCalledTimes(1)
		expect(second).not.toHaveBeenCalled()
	})
})
