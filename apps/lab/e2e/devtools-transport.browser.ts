import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { InspectorRequestResult } from '@deviltea/widget-devtools'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import {
	createInProcessInspectorTransportPair,
	createInspectorClient,
	createMessagePortChannelHub,
	createMessagePortInspectorTransport,
	InspectorClientError,
	isCompatibleProtocolVersion,
	isInspectorRequestResult,
	parseInspectorRequestMessage,
	parseInspectorResponseMessage,
} from '@deviltea/widget-devtools'
import { createInspectorAgent } from '@deviltea/widget-devtools/agent'
import { createInspectorFrameBootstrapRequest } from '@deviltea/widget-devtools/frame-bootstrap'
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
	readonly navigationUnrelatedRpcResponseDidNotAcknowledge: boolean
	readonly navigationAgentResponseAttempted: boolean
	readonly navigationOwnerClosedInspectorClient: boolean
	readonly navigationPendingRequestRejectedDisconnected: boolean
	readonly postNavigationOldClientRejectedDisconnected: boolean
	readonly navigationRemountAdvancedGeneration: boolean
	readonly navigationRemountInspectorRequestResolved: boolean
	readonly navigationRemountRuntimeListUsesOnlyReconnectedRuntimeId: boolean
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

interface InspectorResponseAttempt {
	readonly requestId: string
	readonly runtimes: InspectorRequestResult<'runtime.list'>['runtimes']
}

interface CapturedInspectorRequest {
	readonly method: 'runtime.list'
	readonly requestId: string
}

