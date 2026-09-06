/**
 * Same-origin Preview execution realm (issue #10 / Phase B2).
 *
 * The parent transfers exactly one bootstrap MessagePort. This frame owns the actual showcase Runtime,
 * Vue renderer, Vuetify provider, InspectorAgent, tutorial semantic observation, and inspected DOM.
 * The parent never receives Runtime/Blueprint objects or arbitrary Runtime values.
 */
import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import type { InspectorAgent } from '@deviltea/widget-devtools/agent'
import type { App } from 'vue'
import type { PreviewHostRequest } from './preview-host/protocol'
import { createMessagePortChannelHub } from '@deviltea/widget-devtools'
import { createInspectorAgent } from '@deviltea/widget-devtools/agent'
import {
	acceptInspectorFrameBootstrap,
} from '@deviltea/widget-devtools/frame-bootstrap'
import { createApp, defineComponent, h } from 'vue'
import { createVuetify } from 'vuetify'
import { createLabI18nStore, LabI18nKey } from './composables/use-lab-i18n'
import { createLabThemeStore, LabThemeKey } from './composables/use-lab-theme'
import {
	parsePreviewHostCommand,
	parsePreviewHostRequest,
	PREVIEW_HOST_CHANNEL,
	PREVIEW_HOST_PROTOCOL_VERSION,
	PREVIEW_INSPECTOR_CHANNEL,
} from './preview-host/protocol'
import { getShowcase } from './showcases/registry'
import { CRM_TOUR_ID, crmTourScript } from './tutorial/crm-script'
import { createRuntimeReader, subscribeObservationTargets } from './tutorial/inspection-reader'
import { SURVEY_TOUR_ID, surveyTourScript } from './tutorial/survey-script'
import 'vuetify/styles'
import 'pika.css'
import './styles/global.css'
import './styles/tutorial-theme.css'

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

const i18n = createLabI18nStore()
const theme = createLabThemeStore()
let mounted: MountedPreview | null = null
let bootstrapAccepted = false
let mountQueue: Promise<void> = Promise.resolve()

function scriptFor(tourId: 'survey' | 'crm') {
	return tourId === SURVEY_TOUR_ID ? surveyTourScript : crmTourScript
}

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
	const script = scriptFor(request.tourId)
	const step = script.steps[request.stepIndex]
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
	if (bootstrapAccepted || sessionId.length === 0 || generation < 0)
		return
	const accepted = acceptInspectorFrameBootstrap(event, {
		expectedSource: window.parent,
		expectedOrigin: location.origin,
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

			teardownMountedPreview()
			const runtime = blueprint.createRuntime()
			const Root = defineComponent({
				name: 'PreviewFrameRoot',
				setup: () => () => h(showcase.renderer, { runtime }),
			})
			const app = createApp(Root)
			app.provide(LabI18nKey, i18n)
			app.provide(LabThemeKey, theme)
			app.use(createVuetify({ theme: { defaultTheme: 'system' } }))
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
				dom: {
					root,
					highlightClass: 'lab-inspect-anchor--highlighted',
					badgeClass: 'lab-inspector-agent-badge',
				},
			})

			const script = request.preview.showcaseId === SURVEY_TOUR_ID
				? surveyTourScript
				: request.preview.showcaseId === CRM_TOUR_ID ? crmTourScript : null
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
