import {
	createInspectorClient,
	createMessagePortChannelHub,
	createMessagePortInspectorTransport,
	InspectorClientError,
} from '@deviltea/widget-devtools'
import { defaultSandboxPreset } from '../src/sandbox/presets'

export interface DevtoolsBrowserContractResult {
	readonly transportExplicitClosePropagated: boolean
	readonly transportCloseEnvelopeDelivered: boolean
	readonly transportControlWasNotDeliveredAsInspectorPayload: boolean
	readonly transportPendingClientRejected: boolean
	readonly hubExplicitClosePropagated: boolean
	readonly hubCloseEnvelopeDelivered: boolean
	readonly hubPendingClientRejected: boolean
	readonly logicalChannelCloseIsolated: boolean
	readonly payloadWithHubControlTagDelivered: boolean
	readonly navigationRequestPendingBeforeLoad: boolean
	readonly navigationAgentResponseAttempted: boolean
	readonly navigationOwnerClosedInspectorClient: boolean
	readonly navigationPendingRequestRejectedDisconnected: boolean
	readonly postNavigationOldClientRejectedDisconnected: boolean
	readonly navigationRemountAdvancedGeneration: boolean
	readonly navigationRemountInspectorRequestResolved: boolean
	readonly removalRequestPendingBeforeDispose: boolean
	readonly removalAgentResponseAttempted: boolean
	readonly removalOwnerClosedInspectorClient: boolean
	readonly removalPendingRequestRejectedDisconnected: boolean
}

type PendingRequestOutcome = 'pending' | 'resolved' | 'rejected-disconnected' | 'rejected-other'

function observeRequestOutcome(request: Promise<unknown>): () => PendingRequestOutcome {
	let outcome: PendingRequestOutcome = 'pending'
	void request.then(
		() => { outcome = 'resolved' },
		(error: unknown) => {
			outcome = error instanceof InspectorClientError && error.protocolError.code === 'disconnected'
				? 'rejected-disconnected'
				: 'rejected-other'
		},
	)
	return () => outcome
}

function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds))
}