interface InspectorRequestResponseDrop {
	readonly runtimeListRequest: Promise<CapturedInspectorRequest>
	readonly unrelatedRequest: Promise<CapturedInspectorRequest>
	readonly unrelatedResponse: Promise<InspectorResponseAttempt>
	readonly attempted: Promise<InspectorResponseAttempt>
	restore: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inspectorChannelPayload(message: unknown): unknown | null {
	if (!isRecord(message)
		|| message.type !== '@deviltea/widget-devtools/message-port-channel'
		|| message.channel !== 'inspector'
		|| message.kind !== 'message'
		|| !('payload' in message)) {
		return null
	}
	return message.payload
}

function parseRuntimeListRequestAttempt(message: unknown): CapturedInspectorRequest | null {
	const payload = inspectorChannelPayload(message)
	if (payload === null)
		return null
	const request = parseInspectorRequestMessage(payload)
	if (request === null
		|| request.method !== 'runtime.list'
		|| !isCompatibleProtocolVersion(request.protocol)) {
		return null
	}
	return { method: 'runtime.list', requestId: request.requestId }
}

function parseRuntimeListResponseAttempt(message: unknown): InspectorResponseAttempt | null {
	const payload = inspectorChannelPayload(message)
	if (payload === null)
		return null
	const response = parseInspectorResponseMessage(payload)
	if (response === null
		|| !response.ok
		|| !isCompatibleProtocolVersion(response.protocol)
		|| !isInspectorRequestResult('runtime.list', response.result, response.protocol.minor)) {
		return null
	}

	return {
		requestId: response.requestId,
		runtimes: (response.result as InspectorRequestResult<'runtime.list'>).runtimes,
	}
}

function installRuntimeListResponseDrop(
	frame: HTMLIFrameElement,
	interceptOptions: { readonly includeConcurrentUnrelatedRequest?: boolean } = {},
): InspectorRequestResponseDrop {
	const frameWindow = frame.contentWindow
	if (frameWindow === null)
		throw new Error('Preview iframe window is unavailable after mount.')

	const framePrototype = (frameWindow as Window & typeof globalThis).MessagePort.prototype
	const patches = [
		{ prototype: MessagePort.prototype, scope: { observeRequests: true, observeResponses: false } },
		{ prototype: framePrototype, scope: { observeRequests: false, observeResponses: true } },
	].map(({ prototype, scope }) => {
		const descriptor = Object.getOwnPropertyDescriptor(prototype, 'postMessage')
		if (descriptor === undefined || typeof descriptor.value !== 'function')
			throw new Error('MessagePort.prototype.postMessage is unavailable in a DevTools transport realm.')
		return { prototype, scope, descriptor }
	})

	let resolveRuntimeListRequest!: (request: CapturedInspectorRequest) => void
	let resolveUnrelatedRequest!: (request: CapturedInspectorRequest) => void
	let resolveUnrelatedResponse!: (response: InspectorResponseAttempt) => void
	let resolveAttempt!: (attempt: InspectorResponseAttempt) => void
	const runtimeListRequest = new Promise<CapturedInspectorRequest>((resolve) => {
		resolveRuntimeListRequest = resolve
	})
	const unrelatedRequest = new Promise<CapturedInspectorRequest>((resolve) => {
		resolveUnrelatedRequest = resolve
	})
	const unrelatedResponse = new Promise<InspectorResponseAttempt>((resolve) => {
		resolveUnrelatedResponse = resolve
	})
	let restored = false
	let attemptedOnce = false
	let unrelatedResponseSeen = false
	let runtimeListRequestId: string | null = null
	let unrelatedRequestId: string | null = null
	const attempted = new Promise<InspectorResponseAttempt>((resolve) => {
		resolveAttempt = resolve
	})

	const restore = () => {
		if (restored)
			return
		restored = true
		for (const { prototype, descriptor } of patches)
			Object.defineProperty(prototype, 'postMessage', descriptor)
	}
	for (const { prototype, scope, descriptor } of patches) {
		const send = descriptor.value as (
			this: MessagePort,
			message: unknown,
			options?: Transferable[] | StructuredSerializeOptions,
		) => void
		const interceptedPostMessage = function (
			this: MessagePort,
			message: unknown,
			postMessageOptions?: Transferable[] | StructuredSerializeOptions,
		): void {
			if (scope.observeRequests) {
				const request = parseRuntimeListRequestAttempt(message)
				if (request !== null) {
					if (interceptOptions.includeConcurrentUnrelatedRequest && unrelatedRequestId === null) {
						unrelatedRequestId = request.requestId
						resolveUnrelatedRequest(request)
					}
					else if (runtimeListRequestId === null) {
						runtimeListRequestId = request.requestId
						resolveRuntimeListRequest(request)
					}
				}
			}

			if (scope.observeResponses && !attemptedOnce) {
				const acknowledgment = parseRuntimeListResponseAttempt(message)
				if (acknowledgment !== null && acknowledgment.requestId === runtimeListRequestId) {
					attemptedOnce = true
					// Resolve only for a valid runtime.list response carrying the test-owned requestId.
					// Drop it before postMessage returns so the Client request remains pending for teardown.
					restore()
					resolveAttempt(acknowledgment)
					return
				}

				const unrelated = parseRuntimeListResponseAttempt(message)
				if (unrelated !== null && unrelated.requestId === unrelatedRequestId && !unrelatedResponseSeen) {
					unrelatedResponseSeen = true
					resolveUnrelatedResponse(unrelated)
				}
			}

			send.call(this, message, postMessageOptions)
		}
		Object.defineProperty(prototype, 'postMessage', { ...descriptor, value: interceptedPostMessage })
	}

	return {
		runtimeListRequest,
		unrelatedRequest,
		unrelatedResponse,
		attempted,
		restore,
	}
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

export interface CrossOriginPreviewBootstrapBrowserContractResult {
	readonly parentAndFrameOriginsDiffer: boolean
	readonly untrustedBootstrapDidNotReceiveHostResponse: boolean
	readonly trustedCrossOriginBootstrapMounted: boolean
	readonly trustedCrossOriginInspectorRequestResolved: boolean
}

function previewFrameUrl(frameOrigin: string, parentOrigin: string, sessionId: string, generation: number): string {
	const url = new URL('/preview-frame.html', frameOrigin)
	url.searchParams.set('session', sessionId)
	url.searchParams.set('generation', String(generation))
	url.searchParams.set('parentOrigin', parentOrigin)
	return url.href
}

export async function runCrossOriginPreviewBootstrapBrowserContracts(): Promise<CrossOriginPreviewBootstrapBrowserContractResult> {
	const parentOrigin = location.origin
	const frameOriginUrl = new URL(location.href)
	frameOriginUrl.hostname = location.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1'
	const frameOrigin = frameOriginUrl.origin
	if (frameOrigin === parentOrigin)
		throw new Error('Cross-origin bootstrap contract requires distinct parent and frame origins.')

	const untrustedSessionId = 'preview-untrusted-bootstrap-contract'
	const untrustedGeneration = 2
	const untrustedTarget = document.createElement('iframe')
	untrustedTarget.name = 'preview-bootstrap-target'
	document.body.append(untrustedTarget)
	const targetLoaded = new Promise<void>((resolve) => {
		untrustedTarget.addEventListener('load', () => resolve(), { once: true })
	})
	untrustedTarget.src = previewFrameUrl(frameOrigin, parentOrigin, untrustedSessionId, untrustedGeneration)

	const attacker = document.createElement('iframe')
	const attackerUrl = new URL('/e2e/fixtures/preview-bootstrap-attacker.html', frameOrigin)
	attackerUrl.searchParams.set('parentOrigin', parentOrigin)
	const attackerLoaded = new Promise<void>((resolve) => {
		attacker.addEventListener('load', () => resolve(), { once: true })
	})
	attacker.src = attackerUrl.href
	document.body.append(attacker)

	let disposeDriver = () => {}
	let driverFrame: HTMLIFrameElement | null = null
	let onForwardedMessage: ((event: MessageEvent<unknown>) => void) | null = null
	let untrustedHub: ReturnType<typeof createMessagePortChannelHub> | null = null
	let stopUntrustedResponseListener = () => {}
	try {
		await Promise.all([
			withTestTimeout(targetLoaded, 'Cross-origin preview frame load'),
			withTestTimeout(attackerLoaded, 'Cross-origin bootstrap attacker load'),
		])
		const attackerWindow = attacker.contentWindow
		if (attackerWindow === null)
			throw new Error('Cross-origin bootstrap attacker window is unavailable.')

		let resolveForwarded!: () => void
		const forwarded = new Promise<void>((resolve) => {
			resolveForwarded = resolve
		})
		onForwardedMessage = (event) => {
			if (event.source !== attackerWindow
				|| typeof event.data !== 'object'
				|| event.data === null
				|| !('type' in event.data)
				|| event.data.type !== 'preview-bootstrap-forwarded') {
				return
			}
			resolveForwarded()
		}
		window.addEventListener('message', onForwardedMessage)

		const attackerChannel = new MessageChannel()
		untrustedHub = createMessagePortChannelHub(attackerChannel.port1)
		const untrustedHostTransport = untrustedHub.openChannel('preview-host')
		const untrustedRequestId = 'preview-bootstrap-untrusted-mount'
		let resolveUntrustedResponse!: () => void
		const untrustedResponse = new Promise<void>((resolve) => {
			resolveUntrustedResponse = resolve
		})
		stopUntrustedResponseListener = untrustedHostTransport.subscribe((message) => {
			if (isRecord(message)
				&& message.protocol === 1
				&& message.requestId === untrustedRequestId
				&& (message.kind === 'mounted' || message.kind === 'error')) {
				resolveUntrustedResponse()
			}
		})
		untrustedHostTransport.send({
			protocol: 1,
			kind: 'mount',
			requestId: untrustedRequestId,
			sessionId: untrustedSessionId,
			generation: untrustedGeneration,
			preview: {
				showcaseId: 'sandbox',
				revision: 0,
				sourceText: defaultSandboxPreset.sourceText,
			},
		})
		attackerWindow.postMessage({
			type: 'preview-bootstrap-forward',
			bootstrap: createInspectorFrameBootstrapRequest(untrustedSessionId, untrustedGeneration),
			targetOrigin: frameOrigin,
		}, frameOrigin, [attackerChannel.port2])
		await withTestTimeout(forwarded, 'Untrusted cross-origin bootstrap relay')
		const untrustedBootstrapResponded = await Promise.race([
			untrustedResponse.then(() => true),
			new Promise<boolean>(resolve => setTimeout(resolve, 3_000, false)),
		])
		stopUntrustedResponseListener()
		stopUntrustedResponseListener = () => {}
		if (!untrustedHub.closed)
			untrustedHub.close()
		untrustedHub = null

		driverFrame = document.createElement('iframe')
		document.body.append(driverFrame)
		const driverModuleUrl = new URL('/src/preview-host/frame-driver.ts', parentOrigin).href
		const { createPreviewFrameDriver } = await import(/* @vite-ignore */ driverModuleUrl) as {
			createPreviewFrameDriver: (
				frame: HTMLIFrameElement,
				presentation: () => { readonly locale: 'en', readonly theme: 'light' },
				options?: { readonly frameOrigin?: string },
			) => {
				mount: (descriptor: { readonly showcaseId: string, readonly revision: number, readonly sourceText: string }) => Promise<{
					readonly generation: number
					readonly runtimeId: string
					readonly inspectorClient: {
						request: (method: string, params: Record<string, unknown>) => Promise<unknown>
					}
				}>
				dispose: () => void
			}
		}
		const driver = createPreviewFrameDriver(
			driverFrame,
			() => ({ locale: 'en', theme: 'light' }),
			{ frameOrigin },
		)
		disposeDriver = () => driver.dispose()
		const connection = await withTestTimeout(driver.mount({
			showcaseId: 'sandbox',
			revision: 0,
			sourceText: defaultSandboxPreset.sourceText,
		}), 'Trusted cross-origin Preview bootstrap', 8_000)
		const runtimes = await withTestTimeout(
			connection.inspectorClient.request('runtime.list', {}),
			'Trusted cross-origin Inspector request',
		) as InspectorRequestResult<'runtime.list'>

		return {
			parentAndFrameOriginsDiffer: frameOrigin !== parentOrigin,
			untrustedBootstrapDidNotReceiveHostResponse: !untrustedBootstrapResponded,
			trustedCrossOriginBootstrapMounted: connection.runtimeId.length > 0 && connection.generation > 0,
			trustedCrossOriginInspectorRequestResolved: runtimes.runtimes.some(runtime => runtime.runtimeId === connection.runtimeId),
		}
	}
	finally {
		if (onForwardedMessage !== null)
			window.removeEventListener('message', onForwardedMessage)
		stopUntrustedResponseListener()
		if (untrustedHub !== null && !untrustedHub.closed)
			untrustedHub.close()
		disposeDriver()
		driverFrame?.remove()
		attacker.remove()
		untrustedTarget.remove()
	}
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
	const transportCloseEnvelopeReceived = new Promise<void>((resolve) => {
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
				resolve()
			}
		})
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
	await withTestTimeout(transportCloseEnvelopeReceived, 'Inspector transport close envelope')
	await withTestTimeout(transportPending.then(() => {}, () => {}), 'Inspector transport pending request settlement')
	const transportExplicitCloseAtPeer = transportExplicitClosePropagated
	const transportControlWasNotDeliveredAsInspectorPayload = transportPayloads === 0
	const transportPendingClientWasRejected = transportPendingClientRejected
	transportClient.dispose()
	rightTransport.close()

	const nativeHub = new MessageChannel()
	let hubCloseEnvelopeDelivered = false
	const hubCloseEnvelopeReceived = new Promise<void>((resolve) => {
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
				resolve()
			}
		})
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
	const auxiliaryChannelClosed = new Promise<void>((resolve) => {
		rightAuxiliary.subscribeClose(resolve)
	})
	const hubPending = hubClient.request('runtime.list', {})
	void hubPending.catch((error: unknown) => {
		hubPendingClientRejected = error instanceof InspectorClientError
			&& error.protocolError.code === 'disconnected'
	})
	leftInspector.send({ type: '@deviltea/widget-devtools/message-port-channel-hub', kind: 'close' })
	await payloadDelivered
	leftAuxiliary.close()
	await withTestTimeout(auxiliaryChannelClosed, 'Logical auxiliary channel close')
	const logicalChannelCloseIsolated = !leftHub.closed
		&& !rightHub.closed
		&& !leftInspector.closed
		&& !rightInspector.closed
		&& !leftHost.closed
		&& !rightHost.closed
		&& leftAuxiliary.closed
		&& rightAuxiliary.closed
	leftHub.close()
	await withTestTimeout(hubCloseEnvelopeReceived, 'Channel hub close envelope')
	await withTestTimeout(hubPending.then(() => {}, () => {}), 'Channel hub pending request settlement')
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
					request: (method: string, params: Record<string, unknown>) => Promise<unknown>
					close: () => void
				}
				generation: number
				runtimeId: string
			}>
			dispose: () => void
		}
	}
	const driver = createPreviewFrameDriver(iframe, () => ({ locale: 'en', theme: 'light' }))
	let navigationRequestPendingBeforeLoad = false
	let navigationUnrelatedRpcResponseDidNotAcknowledge = false
	let navigationAgentResponseAttempted = false
	let navigationOwnerClosedInspectorClient = false
	let navigationPendingRequestRejectedDisconnected = false
	let postNavigationOldClientRejectedDisconnected = false
	let navigationRemountAdvancedGeneration = false
	let navigationRemountInspectorRequestResolved = false
	let navigationRemountRuntimeListUsesOnlyReconnectedRuntimeId = false
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
		const navigationInterceptor = installRuntimeListResponseDrop(iframe, { includeConcurrentUnrelatedRequest: true })
		restoreResponseInterceptor = navigationInterceptor.restore
		const navigationClose = observeClientClose(connection.inspectorClient)
		restoreClientCloseObserver = navigationClose.restore
		// Send both while the client has both requests pending; the first response is a valid runtime.list with a different requestId.
		const unrelatedPending = connection.inspectorClient.request('runtime.list', {})
		const navigationPending = connection.inspectorClient.request('runtime.list', {})
		const navigationOutcome = observeRequestOutcome(navigationPending)
		const unrelatedRequest = await withTestTimeout(navigationInterceptor.unrelatedRequest, 'Concurrent companion runtime.list request capture')
		const navigationRequest = await withTestTimeout(navigationInterceptor.runtimeListRequest, 'Test-owned runtime.list request capture')
		const unrelatedResponse = await withTestTimeout(navigationInterceptor.unrelatedResponse, 'Concurrent companion runtime.list response')
		const unrelatedRuntimes = await withTestTimeout(unrelatedPending, 'Concurrent companion runtime.list resolution') as InspectorRequestResult<'runtime.list'>
		// The target response may already have been sent while its companion travels back to the parent.
		// Check distinct IDs and delivery, not cross-realm response scheduling order.
		navigationUnrelatedRpcResponseDidNotAcknowledge = unrelatedRequest.method === 'runtime.list'
			&& navigationRequest.method === 'runtime.list'
			&& unrelatedRequest.requestId !== navigationRequest.requestId
			&& unrelatedResponse.requestId === unrelatedRequest.requestId
			&& unrelatedResponse.runtimes.length > 0
			&& unrelatedRuntimes.runtimes.length > 0
			&& unrelatedRuntimes.runtimes[0]?.runtimeId === connection.runtimeId
		const navigationResponse = await withTestTimeout(navigationInterceptor.attempted, 'Navigation runtime.list response attempt')
		navigationAgentResponseAttempted = navigationResponse.requestId === navigationRequest.requestId
			&& navigationResponse.runtimes.length > 0
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
				readonly runtimes: InspectorRequestResult<'runtime.list'>['runtimes']
			}
			navigationRemountInspectorRequestResolved = reconnectedRuntimes.runtimes.length > 0
			const reconnectedRuntimeIds = reconnectedRuntimes.runtimes.map(runtime => runtime.runtimeId)
			navigationRemountRuntimeListUsesOnlyReconnectedRuntimeId = reconnected.runtimeId !== connection.runtimeId
				&& reconnectedRuntimeIds.includes(reconnected.runtimeId)
				&& !reconnectedRuntimeIds.includes(connection.runtimeId)

			const removalInterceptor = installRuntimeListResponseDrop(iframe)
			restoreResponseInterceptor = removalInterceptor.restore
			const removalClose = observeClientClose(reconnected.inspectorClient)
			restoreClientCloseObserver = removalClose.restore
			const removalPending = reconnected.inspectorClient.request('runtime.list', {})
			const removalOutcome = observeRequestOutcome(removalPending)
			const removalRequest = await withTestTimeout(removalInterceptor.runtimeListRequest, 'Owner-dispose runtime.list request capture')
			const removalResponse = await withTestTimeout(removalInterceptor.attempted, 'Owner-dispose runtime.list response attempt')
			removalAgentResponseAttempted = removalResponse.requestId === removalRequest.requestId
				&& removalResponse.runtimes.length > 0
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
		navigationUnrelatedRpcResponseDidNotAcknowledge,
		navigationAgentResponseAttempted,
		navigationOwnerClosedInspectorClient,
		navigationPendingRequestRejectedDisconnected,
		postNavigationOldClientRejectedDisconnected,
		navigationRemountAdvancedGeneration,
		navigationRemountInspectorRequestResolved,
		navigationRemountRuntimeListUsesOnlyReconnectedRuntimeId,
		removalRequestPendingBeforeDispose,
		removalAgentResponseAttempted,
		removalOwnerClosedInspectorClient,
		removalPendingRequestRejectedDisconnected,
	}
}

