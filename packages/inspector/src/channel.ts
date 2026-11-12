import type { InspectorTransport } from './transport'

const MESSAGE_PORT_CHANNEL_TYPE = '@deviltea/widget-inspector/message-port-channel'
const MESSAGE_PORT_CHANNEL_HUB_TYPE = '@deviltea/widget-inspector/message-port-channel-hub'

interface HubCloseEnvelope {
	readonly type: typeof MESSAGE_PORT_CHANNEL_HUB_TYPE
	readonly version: 1
	readonly kind: 'close'
}

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

/**
 * A message that arrives for a channel nobody has subscribed to yet (the peer opened it first) is buffered,
 * at most this many per channel; beyond that the OLDEST buffered message is dropped. The latest messages
 * matter most for a request/response protocol whose peer retries, and a flood cannot grow memory.
 */
const MAX_BUFFERED_MESSAGES_PER_CHANNEL = 64

/**
 * At most this many channel names the local side has not opened yet may hold state for the peer. A message
 * for any further unknown name is dropped without creating state, so a peer cannot grow the map without bound.
 */
const MAX_UNOPENED_CHANNELS = 16

interface ChannelState {
	readonly messageListeners: Set<(message: unknown) => void>
	readonly closeListeners: Set<() => void>
	/** Messages that arrived while no listener was subscribed, oldest first; see the limits above. */
	readonly buffer: unknown[]
	closed: boolean
	/** The local side called `openChannel` for this generation of the name. */
	opened: boolean
	/** The peer (not the local side) closed this generation, so a new message means the peer reopened it. */
	closedByPeer: boolean
	flushScheduled: boolean
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

function isHubCloseEnvelope(value: unknown): value is HubCloseEnvelope {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false
	const candidate = value as Partial<HubCloseEnvelope>
	return candidate.type === MESSAGE_PORT_CHANNEL_HUB_TYPE
		&& candidate.version === 1
		&& candidate.kind === 'close'
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

	function createState(): ChannelState {
		return {
			messageListeners: new Set(),
			closeListeners: new Set(),
			buffer: [],
			closed: false,
			opened: false,
			closedByPeer: false,
			flushScheduled: false,
		}
	}

	function unopenedCount(): number {
		let count = 0
		for (const state of states.values()) {
			if (!state.opened && !state.closed)
				count++
		}
		return count
	}

	function markChannelClosed(state: ChannelState): void {
		if (state.closed)
			return
		state.closed = true
		state.buffer.length = 0
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
		if (closed)
			return
		if (isHubCloseEnvelope(event.data)) {
			try {
				markHubClosed()
			}
			finally {
				port.close()
			}
			return
		}
		if (!isEnvelope(event.data))
			return
		const envelope = event.data
		let state = states.get(envelope.channel)
		if (envelope.kind === 'close') {
			if (state === undefined || state.closed)
				return
			if (state.opened) {
				state.closedByPeer = true
				markChannelClosed(state)
			}
			else {
				// Closed before the local side ever opened it: nothing is left to deliver or to report.
				states.delete(envelope.channel)
			}
			return
		}
		if (state === undefined || (state.closed && state.closedByPeer)) {
			// A name nobody here has opened yet, or one the peer closed and has now reopened.
			if (state === undefined && unopenedCount() >= MAX_UNOPENED_CHANNELS)
				return
			state = createState()
			states.set(envelope.channel, state)
		}
		else if (state.closed) {
			// The local side closed this generation: messages still in flight from the peer are stale.
			return
		}
		deliver(state, envelope.payload)
	}

	/** Delivers buffered messages, in order, to whoever is subscribed when it runs. */
	function flush(state: ChannelState): void {
		state.flushScheduled = false
		while (state.buffer.length > 0 && state.messageListeners.size > 0 && !state.closed) {
			const message = state.buffer.shift()
			for (const listener of [...state.messageListeners]) {
				try {
					listener(message)
				}
				catch (error) {
					// One failing listener must not strand the rest of the buffer; report it outside the loop.
					queueMicrotask(() => {
						throw error
					})
				}
			}
		}
	}

	function scheduleFlush(state: ChannelState): void {
		if (state.flushScheduled)
			return
		state.flushScheduled = true
		// A microtask, so a subscriber finishes its own setup before the first buffered message arrives.
		queueMicrotask(() => flush(state))
	}

	function deliver(state: ChannelState, payload: unknown): void {
		// Stay behind anything already buffered so order is preserved across the first subscription.
		if (state.messageListeners.size > 0 && state.buffer.length === 0 && !state.flushScheduled) {
			for (const listener of [...state.messageListeners])
				listener(payload)
			return
		}
		state.buffer.push(payload)
		if (state.buffer.length > MAX_BUFFERED_MESSAGES_PER_CHANNEL)
			state.buffer.shift()
		if (state.messageListeners.size > 0)
			scheduleFlush(state)
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
			const existing = states.get(name)
			// Either a first open, or the previous generation of this name was closed: start fresh.
			const state = existing !== undefined && !existing.closed ? existing : createState()
			if (state !== existing) {
				state.closed = closed
				states.set(name, state)
			}
			state.opened = true
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
					if (state.buffer.length > 0)
						scheduleFlush(state)
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
			const envelope: HubCloseEnvelope = {
				type: MESSAGE_PORT_CHANNEL_HUB_TYPE,
				version: 1,
				kind: 'close',
			}
			try {
				port.postMessage(envelope)
			}
			catch {
				// The local hub still closes if the peer has already detached.
			}
			try {
				markHubClosed()
			}
			finally {
				port.close()
			}
		},
	}
}
