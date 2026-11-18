/**
 * Isolated Preview execution realm (issue #10 / Phase B2).
 *
 * The parent transfers exactly one bootstrap MessagePort. This frame owns the actual showcase Runtime,
 * Vue renderer, InspectorAgent, tutorial semantic observation, and inspected DOM.
 * The parent never receives Runtime/Blueprint objects or arbitrary Runtime values.
 */
import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import type { InspectorAgent } from '@deviltea/widget-inspector/agent'
import type { App } from 'vue'
import type { PreviewHostRequest } from './preview-host/protocol'
import type { ShowcaseHost } from './showcase-host'
import { createInspectorAgent } from '@deviltea/widget-inspector/agent'
import { createMessagePortChannelHub } from '@deviltea/widget-inspector/channel'
import {
	acceptInspectorFrameBootstrap,
} from '@deviltea/widget-inspector/frame-bootstrap'
import { createApp, defineComponent, h } from 'vue'
import { createLabI18nStore } from './composables/use-lab-i18n'
import { createLabThemeStore } from './composables/use-lab-theme'
import { loadShowcaseRenderer } from './preview-frame-renderers'
import { derivePreviewParentOrigin } from './preview-host/parent-origin'
import {
	parsePreviewHostCommand,
	parsePreviewHostRequest,
	PREVIEW_HOST_CHANNEL,
	PREVIEW_HOST_PROTOCOL_VERSION,
	PREVIEW_INSPECTOR_CHANNEL,
} from './preview-host/protocol'
import { ShowcaseHostKey } from './showcase-host'
import { getShowcase } from './showcases/registry'
import { createRuntimeReader, subscribeObservationTargets } from './tutorial/inspection-reader'
import { getTour } from './tutorial/tours'
import './styles/lab-tokens.css'
import './styles/tutorial-theme.css'
import './styles/preview-frame.css'

interface MountedPreview {
	readonly app: App
	readonly runtime: WidgetSystemRuntime
	readonly agent: InspectorAgent
	readonly revision: number
	readonly showcaseId: string
	readonly stopTutorialObservation: () => void
}

const params = new URLSearchParams(location.search)
const sessionId = params.get('session') ?? ''
const generationValue = Number(params.get('generation'))
const generation = Number.isSafeInteger(generationValue) && generationValue >= 0 ? generationValue : -1
// Bind bootstrap to the actual embedding parent reported by the browser. This is Preview's
// integration-isolation boundary, not a frame-ancestors allowlist or general security-sandbox policy.
const expectedParentOrigin = derivePreviewParentOrigin(document.referrer)

const i18n = createLabI18nStore()
const theme = createLabThemeStore()
/**
 * The frame-side adapter from the Lab's presentation stores to the showcase host contract
 * (`showcase-host/host.ts`): a showcase sees only the current locale and theme, never these stores.
 * The assignment is type-checked: if the Lab gains a locale or theme the contract does not know, this stops compiling.
 */
const showcaseHost: ShowcaseHost = { locale: i18n.locale, theme: theme.theme }
let mounted: MountedPreview | null = null
let bootstrapAccepted = false
let mountQueue: Promise<void> = Promise.resolve()

function sendSafely(transport: { readonly closed: boolean, send: (message: unknown) => void }, message: unknown): void {
	if (transport.closed)
		return
	try {
		transport.send(message)
	}
	catch {
		// Peer teardown wins; there is no useful recovery path inside the abandoned frame document.
	}
}

function clearTutorialSpotlight(): void {
	for (const element of document.querySelectorAll('.tutorial-spotlight'))
		element.classList.remove('tutorial-spotlight')
}

function setTutorialSpotlight(target: string | null): void {
	clearTutorialSpotlight()
	if (target === null)
		return
	for (const element of document.querySelectorAll('[data-tutorial-target]')) {
		if (element.getAttribute('data-tutorial-target') === target) {
			element.classList.add('tutorial-spotlight')
			return
		}
	}
}

function teardownMountedPreview(): void {
	const current = mounted
	if (current === null)
		return
	mounted = null
	current.stopTutorialObservation()
	current.agent.dispose()
	// Vue unmount is synchronous. Runtime disposal happens only after every renderer bridge is gone.
	current.app.unmount()
	if (!current.runtime.isDisposed)
		current.runtime.dispose()
	clearTutorialSpotlight()
}

function progressForRequest(request: Extract<PreviewHostRequest, { kind: 'tutorial.evaluate' }>): number {
	const current = mounted
	if (current === null || current.showcaseId !== request.tourId)
		return request.progress
	const script = getTour(request.tourId)?.script
	const step = script?.steps[request.stepIndex]
	if (step === undefined)
		return request.progress
	let progress = Math.min(request.progress, step.stages.length)
	const reader = createRuntimeReader(current.runtime)
	while (progress < step.stages.length) {
		const stage = step.stages[progress]!
		if (stage.isComplete !== undefined && !stage.isComplete(reader))
			break
		progress++
	}
	return progress
}

