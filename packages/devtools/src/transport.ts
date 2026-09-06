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
