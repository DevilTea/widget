import type {
	InspectorEventMap,
	InspectorEventMessage,
	InspectorEventName,
	InspectorProtocolError,
	InspectorRequestMethod,
	InspectorRequestParams,
	InspectorRequestResult,
} from './protocol'
import type { InspectorTransport } from './transport'
import {
	INSPECTOR_PROTOCOL_VERSION,
	isCompatibleProtocolVersion,
	isInspectorRequestResult,
	parseInspectorEventMessage,
	parseInspectorResponseMessage,
} from './protocol'

export class InspectorClientError extends Error {
	override readonly name = 'InspectorClientError'
	readonly code: InspectorProtocolError['code']
	readonly protocolError: InspectorProtocolError

	constructor(error: InspectorProtocolError) {
		super(error.message)
		this.code = error.code
		this.protocolError = error
	}
}

interface PendingRequest {
	readonly method: InspectorRequestMethod
	readonly resolve: (value: unknown) => void
	readonly reject: (reason: unknown) => void
}

export interface InspectorClient {
	handshake: () => Promise<InspectorRequestResult<'handshake'>>
	request: <Method extends InspectorRequestMethod>(
		method: Method,
		params: InspectorRequestParams<Method>,
	) => Promise<InspectorRequestResult<Method>>
	subscribe: (listener: (event: InspectorEventMessage) => void) => () => void
	on: <Event extends InspectorEventName>(
		event: Event,
		listener: (payload: InspectorEventMap[Event]) => void,
	) => () => void
	close: () => void
	/** Alias retained for owner-lifecycle terminology used by Lab integration/tests. */
	dispose: () => void
}

export function createInspectorClient(transport: InspectorTransport): InspectorClient {
	let requestSequence = 0
	let closed = false
	const pending = new Map<string, PendingRequest>()
	const eventListeners = new Map<InspectorEventName, Set<(payload: never) => void>>()
	const messageListeners = new Set<(event: InspectorEventMessage) => void>()
	let unsubscribeMessages: () => void = () => {}
	let unsubscribeClose: () => void = () => {}

	function finalizeClose(message: string, closeTransport: boolean): void {
		if (closed)
			return
		closed = true
		unsubscribeMessages()
		unsubscribeClose()
		for (const entry of pending.values()) {
			entry.reject(new InspectorClientError({
				code: 'disconnected',
				message,
			}))
		}
		pending.clear()
		eventListeners.clear()
		messageListeners.clear()
		if (closeTransport && !transport.closed)
			transport.close()
	}

	unsubscribeMessages = transport.subscribe((rawMessage) => {
		const event = parseInspectorEventMessage(rawMessage)
		if (event !== null && isCompatibleProtocolVersion(event.protocol)) {
			for (const listener of [...messageListeners])
				listener(event)
			const listeners = eventListeners.get(event.event)
			if (listeners !== undefined) {
				for (const listener of [...listeners])
					listener(event.payload as never)
			}
			return
		}

		const response = parseInspectorResponseMessage(rawMessage)
		if (response === null)
			return
		const entry = pending.get(response.requestId)
		if (entry === undefined)
			return
		pending.delete(response.requestId)

		if (!isCompatibleProtocolVersion(response.protocol)) {
			entry.reject(new InspectorClientError({
				code: 'unsupported-version',
				message: 'Inspector response uses an incompatible protocol major version.',
			}))
			return
		}
		if (!response.ok) {
			entry.reject(new InspectorClientError(response.error))
			return
		}
		if (!isInspectorRequestResult(entry.method, response.result)) {
			entry.reject(new InspectorClientError({
				code: 'invalid-message',
				message: `Invalid ${entry.method} response payload.`,
			}))
			return
		}
		entry.resolve(response.result)
	})
	unsubscribeClose = transport.subscribeClose(() => {
		finalizeClose('Inspector transport disconnected.', false)
	})

	function request<Method extends InspectorRequestMethod>(
		method: Method,
		params: InspectorRequestParams<Method>,
	): Promise<InspectorRequestResult<Method>> {
		if (closed || transport.closed) {
			return Promise.reject(new InspectorClientError({
				code: 'disconnected',
				message: 'Inspector client is disconnected.',
			}))
		}

		const requestId = `request-${++requestSequence}`
		return new Promise<InspectorRequestResult<Method>>((resolve, reject) => {
			pending.set(requestId, {
				method,
				resolve: resolve as (value: unknown) => void,
				reject,
			})
			try {
				transport.send({
					protocol: INSPECTOR_PROTOCOL_VERSION,
					kind: 'request',
					requestId,
					method,
					params,
				})
			}
			catch (error) {
				pending.delete(requestId)
				reject(error)
			}
		})
	}

	function close(): void {
		finalizeClose('Inspector client was closed.', true)
	}

	return {
		handshake: () => request('handshake', { protocol: INSPECTOR_PROTOCOL_VERSION }),
		request,
		subscribe(listener) {
			messageListeners.add(listener)
			return () => messageListeners.delete(listener)
		},
		on(event, listener) {
			let listeners = eventListeners.get(event)
			if (listeners === undefined) {
				listeners = new Set()
				eventListeners.set(event, listeners)
			}
			const erased = listener as (payload: never) => void
			listeners.add(erased)
			return () => listeners!.delete(erased)
		},
		close,
		dispose: close,
	}
}
