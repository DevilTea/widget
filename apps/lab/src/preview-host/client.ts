import type { InspectorTransport } from '@deviltea/widget-inspector/transport'
import type {
	PreviewHostDescriptor,
	PreviewHostEvent,
	PreviewHostMountedResponse,
	PreviewHostResponse,
	PreviewHostTutorialEvaluatedResponse,
	PreviewTourId,
} from './protocol'
import {
	parsePreviewHostEvent,
	parsePreviewHostResponse,
	PREVIEW_HOST_PROTOCOL_VERSION,
} from './protocol'

/**
 * `answered`: the frame itself replied with an error (a mount it refused or could not finish), so the frame is alive.
 * `runtimeTornDown`: it had already taken down the Runtime it ran before, so nothing runs; without it the old Runtime still
 * runs. Neither: the channel failed (disconnected, closed).
 * `discardFrame`: the frame document cannot recover in place (a module it needs failed to load and stays failed in that
 * document), so it has to be replaced before the next mount; what it ran goes with it.
 */
export class PreviewHostClientError extends Error {
	constructor(message: string, readonly answered = false, readonly runtimeTornDown = false, readonly discardFrame = false) {
		super(message)
	}
}

export interface PreviewHostClient {
	mount: (sessionId: string, generation: number, preview: PreviewHostDescriptor) => Promise<PreviewHostMountedResponse>
	evaluateTutorial: (tourId: PreviewTourId, stepIndex: number, progress: number) => Promise<PreviewHostTutorialEvaluatedResponse>
	updatePresentation: (locale: 'en' | 'zh-TW', theme: 'light' | 'dark') => void
	setTutorialSpotlight: (target: string | null) => void
	onEvent: (listener: (event: PreviewHostEvent) => void) => () => void
	close: () => void
}

let requestSequence = 1

export function createPreviewHostClient(transport: InspectorTransport): PreviewHostClient {
	const pending = new Map<string, {
		resolve: (response: PreviewHostResponse) => void
		reject: (error: Error) => void
	}>()
	const eventListeners = new Set<(event: PreviewHostEvent) => void>()
	let closed = false

	function rejectPending(message: string): void {
		for (const entry of pending.values())
			entry.reject(new PreviewHostClientError(message))
		pending.clear()
	}

	const unsubscribeMessage = transport.subscribe((raw) => {
		const response = parsePreviewHostResponse(raw)
		if (response !== null) {
			const entry = pending.get(response.requestId)
			if (entry === undefined)
				return
			pending.delete(response.requestId)
			if (response.kind === 'error')
				entry.reject(new PreviewHostClientError(response.message, true, response.runtimeTornDown === true, response.discardFrame === true))
			else
				entry.resolve(response)
			return
		}
		const event = parsePreviewHostEvent(raw)
		if (event !== null) {
			for (const listener of [...eventListeners])
				listener(event)
		}
	})
	const unsubscribeClose = transport.subscribeClose(() => {
		if (closed)
			return
		closed = true
		rejectPending('Preview host disconnected.')
	})

	function request<Response extends PreviewHostResponse>(message: Omit<Record<string, unknown>, never>): Promise<Response> {
		if (closed || transport.closed)
			return Promise.reject(new PreviewHostClientError('Preview host disconnected.'))
		const requestId = `preview-host-${requestSequence++}`
		return new Promise<Response>((resolve, reject) => {
			pending.set(requestId, {
				resolve: response => resolve(response as Response),
				reject,
			})
			try {
				transport.send({ ...message, protocol: PREVIEW_HOST_PROTOCOL_VERSION, requestId })
			}
			catch (error) {
				pending.delete(requestId)
				reject(error instanceof Error ? error : new Error(String(error)))
			}
		})
	}

	return {
		mount: async (sessionId, generation, preview) => {
			const response = await request<PreviewHostMountedResponse>({
				kind: 'mount',
				sessionId,
				generation,
				preview,
			})
			if (response.kind !== 'mounted')
				throw new PreviewHostClientError(`Unexpected Preview host response: ${response.kind}.`)
			return response
		},
		evaluateTutorial: async (tourId, stepIndex, progress) => {
			const response = await request<PreviewHostTutorialEvaluatedResponse>({
				kind: 'tutorial.evaluate',
				tourId,
				stepIndex,
				progress,
			})
			if (response.kind !== 'tutorial.evaluated')
				throw new PreviewHostClientError(`Unexpected Preview host response: ${response.kind}.`)
			return response
		},
		updatePresentation(locale, theme) {
			if (closed || transport.closed)
				return
			transport.send({
				protocol: PREVIEW_HOST_PROTOCOL_VERSION,
				kind: 'presentation.update',
				locale,
				theme,
			})
		},
		setTutorialSpotlight(target) {
			if (closed || transport.closed)
				return
			transport.send({
				protocol: PREVIEW_HOST_PROTOCOL_VERSION,
				kind: 'tutorial.spotlight',
				target,
			})
		},
		onEvent(listener) {
			eventListeners.add(listener)
			return () => eventListeners.delete(listener)
		},
		close() {
			if (closed)
				return
			closed = true
			unsubscribeMessage()
			unsubscribeClose()
			eventListeners.clear()
			rejectPending('Preview host closed.')
			if (!transport.closed)
				transport.close()
		},
	}
}
