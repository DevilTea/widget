import type { Ref } from 'vue'
import type { LabLocale } from '../i18n/locale'
import type { LabTheme } from '../theme/theme'
import type { PreviewFrameConnection, PreviewFrameDriver } from './frame-driver'
import type { PreviewHostDescriptor } from './protocol'
import { shallowRef } from 'vue'

export interface PreviewHostCoordinator {
	readonly connection: Readonly<Ref<PreviewFrameConnection | null>>
	readonly error: Readonly<Ref<string | null>>
	attachDriver: (driver: PreviewFrameDriver) => () => void
	replace: (descriptor: PreviewHostDescriptor) => Promise<PreviewFrameConnection | null>
	updatePresentation: (locale: LabLocale, theme: LabTheme) => void
	setTutorialSpotlight: (target: string | null) => void
	evaluateTutorial: (tourId: 'survey' | 'crm', stepIndex: number, progress: number) => Promise<number>
	onTutorialObservation: (listener: (tourId: 'survey' | 'crm') => void) => () => void
	dispose: () => void
}

/**
 * Serializes authored Preview-promotion intents against the browser-only iframe driver.
 * `LabSession` can therefore await remote readiness without importing Vue DOM APIs or owning a Runtime.
 */
export function createPreviewHostCoordinator(): PreviewHostCoordinator {
	const connection = shallowRef<PreviewFrameConnection | null>(null)
	const error = shallowRef<string | null>(null)
	const observationListeners = new Set<(tourId: 'survey' | 'crm') => void>()
	let driver: PreviewFrameDriver | null = null
	let stopDriverObservation: (() => void) | null = null
	let epoch = 0
	let disposed = false
	let queue: Promise<unknown> = Promise.resolve()
	let desired: PreviewHostDescriptor | null = null
	let tutorialSpotlight: string | null = null

	async function performReplace(descriptor: PreviewHostDescriptor): Promise<PreviewFrameConnection | null> {
		if (disposed)
			throw new Error('Preview host coordinator is disposed.')
		desired = descriptor
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
			return next
		}
		catch (cause) {
			if (driver !== selectedDriver || epoch !== selectedEpoch || desired !== descriptor)
				return null
			const failure = cause instanceof Error ? cause : new Error(String(cause))
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
		attachDriver(nextDriver) {
			if (disposed) {
				nextDriver.dispose()
				return () => {}
			}
			if (driver !== null && driver !== nextDriver)
				driver.dispose()
			stopDriverObservation?.()
			driver = nextDriver
			epoch++
			const currentEpoch = epoch
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
			driver?.dispose()
			driver = null
			observationListeners.clear()
			desired = null
			tutorialSpotlight = null
		},
	}
}