window.addEventListener('message', (event) => {
	if (bootstrapAccepted || sessionId.length === 0 || generation < 0 || expectedParentOrigin === null)
		return
	const accepted = acceptInspectorFrameBootstrap(event, {
		expectedSource: window.parent,
		expectedOrigin: expectedParentOrigin,
		sessionId,
		expectedGeneration: generation,
	})
	if (accepted === null)
		return
	bootstrapAccepted = true

	const hub = createMessagePortChannelHub(accepted.port)
	const hostTransport = hub.openChannel(PREVIEW_HOST_CHANNEL)
	const inspectorTransport = hub.openChannel(PREVIEW_INSPECTOR_CHANNEL)

	const stopHost = hostTransport.subscribe((raw) => {
		const command = parsePreviewHostCommand(raw)
		if (command !== null) {
			if (command.kind === 'presentation.update') {
				i18n.setLocale(command.locale)
				theme.setTheme(command.theme)
			}
			else {
				setTutorialSpotlight(command.target)
			}
			return
		}

		const request = parsePreviewHostRequest(raw)
		if (request === null)
			return
		if (request.kind === 'tutorial.evaluate') {
			sendSafely(hostTransport, {
				protocol: PREVIEW_HOST_PROTOCOL_VERSION,
				kind: 'tutorial.evaluated',
				requestId: request.requestId,
				tourId: request.tourId,
				stepIndex: request.stepIndex,
				progress: progressForRequest(request),
			})
			return
		}

		// Set once the Runtime this mount replaces has been taken down: an error after that point leaves nothing running.
		let runtimeTornDown = false
		mountQueue = mountQueue.then(async () => {
			if (request.sessionId !== sessionId || request.generation !== generation) {
				sendSafely(hostTransport, {
					protocol: PREVIEW_HOST_PROTOCOL_VERSION,
					kind: 'error',
					requestId: request.requestId,
					message: 'Preview host session/generation mismatch.',
				})
				return
			}

			const showcase = getShowcase(request.preview.showcaseId)
			if (showcase === undefined) {
				sendSafely(hostTransport, {
					protocol: PREVIEW_HOST_PROTOCOL_VERSION,
					kind: 'error',
					requestId: request.requestId,
					message: `Unknown Preview showcase: ${request.preview.showcaseId}.`,
				})
				return
			}

			let definition: unknown
			try {
				definition = JSON.parse(request.preview.sourceText)
			}
			catch {
				sendSafely(hostTransport, {
					protocol: PREVIEW_HOST_PROTOCOL_VERSION,
					kind: 'error',
					requestId: request.requestId,
					message: 'Preview host received invalid JSON source.',
				})
				return
			}

			const blueprint = showcase.system.createBlueprint(definition)
			if (blueprint.status !== 'valid') {
				sendSafely(hostTransport, {
					protocol: PREVIEW_HOST_PROTOCOL_VERSION,
					kind: 'error',
					requestId: request.requestId,
					message: 'Preview host received a source that did not compile to a valid Blueprint.',
				})
				return
			}

			// Loaded before the running Preview is taken down. A chunk that fails to load stays failed in this document (the
			// browser caches the rejected import), so a retry in place could never succeed: the host is told to replace the
			// frame, which also ends the Preview it ran.
			let renderer: Awaited<ReturnType<typeof loadShowcaseRenderer>>
			try {
				renderer = await loadShowcaseRenderer(showcase.id)
			}
			catch (error) {
				sendSafely(hostTransport, {
					protocol: PREVIEW_HOST_PROTOCOL_VERSION,
					kind: 'error',
					requestId: request.requestId,
					message: `The Preview renderer for "${showcase.id}" could not be loaded (${error instanceof Error ? error.message : String(error)}). The Preview was closed; Try again loads a new one.`,
					discardFrame: true,
				})
				return
			}
			if (renderer === undefined) {
				sendSafely(hostTransport, {
					protocol: PREVIEW_HOST_PROTOCOL_VERSION,
					kind: 'error',
					requestId: request.requestId,
					message: `No Preview renderer for showcase: ${showcase.id}.`,
				})
				return
			}

			teardownMountedPreview()
			runtimeTornDown = true
			const runtime = blueprint.createRuntime()
			const Root = defineComponent({
				name: 'PreviewFrameRoot',
				setup: () => () => h(renderer, { runtime }),
			})
			const app = createApp(Root)
			app.provide(ShowcaseHostKey, showcaseHost)
			app.mount('#app')

			const root = document.getElementById('app')
			if (root === null) {
				app.unmount()
				runtime.dispose()
				throw new Error('Preview frame root disappeared during mount.')
			}
			const agent = createInspectorAgent({
				runtime,
				transport: inspectorTransport,
				closeTransportOnDispose: false,
				dom: { root },
			})

			const script = getTour(request.preview.showcaseId)?.script ?? null
			const stopTutorialObservation = script === null
				? () => {}
				: subscribeObservationTargets(runtime, script.observationTargets, () => {
						sendSafely(hostTransport, {
							protocol: PREVIEW_HOST_PROTOCOL_VERSION,
							kind: 'tutorial.observation-changed',
							tourId: script.id,
						})
					})

			mounted = {
				app,
				runtime,
				agent,
				revision: request.preview.revision,
				showcaseId: request.preview.showcaseId,
				stopTutorialObservation,
			}
			sendSafely(hostTransport, {
				protocol: PREVIEW_HOST_PROTOCOL_VERSION,
				kind: 'mounted',
				requestId: request.requestId,
				generation,
				revision: request.preview.revision,
				runtimeId: agent.runtimeId,
			})
		})
			.catch((error: unknown) => {
				sendSafely(hostTransport, {
					protocol: PREVIEW_HOST_PROTOCOL_VERSION,
					kind: 'error',
					requestId: request.requestId,
					message: error instanceof Error ? error.message : String(error),
					...(runtimeTornDown ? { runtimeTornDown: true } : {}),
				})
			})
	})

	hostTransport.subscribeClose(() => {
		stopHost()
		teardownMountedPreview()
		if (!hub.closed)
			hub.close()
	})
})

window.addEventListener('beforeunload', () => {
	teardownMountedPreview()
})
