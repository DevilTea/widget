import type { Ref } from 'vue'
import type { LabLocale } from '../i18n/locale'
import type { LabTheme } from '../theme/theme'
import type { PreviewFrameConnection, PreviewFrameDriver } from './frame-driver'
import type { PreviewHostDescriptor, PreviewTourId } from './protocol'
import { shallowRef } from 'vue'
import { PreviewHostClientError } from './client'

export interface PreviewHostCoordinator {
	readonly connection: Readonly<Ref<PreviewFrameConnection | null>>
	readonly error: Readonly<Ref<string | null>>
	/**
	 * With an `error`: the frame answered a refused mount and still runs the last Preview that mounted (`true`), or the
	 * frame did not answer / lost its connection and nothing can be said to run (`false`, and `connection` is `null`).
	 */
	readonly runtimeSurvives: Readonly<Ref<boolean>>
	attachDriver: (driver: PreviewFrameDriver) => () => void
	replace: (descriptor: PreviewHostDescriptor) => Promise<PreviewFrameConnection | null>
	updatePresentation: (locale: LabLocale, theme: LabTheme) => void
	setTutorialSpotlight: (target: string | null) => void
	evaluateTutorial: (tourId: PreviewTourId, stepIndex: number, progress: number) => Promise<number>
	onTutorialObservation: (listener: (tourId: PreviewTourId) => void) => () => void
	dispose: () => void
}

/**
 * Serializes authored Preview-promotion intents against the browser-only iframe driver.
 * `LabSession` can therefore await remote readiness without importing Vue DOM APIs or owning a Runtime.
 */
export function createPreviewHostCoordinator(): PreviewHostCoordinator {
	const connection = shallowRef<PreviewFrameConnection | null>(null)
	const error = shallowRef<string | null>(null)
	const runtimeSurvives = shallowRef(false)
	const observationListeners = new Set<(tourId: PreviewTourId) => void>()
	let driver: PreviewFrameDriver | null = null
	let stopDriverObservation: (() => void) | null = null
	let stopDriverCloseObservation: (() => void) | null = null
	let epoch = 0
	let disposed = false
	let queue: Promise<unknown> = Promise.resolve()
	let desired: PreviewHostDescriptor | null = null
	let tutorialSpotlight: string | null = null

	async function performReplace(descriptor: PreviewHostDescriptor): Promise<PreviewFrameConnection | null> {
		if (disposed)
			throw new Error('Preview host coordinator is disposed.')
		const selectedDriver = driver
		const selectedEpoch = epoch
		if (selectedDriver === null)
			return null
		try {
			const next = await selectedDriver.mount(descriptor)
			if (disposed || driver !== selectedDriver || epoch !== selectedEpoch || desired !== descriptor)
				return null
			selectedDriver.setTutorialSpotlight(tutorialSpotlight)
			connection.value = next
			error.value = null
			runtimeSurvives.value = false
			return next
		}
		catch (cause) {
			if (driver !== selectedDriver || epoch !== selectedEpoch || desired !== descriptor)
				return null
			const failure = cause instanceof Error ? cause : new Error(String(cause))
			// A refusal the frame answered, before it touched what it ran, leaves that running. Anything else (no answer in
			// time, a closed channel, an answer that says the old Runtime was already taken down) leaves a connection that
			// describes a Runtime nobody can reach.
			const refused = failure instanceof PreviewHostClientError && failure.answered && !failure.runtimeTornDown
			if (!refused)
				connection.value = null
			runtimeSurvives.value = refused && connection.value !== null
			error.value = failure.message
			throw failure
		}
	}

	function scheduleDesiredMount(): void {
		const descriptor = desired
		if (descriptor === null || driver === null || disposed)
			return
		const operation = queue.then(() => performReplace(descriptor), () => performReplace(descriptor))
		queue = operation.then(() => undefined, () => undefined)
		void operation.catch(() => {})
	}

	return {
		connection,
		error,
		runtimeSurvives,
		attachDriver(nextDriver) {
			if (disposed) {
				nextDriver.dispose()
				return () => {}
			}
			if (driver !== null && driver !== nextDriver)
				driver.dispose()
			stopDriverObservation?.()
			stopDriverCloseObservation?.()
			driver = nextDriver
			epoch++
			const currentEpoch = epoch
			stopDriverCloseObservation = nextDriver.onUnexpectedClose(() => {
				if (driver !== nextDriver || epoch !== currentEpoch)
					return
				// The Runtime that connection described is gone with the frame: say so instead of showing stale values.
				connection.value = null
				runtimeSurvives.value = false
				error.value = 'The connection to the preview frame was closed.'
			})
			stopDriverObservation = nextDriver.onTutorialObservation((tourId) => {
				if (driver !== nextDriver || epoch !== currentEpoch)
					return
				for (const listener of [...observationListeners])
					listener(tourId)
			})
			scheduleDesiredMount()
			return () => {
				if (driver !== nextDriver)
					return
				stopDriverObservation?.()
				stopDriverObservation = null
				stopDriverCloseObservation?.()
				stopDriverCloseObservation = null
				driver = null
				epoch++
				connection.value = null
				nextDriver.dispose()
			}
		},
		replace(descriptor) {
			if (disposed)
				return Promise.reject(new Error('Preview host coordinator is disposed.'))
			desired = descriptor
			if (driver === null)
				return Promise.resolve(null)
			const operation = queue.then(() => performReplace(descriptor), () => performReplace(descriptor))
			queue = operation.then(() => undefined, () => undefined)
			return operation
		},
		updatePresentation(locale, theme) {
			driver?.updatePresentation(locale, theme)
		},
		setTutorialSpotlight(target) {
			tutorialSpotlight = target
			driver?.setTutorialSpotlight(target)
		},
		async evaluateTutorial(tourId, stepIndex, progress) {
			return driver === null ? progress : driver.evaluateTutorial(tourId, stepIndex, progress)
		},
		onTutorialObservation(listener) {
			observationListeners.add(listener)
			return () => observationListeners.delete(listener)
		},
		dispose() {
			if (disposed)
				return
			disposed = true
			connection.value = null
			stopDriverObservation?.()
			stopDriverObservation = null
			stopDriverCloseObservation?.()
			stopDriverCloseObservation = null
			driver?.dispose()
			driver = null
			observationListeners.clear()
			desired = null
			tutorialSpotlight = null
		},
	}
}