interface InspectorResponseAttempt {
	readonly requestId: string
	readonly runtimeCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRuntimeListResponseAttempt(message: unknown): InspectorResponseAttempt | null {
	if (!isRecord(message)
		|| message.type !== '@deviltea/widget-devtools/message-port-channel'
		|| message.channel !== 'inspector'
		|| message.kind !== 'message'
		|| !isRecord(message.payload)
		|| message.payload.kind !== 'response'
		|| typeof message.payload.requestId !== 'string'
		|| message.payload.ok !== true
		|| !isRecord(message.payload.result)
		|| !Array.isArray(message.payload.result.runtimes)) {
		return null
	}

	return {
		requestId: message.payload.requestId,
		runtimeCount: message.payload.result.runtimes.length,
	}
}

function installRuntimeListResponseDrop(frame: HTMLIFrameElement): {
	attempted: Promise<InspectorResponseAttempt>
	restore: () => void
} {
	const frameWindow = frame.contentWindow
	if (frameWindow === null)
		throw new Error('Preview iframe window is unavailable after mount.')

	const prototype = (frameWindow as Window & typeof globalThis).MessagePort.prototype
	const descriptor = Object.getOwnPropertyDescriptor(prototype, 'postMessage')
	if (descriptor === undefined || typeof descriptor.value !== 'function')
		throw new Error('Preview iframe MessagePort.prototype.postMessage is unavailable.')

	const originalPostMessage = descriptor.value as (
		this: MessagePort,
		message: unknown,
		options?: Transferable[] | StructuredSerializeOptions,
	) => void
	let resolveAttempt!: (attempt: InspectorResponseAttempt) => void
	let restored = false
	let attemptedOnce = false
	const attempted = new Promise<InspectorResponseAttempt>((resolve) => {
		resolveAttempt = resolve
	})

	const restore = () => {
		if (restored)
			return
		restored = true
		Object.defineProperty(prototype, 'postMessage', descriptor)
	}
	const interceptedPostMessage = function (
		this: MessagePort,
		message: unknown,
		options?: Transferable[] | StructuredSerializeOptions,
	): void {
		const acknowledgment = attemptedOnce ? null : parseRuntimeListResponseAttempt(message)
		if (acknowledgment !== null) {
			attemptedOnce = true
			// Resolve inside postMessage before returning. The caller waits for this acknowledgment
			// before navigation/disposal, so the Agent has attempted the valid runtime.list response.
			restore()
			resolveAttempt(acknowledgment)
			return
		}

		originalPostMessage.call(this, message, options)
	}
	Object.defineProperty(prototype, 'postMessage', { ...descriptor, value: interceptedPostMessage })
	return { attempted, restore }
}

function withTestTimeout<T>(promise: Promise<T>, label: string, milliseconds = 3_000): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds} ms.`)), milliseconds)
		void promise.then(
			(value) => {
				clearTimeout(timeout)
				resolve(value)
			},
			(error: unknown) => {
				clearTimeout(timeout)
				reject(error)
			},
		)
	})
}

function observeClientClose(client: { close: () => void }): {
	readonly wasClosed: () => boolean
	readonly restore: () => void
} {
	const originalClose = client.close
	let wasClosed = false
	client.close = () => {
		wasClosed = true
		originalClose.call(client)
	}
	return {
		wasClosed: () => wasClosed,
		restore: () => { client.close = originalClose },
	}
}

export async function runDevtoolsBrowserContracts(): Promise<DevtoolsBrowserContractResult> {
	const nativeTransport = new MessageChannel()
	let transportCloseEnvelopeDelivered = false
	nativeTransport.port2.addEventListener('message', (event: MessageEvent<unknown>) => {
		if (typeof event.data === 'object'
			&& event.data !== null
			&& 'type' in event.data
			&& event.data.type === '@deviltea/widget-devtools/message-port-inspector-transport'
			&& 'version' in event.data
			&& event.data.version === 1
			&& 'kind' in event.data
			&& event.data.kind === 'close') {
			transportCloseEnvelopeDelivered = true
		}
	})
	const leftTransport = createMessagePortInspectorTransport(nativeTransport.port1)
	const rightTransport = createMessagePortInspectorTransport(nativeTransport.port2)
	const transportClient = createInspectorClient(rightTransport)
	let transportExplicitClosePropagated = false
	let transportPayloads = 0
	let transportPendingClientRejected = false
	rightTransport.subscribeClose(() => {
		transportExplicitClosePropagated = true
	})
	rightTransport.subscribe(() => {
		transportPayloads++
	})
	const transportPending = transportClient.request('runtime.list', {})
	void transportPending.catch((error: unknown) => {
		transportPendingClientRejected = error instanceof InspectorClientError
			&& error.protocolError.code === 'disconnected'
	})
	leftTransport.close()
	await delay(100)
	const transportExplicitCloseAtPeer = transportExplicitClosePropagated
	const transportControlWasNotDeliveredAsInspectorPayload = transportPayloads === 0
	const transportPendingClientWasRejected = transportPendingClientRejected
	transportClient.dispose()
	rightTransport.close()

	const nativeHub = new MessageChannel()
	let hubCloseEnvelopeDelivered = false
	nativeHub.port2.addEventListener('message', (event: MessageEvent<unknown>) => {
		if (typeof event.data === 'object'
			&& event.data !== null
			&& 'type' in event.data
			&& event.data.type === '@deviltea/widget-devtools/message-port-channel-hub'
			&& 'version' in event.data
			&& event.data.version === 1
			&& 'kind' in event.data
			&& event.data.kind === 'close') {
			hubCloseEnvelopeDelivered = true
		}
	})
	const leftHub = createMessagePortChannelHub(nativeHub.port1)
	const rightHub = createMessagePortChannelHub(nativeHub.port2)
	const leftInspector = leftHub.openChannel('inspector')
	const rightInspector = rightHub.openChannel('inspector')
	const leftHost = leftHub.openChannel('host')
	const rightHost = rightHub.openChannel('host')
	const leftAuxiliary = leftHub.openChannel('auxiliary')
	const rightAuxiliary = rightHub.openChannel('auxiliary')
	const hubClient = createInspectorClient(rightInspector)
	let rightInspectorClosed = false
	let rightHostClosed = false
	let hubPendingClientRejected = false
	rightInspector.subscribeClose(() => {
		rightInspectorClosed = true
	})
	rightHost.subscribeClose(() => {
		rightHostClosed = true
	})
	let payloadWithHubControlTagDelivered = false
	const payloadDelivered = new Promise<void>((resolve) => {
		rightInspector.subscribe((payload) => {
			if (typeof payload === 'object'
				&& payload !== null
				&& 'kind' in payload
				&& payload.kind === 'close'
				&& 'type' in payload
				&& payload.type === '@deviltea/widget-devtools/message-port-channel-hub') {
				payloadWithHubControlTagDelivered = true
				resolve()
			}
		})
	})
	const hubPending = hubClient.request('runtime.list', {})
	void hubPending.catch((error: unknown) => {
		hubPendingClientRejected = error instanceof InspectorClientError
			&& error.protocolError.code === 'disconnected'
	})
	leftInspector.send({ type: '@deviltea/widget-devtools/message-port-channel-hub', kind: 'close' })
	await payloadDelivered
	leftAuxiliary.close()
	await delay(50)
	const logicalChannelCloseIsolated = !leftHub.closed
		&& !rightHub.closed
		&& !leftInspector.closed
		&& !rightInspector.closed
		&& !leftHost.closed
		&& !rightHost.closed
		&& leftAuxiliary.closed
		&& rightAuxiliary.closed
	leftHub.close()
	await delay(100)
	const hubExplicitClosePropagated = rightHub.closed && rightInspectorClosed && rightHostClosed
	const hubPendingClientWasRejected = hubPendingClientRejected
	hubClient.dispose()
	rightHub.close()

	const iframe = document.createElement('iframe')
	iframe.setAttribute('aria-hidden', 'true')
	document.body.append(iframe)
	const driverModuleUrl = new URL('/src/preview-host/frame-driver.ts', location.origin).href
	const { createPreviewFrameDriver } = await import(/* @vite-ignore */ driverModuleUrl) as {
		createPreviewFrameDriver: (
			frame: HTMLIFrameElement,
			presentation: () => { readonly locale: 'en', readonly theme: 'light' },
		) => {
			mount: (descriptor: { readonly showcaseId: string, readonly revision: number, readonly sourceText: string }) => Promise<{
				inspectorClient: {
					request: (method: string, params: Record<string, never>) => Promise<unknown>
					close: () => void
				}
				generation: number
			}>
			dispose: () => void
		}
	}
	const driver = createPreviewFrameDriver(iframe, () => ({ locale: 'en', theme: 'light' }))
	let navigationRequestPendingBeforeLoad = false
	let navigationAgentResponseAttempted = false
	let navigationOwnerClosedInspectorClient = false
	let navigationPendingRequestRejectedDisconnected = false
	let postNavigationOldClientRejectedDisconnected = false
	let navigationRemountAdvancedGeneration = false
	let navigationRemountInspectorRequestResolved = false
	let removalRequestPendingBeforeDispose = false
	let removalAgentResponseAttempted = false
	let removalOwnerClosedInspectorClient = false
	let removalPendingRequestRejectedDisconnected = false
	let restoreResponseInterceptor = () => {}
	let restoreClientCloseObserver = () => {}
	try {
		const connection = await driver.mount({
			showcaseId: 'sandbox',
			revision: 0,
			sourceText: defaultSandboxPreset.sourceText,
		})
		const navigationInterceptor = installRuntimeListResponseDrop(iframe)
		restoreResponseInterceptor = navigationInterceptor.restore
		const navigationClose = observeClientClose(connection.inspectorClient)
		restoreClientCloseObserver = navigationClose.restore
		const navigationPending = connection.inspectorClient.request('runtime.list', {})
		const navigationOutcome = observeRequestOutcome(navigationPending)
		const navigationResponse = await withTestTimeout(navigationInterceptor.attempted, 'Navigation runtime.list response attempt')
		navigationAgentResponseAttempted = navigationResponse.requestId.length > 0 && navigationResponse.runtimeCount > 0
		navigationRequestPendingBeforeLoad = navigationOutcome() === 'pending'
		const navigationLoad = new Promise<void>((resolve) => {
			iframe.addEventListener('load', () => resolve(), { once: true })
		})
		iframe.src = 'about:blank'
		await withTestTimeout(navigationLoad, 'Preview iframe navigation load')
		navigationOwnerClosedInspectorClient = navigationClose.wasClosed()
		navigationInterceptor.restore()
		navigationClose.restore()
		restoreResponseInterceptor = () => {}
		restoreClientCloseObserver = () => {}
		await Promise.resolve()
		navigationPendingRequestRejectedDisconnected = navigationOutcome() === 'rejected-disconnected'

		const postNavigationRequest = connection.inspectorClient.request('runtime.list', {})
		const postNavigationOutcome = observeRequestOutcome(postNavigationRequest)
		await Promise.resolve()
		postNavigationOldClientRejectedDisconnected = postNavigationOutcome() === 'rejected-disconnected'

		// A broken navigation teardown leaves mount() waiting on the stale MessagePort; report its earlier failure directly.
		if (navigationPendingRequestRejectedDisconnected && postNavigationOldClientRejectedDisconnected) {
			const reconnected = await driver.mount({
				showcaseId: 'sandbox',
				revision: 0,
				sourceText: defaultSandboxPreset.sourceText,
			})
			navigationRemountAdvancedGeneration = reconnected.generation > connection.generation
			const reconnectedRuntimes = await reconnected.inspectorClient.request('runtime.list', {}) as {
				readonly runtimes: readonly unknown[]
			}
			navigationRemountInspectorRequestResolved = reconnectedRuntimes.runtimes.length > 0

			const removalInterceptor = installRuntimeListResponseDrop(iframe)
			restoreResponseInterceptor = removalInterceptor.restore
			const removalClose = observeClientClose(reconnected.inspectorClient)
			restoreClientCloseObserver = removalClose.restore
			const removalPending = reconnected.inspectorClient.request('runtime.list', {})
			const removalOutcome = observeRequestOutcome(removalPending)
			const removalResponse = await withTestTimeout(removalInterceptor.attempted, 'Owner-dispose runtime.list response attempt')
			removalAgentResponseAttempted = removalResponse.requestId.length > 0 && removalResponse.runtimeCount > 0
			removalRequestPendingBeforeDispose = removalOutcome() === 'pending'
			driver.dispose()
			removalOwnerClosedInspectorClient = removalClose.wasClosed()
			removalInterceptor.restore()
			removalClose.restore()
			restoreResponseInterceptor = () => {}
			restoreClientCloseObserver = () => {}
			iframe.remove()
			await Promise.resolve()
			removalPendingRequestRejectedDisconnected = removalOutcome() === 'rejected-disconnected'
		}
	}
	finally {
		restoreResponseInterceptor()
		restoreClientCloseObserver()
		driver.dispose()
		iframe.remove()
	}

	return {
		transportExplicitClosePropagated: transportExplicitCloseAtPeer,
		transportCloseEnvelopeDelivered,
		transportControlWasNotDeliveredAsInspectorPayload,
		transportPendingClientRejected: transportPendingClientWasRejected,
		hubExplicitClosePropagated,
		hubCloseEnvelopeDelivered,
		hubPendingClientRejected: hubPendingClientWasRejected,
		logicalChannelCloseIsolated,
		payloadWithHubControlTagDelivered,
		navigationRequestPendingBeforeLoad,
		navigationAgentResponseAttempted,
		navigationOwnerClosedInspectorClient,
		navigationPendingRequestRejectedDisconnected,
		postNavigationOldClientRejectedDisconnected,
		navigationRemountAdvancedGeneration,
		navigationRemountInspectorRequestResolved,
		removalRequestPendingBeforeDispose,
		removalAgentResponseAttempted,
		removalOwnerClosedInspectorClient,
		removalPendingRequestRejectedDisconnected,
	}
}
