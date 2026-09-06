import type { InspectorBlueprintSnapshot, InspectorClient } from '@deviltea/widget-devtools'
import type { LabLocale } from '../i18n/locale'
import type { LabTheme } from '../theme/theme'
import type { PreviewHostClient } from './client'
import type { PreviewHostDescriptor } from './protocol'
import {
	createInspectorClient,
	createMessagePortChannelHub,
} from '@deviltea/widget-devtools'
import { createInspectorFrameBootstrapRequest } from '@deviltea/widget-devtools/frame-bootstrap'
import { createPreviewHostClient } from './client'
import { PREVIEW_HOST_CHANNEL, PREVIEW_INSPECTOR_CHANNEL } from './protocol'

export interface PreviewFrameConnection {
	readonly generation: number
	readonly revision: number
	readonly runtimeId: string
	readonly blueprint: InspectorBlueprintSnapshot
	readonly inspectorClient: InspectorClient
	readonly hostClient: PreviewHostClient
}

export interface PreviewFrameDriver {
	mount: (descriptor: PreviewHostDescriptor) => Promise<PreviewFrameConnection>
	updatePresentation: (locale: LabLocale, theme: LabTheme) => void
	setTutorialSpotlight: (target: string | null) => void
	evaluateTutorial: (tourId: 'survey' | 'crm', stepIndex: number, progress: number) => Promise<number>
	onTutorialObservation: (listener: (tourId: 'survey' | 'crm') => void) => () => void
	dispose: () => void
}

interface PhysicalConnection {
	readonly generation: number
	readonly hub: ReturnType<typeof createMessagePortChannelHub>
	readonly hostClient: PreviewHostClient
	readonly inspectorClient: InspectorClient
}

function createSessionId(): string {
	try {
		if (typeof crypto.randomUUID === 'function')
			return `preview-${crypto.randomUUID()}`
	}
	catch {
		// Fall through to a document-scoped opaque token.
	}
	return `preview-${Date.now()}-${Math.random()
		.toString(36)
		.slice(2)}`
}

function frameUrl(sessionId: string, generation: number): string {
	const url = new URL(`${import.meta.env.BASE_URL}preview-frame.html`, location.origin)
	url.searchParams.set('session', sessionId)
	url.searchParams.set('generation', String(generation))
	return url.href
}

/** Browser-only owner of one same-origin Preview iframe and its transferred MessagePort. */
export function createPreviewFrameDriver(
	iframe: HTMLIFrameElement,
	presentation: () => { readonly locale: LabLocale, readonly theme: LabTheme },
): PreviewFrameDriver {
	const sessionId = createSessionId()
	const observationListeners = new Set<(tourId: 'survey' | 'crm') => void>()
	let generation = 0
	let physical: PhysicalConnection | null = null
	let connecting: Promise<PhysicalConnection> | null = null
	let disposed = false

	function teardownPhysical(): void {
		const current = physical
		physical = null
		connecting = null
		if (current === null)
			return
		current.inspectorClient.close()
		current.hostClient.close()
		if (!current.hub.closed)
			current.hub.close()
	}

	async function connect(): Promise<PhysicalConnection> {
		if (disposed)
			throw new Error('Preview frame driver is disposed.')
		if (physical !== null && !physical.hub.closed)
			return physical
		if (connecting !== null)
			return connecting

		connecting = new Promise<PhysicalConnection>((resolve, reject) => {
			generation++
			const targetGeneration = generation
			let onLoad: () => void
			const onError = () => {
				iframe.removeEventListener('load', onLoad)
				connecting = null
				reject(new Error('Preview iframe failed to load.'))
			}
			onLoad = () => {
				iframe.removeEventListener('error', onError)
				if (disposed || targetGeneration !== generation) {
					reject(new Error('Preview iframe load became stale.'))
					return
				}
				const target = iframe.contentWindow
				if (target === null) {
					reject(new Error('Preview iframe has no contentWindow.'))
					return
				}
				const native = new MessageChannel()
				const hub = createMessagePortChannelHub(native.port1)
				const hostTransport = hub.openChannel(PREVIEW_HOST_CHANNEL)
				const inspectorTransport = hub.openChannel(PREVIEW_INSPECTOR_CHANNEL)
				const hostClient = createPreviewHostClient(hostTransport)
				const inspectorClient = createInspectorClient(inspectorTransport)
				const result: PhysicalConnection = {
					generation: targetGeneration,
					hub,
					hostClient,
					inspectorClient,
				}
				hostClient.onEvent((event) => {
					if (event.kind === 'tutorial.observation-changed') {
						for (const listener of [...observationListeners])
							listener(event.tourId)
					}
				})
				hostTransport.subscribeClose(() => {
					if (physical === result)
						physical = null
				})
				target.postMessage(
					createInspectorFrameBootstrapRequest(sessionId, targetGeneration),
					location.origin,
					[native.port2],
				)
				physical = result
				connecting = null
				resolve(result)
			}
			iframe.addEventListener('load', onLoad, { once: true })
			iframe.addEventListener('error', onError, { once: true })
			iframe.src = frameUrl(sessionId, targetGeneration)
		})
		return connecting
	}

	async function mount(descriptor: PreviewHostDescriptor): Promise<PreviewFrameConnection> {
		const current = await connect()
		const currentPresentation = presentation()
		current.hostClient.updatePresentation(currentPresentation.locale, currentPresentation.theme)
		const mounted = await current.hostClient.mount(sessionId, current.generation, descriptor)
		await current.inspectorClient.handshake()
		const blueprint = await current.inspectorClient.request('blueprint.getSnapshot', { runtimeId: mounted.runtimeId })
		return {
			generation: current.generation,
			revision: mounted.revision,
			runtimeId: mounted.runtimeId,
			blueprint,
			inspectorClient: current.inspectorClient,
			hostClient: current.hostClient,
		}
	}

	return {
		mount,
		updatePresentation(locale, theme) {
			physical?.hostClient.updatePresentation(locale, theme)
		},
		setTutorialSpotlight(target) {
			physical?.hostClient.setTutorialSpotlight(target)
		},
		async evaluateTutorial(tourId, stepIndex, progress) {
			const current = physical
			if (current === null)
				return progress
			const response = await current.hostClient.evaluateTutorial(tourId, stepIndex, progress)
			return response.progress
		},
		onTutorialObservation(listener) {
			observationListeners.add(listener)
			return () => observationListeners.delete(listener)
		},
		dispose() {
			if (disposed)
				return
			disposed = true
			observationListeners.clear()
			teardownPhysical()
			iframe.removeAttribute('src')
		},
	}
}
