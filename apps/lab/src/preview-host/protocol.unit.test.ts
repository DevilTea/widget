import { describe, expect, it } from 'vitest'
import {
	parsePreviewHostCommand,
	parsePreviewHostEvent,
	parsePreviewHostRequest,
	parsePreviewHostResponse,
	PREVIEW_HOST_PROTOCOL_VERSION,
} from './protocol'

describe('preview host protocol', () => {
	it('validates a mount request and rejects stale/malformed scalar shapes', () => {
		const request = {
			protocol: PREVIEW_HOST_PROTOCOL_VERSION,
			kind: 'mount',
			requestId: 'r1',
			sessionId: 's1',
			generation: 2,
			preview: { showcaseId: 'survey', revision: 3, sourceText: '{}' },
		}
		expect(parsePreviewHostRequest(request))
			.toEqual(request)
		for (const invalid of [
			{ ...request, protocol: 99 },
			{ ...request, generation: -1 },
			{ ...request, preview: { ...request.preview, revision: 1.5 } },
			{ ...request, preview: { ...request.preview, sourceText: 1 } },
		]) {
			expect(parsePreviewHostRequest(invalid))
				.toBeNull()
		}
	})

	it('validates tutorial evaluation/spotlight without exposing arbitrary values', () => {
		const evaluate = { protocol: 1, kind: 'tutorial.evaluate', requestId: 'r2', tourId: 'crm', stepIndex: 2, progress: 1 }
		expect(parsePreviewHostRequest(evaluate))
			.toEqual(evaluate)
		expect(parsePreviewHostRequest({ ...evaluate, tourId: 'arbitrary' }))
			.toBeNull()
		expect(parsePreviewHostCommand({ protocol: 1, kind: 'tutorial.spotlight', target: 'crm-table' }))
			.toEqual({ protocol: 1, kind: 'tutorial.spotlight', target: 'crm-table' })
		expect(parsePreviewHostCommand({ protocol: 1, kind: 'tutorial.spotlight', target: { value: 1 } }))
			.toBeNull()
		expect(parsePreviewHostCommand({ protocol: 1, kind: 'presentation.update', locale: 'zh-TW', theme: 'dark' }))
			.toEqual({ protocol: 1, kind: 'presentation.update', locale: 'zh-TW', theme: 'dark' })
		expect(parsePreviewHostCommand({ protocol: 1, kind: 'presentation.update', locale: 'ja', theme: 'dark' }))
			.toBeNull()
	})

	it('validates mounted/evaluated/error responses and observation events', () => {
		const mounted = { protocol: 1, kind: 'mounted', requestId: 'r1', generation: 2, revision: 3, runtimeId: 'runtime-a' } as const
		const evaluated = { protocol: 1, kind: 'tutorial.evaluated', requestId: 'r2', tourId: 'survey', stepIndex: 1, progress: 2 } as const
		const error = { protocol: 1, kind: 'error', requestId: 'r3', message: 'boom' } as const
		const observation = { protocol: 1, kind: 'tutorial.observation-changed', tourId: 'survey' } as const

		expect(parsePreviewHostResponse(mounted))
			.toEqual(mounted)
		expect(parsePreviewHostResponse(evaluated))
			.toEqual(evaluated)
		expect(parsePreviewHostResponse(error))
			.toEqual(error)
		expect(parsePreviewHostEvent(observation))
			.toEqual(observation)

		for (const invalid of [
			{ ...mounted, generation: -1 },
			{ ...mounted, revision: -1 },
			{ ...mounted, revision: 1.5 },
			{ ...mounted, runtimeId: '' },
			{ ...mounted, requestId: '' },
			{ ...evaluated, tourId: 'unknown' },
			{ ...evaluated, stepIndex: -1 },
			{ ...evaluated, progress: 1.5 },
			{ ...error, message: 42 },
		]) {
			expect(parsePreviewHostResponse(invalid))
				.toBeNull()
		}
		for (const invalid of [
			{ ...observation, tourId: 'unknown' },
			{ ...observation, protocol: 99 },
		]) {
			expect(parsePreviewHostEvent(invalid))
				.toBeNull()
		}
	})
})
