export interface InspectorTransport {
	send: (message: unknown) => void
	subscribe: (listener: (message: unknown) => void) => () => void
	subscribeClose: (listener: () => void) => () => void
	close: () => void
	readonly closed: boolean
}

export interface InProcessInspectorTransportPair {
	readonly client: InspectorTransport
	readonly agent: InspectorTransport
}

function cloneJson(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value)) as unknown
}

export function createInProcessInspectorTransportPair(): InProcessInspectorTransportPair {
	const clientListeners = new Set<(message: unknown) => void>()
	const agentListeners = new Set<(message: unknown) => void>()
	const closeListeners = new Set<() => void>()
	let closed = false

	function endpoint(
		ownListeners: Set<(message: unknown) => void>,
		peerListeners: Set<(message: unknown) => void>,
	): InspectorTransport {
		return {
			get closed() {
				return closed
			},
			send(message) {
				if (closed)
					throw new Error('Inspector transport is closed.')
				const cloned = cloneJson(message)
				for (const listener of [...peerListeners])
					listener(cloned)
			},
			subscribe(listener) {
				if (closed)
					return () => {}
				ownListeners.add(listener)
				return () => ownListeners.delete(listener)
			},
			subscribeClose(listener) {
				if (closed) {
					listener()
					return () => {}
				}
				closeListeners.add(listener)
				return () => closeListeners.delete(listener)
			},
			close() {
				if (closed)
					return
				closed = true
				clientListeners.clear()
				agentListeners.clear()
				const listeners = [...closeListeners]
				closeListeners.clear()
				for (const listener of listeners)
					listener()
			},
		}
	}

	return {
		client: endpoint(clientListeners, agentListeners),
		agent: endpoint(agentListeners, clientListeners),
	}
}

/**
 * Adapts a dedicated MessagePort to the same transport contract used by the in-process A1 bridge.
 *
 * Messages are JSON-cloned before posting even though MessagePort supports the wider structured-clone
 * algorithm. The Inspector protocol intentionally keeps a JSON-safe baseline so iframe and future
 * extension transports cannot observe different wire semantics.
 *
 * HTML MessagePort dispatches `close` to the entangled peer when a port is closed or its owning
 * document is destroyed. Local `close()` notifies this endpoint synchronously because the platform
 * close event is intentionally peer-facing.
 */
export function createMessagePortInspectorTransport(port: MessagePort): InspectorTransport {
	const messageListeners = new Set<(message: unknown) => void>()
	const closeListeners = new Set<() => void>()
	let closed = false

	function markClosed(): void {
		if (closed)
			return
		closed = true
		port.removeEventListener('message', onMessage)
		port.removeEventListener('close', onClose)
		messageListeners.clear()
		const listeners = [...closeListeners]
		closeListeners.clear()
		for (const listener of listeners)
			listener()
	}

	function onMessage(event: MessageEvent<unknown>): void {
		if (closed)
			return
		for (const listener of [...messageListeners])
			listener(event.data)
	}

	function onClose(): void {
		markClosed()
	}

	port.addEventListener('message', onMessage)
	// TypeScript's DOM event map has historically lagged the HTML Standard's MessagePort `close`
	// event, so use the generic EventTarget overload rather than weakening the transport contract.
	port.addEventListener('close', onClose)
	port.start()

	return {
		get closed() {
			return closed
		},
		send(message) {
			if (closed)
				throw new Error('Inspector transport is closed.')
			port.postMessage(cloneJson(message))
		},
		subscribe(listener) {
			if (closed)
				return () => {}
			messageListeners.add(listener)
			return () => messageListeners.delete(listener)
		},
		subscribeClose(listener) {
			if (closed) {
				listener()
				return () => {}
			}
			closeListeners.add(listener)
			return () => closeListeners.delete(listener)
		},
		close() {
			if (closed)
				return
			markClosed()
			port.close()
		},
	}
}
