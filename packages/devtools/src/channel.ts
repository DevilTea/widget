import type { InspectorTransport } from './transport'

const MESSAGE_PORT_CHANNEL_TYPE = '@deviltea/widget-devtools/message-port-channel'

interface ChannelMessageEnvelope {
	readonly type: typeof MESSAGE_PORT_CHANNEL_TYPE
	readonly channel: string
	readonly kind: 'message'
	readonly payload: unknown
}

interface ChannelCloseEnvelope {
	readonly type: typeof MESSAGE_PORT_CHANNEL_TYPE
	readonly channel: string
	readonly kind: 'close'
}

type ChannelEnvelope = ChannelMessageEnvelope | ChannelCloseEnvelope

interface ChannelState {
	readonly messageListeners: Set<(message: unknown) => void>
	readonly closeListeners: Set<() => void>
	closed: boolean
}

export interface MessagePortChannelHub {
	readonly closed: boolean
	openChannel: (name: string) => InspectorTransport
	close: () => void
}

function cloneJson(message: unknown): unknown {
	const serialized = JSON.stringify(message)
	if (serialized === undefined)
		throw new TypeError('MessagePort channel messages must be JSON-serializable.')
	return JSON.parse(serialized) as unknown
}

function isEnvelope(value: unknown): value is ChannelEnvelope {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false
	const candidate = value as Partial<ChannelEnvelope>
	return candidate.type === MESSAGE_PORT_CHANNEL_TYPE
		&& typeof candidate.channel === 'string'
		&& candidate.channel.length > 0
		&& (candidate.kind === 'message' || candidate.kind === 'close')
		&& (candidate.kind !== 'message' || 'payload' in candidate)
}

/**
 * Multiplexes independent JSON-safe logical transports over one MessagePort.
 *
 * Channel `close()` is deliberately scoped: InspectorClient/InspectorAgent may dispose their own
 * logical channel without tearing down the frame-host control channel. Closing the hub (or the native
 * peer port) disconnects every logical channel.
 */
export function createMessagePortChannelHub(port: MessagePort): MessagePortChannelHub {
	const states = new Map<string, ChannelState>()
	let closed = false

	function stateFor(name: string): ChannelState {
		let state = states.get(name)
		if (state === undefined) {
			state = {
				messageListeners: new Set(),
				closeListeners: new Set(),
				closed,
			}
			states.set(name, state)
		}
		return state
	}

	function markChannelClosed(state: ChannelState): void {
		if (state.closed)
			return
		state.closed = true
		state.messageListeners.clear()
		const listeners = [...state.closeListeners]
		state.closeListeners.clear()
		for (const listener of listeners)
			listener()
	}

	function markHubClosed(): void {
		if (closed)
			return
		closed = true
		port.removeEventListener('message', onMessage)
		port.removeEventListener('close', onPortClose)
		for (const state of states.values())
			markChannelClosed(state)
	}

	function onMessage(event: MessageEvent<unknown>): void {
		if (closed || !isEnvelope(event.data))
			return
		const envelope = event.data
		const state = stateFor(envelope.channel)
		if (state.closed)
			return
		if (envelope.kind === 'close') {
			markChannelClosed(state)
			return
		}
		for (const listener of [...state.messageListeners])
			listener(envelope.payload)
	}

	function onPortClose(): void {
		markHubClosed()
	}

	port.addEventListener('message', onMessage)
	port.addEventListener('close', onPortClose)
	port.start()

	return {
		get closed() {
			return closed
		},
		openChannel(name) {
			if (name.length === 0)
				throw new TypeError('MessagePort channel name must not be empty.')
			const state = stateFor(name)
			return {
				get closed() {
					return state.closed
				},
				send(message) {
					if (closed || state.closed)
						throw new Error('Inspector transport is closed.')
					const envelope: ChannelMessageEnvelope = {
						type: MESSAGE_PORT_CHANNEL_TYPE,
						channel: name,
						kind: 'message',
						payload: cloneJson(message),
					}
					port.postMessage(envelope)
				},
				subscribe(listener) {
					if (closed || state.closed)
						return () => {}
					state.messageListeners.add(listener)
					return () => state.messageListeners.delete(listener)
				},
				subscribeClose(listener) {
					if (closed || state.closed) {
						listener()
						return () => {}
					}
					state.closeListeners.add(listener)
					return () => state.closeListeners.delete(listener)
				},
				close() {
					if (closed || state.closed)
						return
					port.postMessage({
						type: MESSAGE_PORT_CHANNEL_TYPE,
						channel: name,
						kind: 'close',
					} satisfies ChannelCloseEnvelope)
					markChannelClosed(state)
				},
			}
		},
		close() {
			if (closed)
				return
			markHubClosed()
			port.close()
		},
	}
}
