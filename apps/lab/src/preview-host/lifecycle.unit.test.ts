import type { PreviewHostState } from './lifecycle'
import { describe, expect, it } from 'vitest'
import { reducePreviewHostState } from './lifecycle'

describe('preview host lifecycle', () => {
	it('tracks boot -> ready -> replacing -> ready explicitly', () => {
		let state: PreviewHostState = { status: 'booting', generation: 1, lastReadyRevision: null }
		state = reducePreviewHostState(state, { type: 'ready', generation: 1, revision: 3, runtimeId: 'runtime-3' })
		expect(state)
			.toEqual({ status: 'ready', generation: 1, revision: 3, runtimeId: 'runtime-3' })

		state = reducePreviewHostState(state, { type: 'replace-started', generation: 1, revision: 4 })
		expect(state)
			.toEqual({ status: 'replacing', generation: 1, revision: 4, previousRevision: 3, previousRuntimeId: 'runtime-3' })

		state = reducePreviewHostState(state, { type: 'ready', generation: 1, revision: 4, runtimeId: 'runtime-4' })
		expect(state)
			.toEqual({ status: 'ready', generation: 1, revision: 4, runtimeId: 'runtime-4' })
	})

	it('ignores stale frame events after a newer generation boots', () => {
		let state: PreviewHostState = { status: 'ready', generation: 1, revision: 3, runtimeId: 'old' }
		state = reducePreviewHostState(state, { type: 'boot', generation: 2 })
		expect(state)
			.toEqual({ status: 'booting', generation: 2, lastReadyRevision: 3 })

		state = reducePreviewHostState(state, { type: 'ready', generation: 1, revision: 99, runtimeId: 'stale' })
		expect(state)
			.toEqual({ status: 'booting', generation: 2, lastReadyRevision: 3 })

		state = reducePreviewHostState(state, { type: 'ready', generation: 2, revision: 3, runtimeId: 'rehydrated' })
		expect(state)
			.toEqual({ status: 'ready', generation: 2, revision: 3, runtimeId: 'rehydrated' })
	})

	it('preserves the last ready revision through replacement/reboot disconnects', () => {
		let state: PreviewHostState = { status: 'ready', generation: 3, revision: 7, runtimeId: 'runtime-7' }
		state = reducePreviewHostState(state, { type: 'replace-started', generation: 3, revision: 8 })
		expect(reducePreviewHostState(state, { type: 'disconnected', generation: 3 }))
			.toEqual({ status: 'disconnected', generation: 3, lastReadyRevision: 7 })

		state = reducePreviewHostState({ status: 'ready', generation: 3, revision: 7, runtimeId: 'runtime-7' }, { type: 'boot', generation: 4 })
		expect(reducePreviewHostState(state, { type: 'disconnected', generation: 4 }))
			.toEqual({ status: 'disconnected', generation: 4, lastReadyRevision: 7 })
	})

	it('makes disconnect and failure explicit rather than inferring them from iframe DOM presence', () => {
		const ready: PreviewHostState = { status: 'ready', generation: 4, revision: 8, runtimeId: 'runtime-8' }
		expect(reducePreviewHostState(ready, { type: 'disconnected', generation: 4 }))
			.toEqual({ status: 'disconnected', generation: 4, lastReadyRevision: 8 })
		expect(reducePreviewHostState(ready, { type: 'failed', generation: 4, message: 'bootstrap mismatch' }))
			.toEqual({ status: 'error', generation: 4, message: 'bootstrap mismatch', lastReadyRevision: 8 })
	})

	it('reboots from disconnect only with a newer generation and retains recovery context', () => {
		let state: PreviewHostState = { status: 'disconnected', generation: 4, lastReadyRevision: 8 }
		state = reducePreviewHostState(state, { type: 'boot', generation: 4 })
		expect(state)
			.toEqual({ status: 'disconnected', generation: 4, lastReadyRevision: 8 })

		state = reducePreviewHostState(state, { type: 'boot', generation: 5 })
		expect(state)
			.toEqual({ status: 'booting', generation: 5, lastReadyRevision: 8 })
		state = reducePreviewHostState(state, { type: 'ready', generation: 5, revision: 8, runtimeId: 'runtime-rehydrated' })
		expect(state)
			.toEqual({ status: 'ready', generation: 5, revision: 8, runtimeId: 'runtime-rehydrated' })
	})
})
