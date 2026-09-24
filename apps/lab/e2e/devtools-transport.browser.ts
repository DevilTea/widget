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
	readonly navigationSettledInspectorRequest: 'rejected' | 'pending' | 'resolved'
	readonly removalSettledPendingInspectorRequest: boolean
}

function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds))
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
					request: (method: 'runtime.list', params: Record<string, never>) => Promise<unknown>
				}
			}>
			dispose: () => void
		}
	}
	const driver = createPreviewFrameDriver(iframe, () => ({ locale: 'en', theme: 'light' }))
	let navigationSettledInspectorRequest: DevtoolsBrowserContractResult['navigationSettledInspectorRequest'] = 'pending'
	let removalSettledPendingInspectorRequest = false
	try {
		const connection = await driver.mount({
			showcaseId: 'sandbox',
			revision: 0,
			sourceText: defaultSandboxPreset.sourceText,
		})
		iframe.src = 'about:blank'
		await new Promise<void>((resolve) => {
			iframe.addEventListener('load', () => resolve(), { once: true })
		})
		const request = connection.inspectorClient.request('runtime.list', {})
		void request.then(
			() => { navigationSettledInspectorRequest = 'resolved' },
			() => { navigationSettledInspectorRequest = 'rejected' },
		)
		await Promise.resolve()

		const reconnected = await driver.mount({
			showcaseId: 'sandbox',
			revision: 0,
			sourceText: defaultSandboxPreset.sourceText,
		})
		const removalPending = reconnected.inspectorClient.request('runtime.list', {})
		void removalPending.catch((error: unknown) => {
			removalSettledPendingInspectorRequest = error instanceof InspectorClientError
				&& error.protocolError.code === 'disconnected'
		})
		iframe.remove()
		driver.dispose()
		await Promise.resolve()
	}
	finally {
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
		navigationSettledInspectorRequest,
		removalSettledPendingInspectorRequest,
	}
}
