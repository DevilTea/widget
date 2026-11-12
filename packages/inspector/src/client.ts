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

/** Codes a protocol peer sends, plus the ones only the Client itself produces. */
export type InspectorClientErrorCode = InspectorProtocolError['code'] | 'timeout'

export interface InspectorClientErrorInfo {
	readonly code: InspectorClientErrorCode
	readonly message: string
}

export class InspectorClientError extends Error {
	override readonly name = 'InspectorClientError'
	readonly code: InspectorClientErrorCode
	readonly protocolError: InspectorClientErrorInfo

	constructor(error: InspectorClientErrorInfo) {
		super(error.message)
		this.code = error.code
		this.protocolError = error
	}
}

interface PendingRequest {
	readonly method: InspectorRequestMethod
	readonly resolve: (value: unknown) => void
	readonly reject: (reason: unknown) => void
	readonly timer: ReturnType<typeof setTimeout> | null
}

function malformedResponseRequestId(value: unknown): string | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return null
	const candidate = value as { readonly kind?: unknown, readonly requestId?: unknown }
	return candidate.kind === 'response' && typeof candidate.requestId === 'string'
		? candidate.requestId
		: null
}

export interface CreateInspectorClientOptions {
	/**
	 * Rejects a request that has received no response after this many milliseconds with an
	 * `InspectorClientError` coded `timeout`. There is no default: unlimited unless configured. Must be a
	 * positive finite number. A late response to a timed-out request is ignored.
	 */
	readonly requestTimeoutMs?: number
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

export function createInspectorClient(transport: InspectorTransport, options: CreateInspectorClientOptions = {}): InspectorClient {
	const requestTimeoutMs = options.requestTimeoutMs
	if (requestTimeoutMs !== undefined && !(Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0))
		throw new RangeError('requestTimeoutMs must be a positive finite number when configured.')
	let requestSequence = 0
	let closed = false
	const pending = new Map<string, PendingRequest>()
	const eventListeners = new Map<InspectorEventName, Set<(payload: never) => void>>()
	const messageListeners = new Set<(event: InspectorEventMessage) => void>()
	let unsubscribeMessages: () => void = () => {}
	let unsubscribeClose: () => void = () => {}

	/** Removes and returns the pending entry for a request, cancelling its timeout. */
	function takePending(requestId: string): PendingRequest | undefined {
		const entry = pending.get(requestId)
		if (entry !== undefined) {
			pending.delete(requestId)
			clearTimeout(entry.timer ?? undefined)
		}
		return entry
	}

	function finalizeClose(message: string, closeTransport: boolean): void {
		if (closed)
			return
		closed = true
		unsubscribeMessages()
		unsubscribeClose()
		for (const entry of pending.values()) {
			clearTimeout(entry.timer ?? undefined)
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

	function handleResponse(rawMessage: unknown): void {
		const response = parseInspectorResponseMessage(rawMessage)
		if (response === null) {
			const requestId = malformedResponseRequestId(rawMessage)
			const entry = requestId === null ? undefined : takePending(requestId)
			entry?.reject(new InspectorClientError({
				code: 'invalid-message',
				message: 'Invalid Inspector protocol response envelope.',
			}))
			return
		}
		const entry = takePending(response.requestId)
		if (entry === undefined)
			return

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
		let valid: boolean
		try {
			valid = isInspectorRequestResult(entry.method, response.result, response.protocol.minor)
		}
		catch {
			valid = false
		}
		if (!valid) {
			entry.reject(new InspectorClientError({
				code: 'invalid-message',
				message: `Invalid ${entry.method} response payload.`,
			}))
			return
		}
		entry.resolve(response.result)
	}

	unsubscribeMessages = transport.subscribe((rawMessage) => {
		let event: InspectorEventMessage | null = null
		try {
			event = parseInspectorEventMessage(rawMessage)
			if (event === null || !isCompatibleProtocolVersion(event.protocol)) {
				event = null
				handleResponse(rawMessage)
			}
		}
		catch {
			// Validation must never throw out of the transport listener: the request this message
			// answers (if any) is rejected with a coded error instead of staying pending forever.
			const requestId = malformedResponseRequestId(rawMessage)
			const entry = requestId === null ? undefined : takePending(requestId)
			entry?.reject(new InspectorClientError({
				code: 'invalid-message',
				message: 'Unable to process the Inspector protocol response.',
			}))
			return
		}
		if (event === null)
			return
		for (const listener of [...messageListeners])
			listener(event)
		const listeners = eventListeners.get(event.event)
		if (listeners !== undefined) {
			for (const listener of [...listeners])
				listener(event.payload as never)
		}
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
				timer: requestTimeoutMs === undefined
					? null
					: setTimeout(() => {
							takePending(requestId)
							reject(new InspectorClientError({
								code: 'timeout',
								message: `Inspector request ${method} timed out after ${requestTimeoutMs}ms.`,
							}))
						}, requestTimeoutMs),
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
				takePending(requestId)
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