export interface DevtoolsGeometryBrowserContractResult {
	readonly shadowWidgetTargetWidgetId: string | null
	readonly shadowWidgetTargetWidgetType: string | null
	readonly shadowWidgetHitVisibility: string | null
	readonly overlayCoveredHitResultIsNull: boolean
	readonly documentElementsFromPointRetargetedToHost: boolean
	readonly shadowElementsFromPointTopmostIsOverlay: boolean
}

interface GeometryFixtureRootInterfaces extends WidgetInterfaces {
	slots: 'items'
}

interface GeometryFixtureCounterInterfaces extends WidgetInterfaces {
	state: {
		count: number
	}
}

export async function runDevtoolsGeometryBrowserContracts(): Promise<DevtoolsGeometryBrowserContractResult> {
	const RootPlugin = createWidgetPlugin('Root')
		.description('Root fixture')
		.interfaces<GeometryFixtureRootInterfaces>()
		.slots({ items: { description: 'Items' } })
		.done()

	const CounterPlugin = createWidgetPlugin('Counter')
		.description('Counter fixture')
		.interfaces<GeometryFixtureCounterInterfaces>()
		.state(state => state.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}))
		.done()

	const system = createWidgetSystem({ plugins: [RootPlugin, CounterPlugin] })
	const blueprint = system.createBlueprint({
		id: 'root',
		type: 'Root',
		slots: {
			items: [
				{ id: 'counter-1', type: 'Counter' },
			],
		},
	})
	if (blueprint.status !== 'valid')
		throw new Error('Expected valid geometry fixture Blueprint.')
	const runtime = blueprint.createRuntime()

	const host = document.createElement('div')
	host.id = 'geometry-shadow-host'
	host.style.cssText = 'position: absolute; left: 0; top: 0; width: 400px; height: 300px;'
	document.body.append(host)
	const shadowRoot = host.attachShadow({ mode: 'open' })

	const style = document.createElement('style')
	style.textContent = `
		.preview-root {
			position: absolute;
			left: 0;
			top: 0;
			width: 400px;
			height: 300px;
		}
		.widget-counter {
			position: absolute;
			left: 20px;
			top: 20px;
			width: 120px;
			height: 40px;
			background: #eee;
		}
		.topmost-overlay {
			position: absolute;
			left: 10px;
			top: 10px;
			width: 140px;
			height: 60px;
			z-index: 10;
			background: rgba(0, 0, 0, 0.5);
		}
	`
	shadowRoot.append(style)

	const root = document.createElement('div')
	root.className = 'preview-root'
	root.dataset.widgetId = 'root'
	root.dataset.widgetType = 'Root'

	const widget = document.createElement('div')
	widget.className = 'widget-counter'
	widget.dataset.widgetId = 'counter-1'
	widget.dataset.widgetType = 'Counter'
	widget.textContent = 'Counter'
	root.append(widget)
	shadowRoot.append(root)

	const overlay = document.createElement('div')
	overlay.className = 'topmost-overlay'

	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({
		runtime,
		transport: pair.agent,
		runtimeId: 'runtime-geometry-contract',
		dom: { root },
	})
	const client = createInspectorClient(pair.client)

	try {
		// 1. Without overlay: inspect.hitTest resolves the inner widget inside ShadowRoot
		const uncovered = await client.request('inspect.hitTest', {
			coordinateSpace: 'preview-viewport',
			x: 40,
			y: 40,
		})

		// Verify document.elementsFromPoint retargets internal Shadow DOM element to the host
		const docElements = document.elementsFromPoint(40, 40)
		const documentElementsFromPointRetargetedToHost = docElements.length > 0 && docElements[0] === host

		// 2. Attach topmost non-semantic overlay as a sibling of bounded root inside shadowRoot
		shadowRoot.append(overlay)

		// Verify native shadowRoot.elementsFromPoint places the overlay topmost
		const shadowElements = shadowRoot.elementsFromPoint(40, 40)
		const shadowElementsFromPointTopmostIsOverlay = shadowElements.length > 0 && shadowElements[0] === overlay

		// With overlay covering the same coordinates: hitTest returns target: null (suppressed)
		const covered = await client.request('inspect.hitTest', {
			coordinateSpace: 'preview-viewport',
			x: 40,
			y: 40,
		})

		return {
			shadowWidgetTargetWidgetId: uncovered.target?.widgetId ?? null,
			shadowWidgetTargetWidgetType: uncovered.target?.widgetType ?? null,
			shadowWidgetHitVisibility: uncovered.target !== null ? uncovered.geometry.visibility : null,
			overlayCoveredHitResultIsNull: covered.target === null,
			documentElementsFromPointRetargetedToHost,
			shadowElementsFromPointTopmostIsOverlay,
		}
	}
	finally {
		client.dispose()
		agent.dispose()
		runtime.dispose()
		host.remove()
	}
}
