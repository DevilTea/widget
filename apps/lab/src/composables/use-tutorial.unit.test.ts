// @vitest-environment happy-dom
/**
 * Regression coverage for merge-gate review round 2, blocker 2: "at most one current tour" — the header
 * tour-picker must not be able to orphan an active/paused engine, or race a pending start/restart
 * request (`selectTour()`'s own defensive checks, independent of `LabHeader.vue` actually disabling the
 * `<select>`).
 *
 * Against the REAL `createLabStore()` (diagnostic #25's own `use-lab-store.unit.test.ts` precedent: called
 * directly, no component mount needed for plain reactivity/lifecycle-hook registration to work) — for
 * the pending-start case, `switchShowcase()` is overridden with a manually-resolved ("deferred") promise
 * so the test can deterministically hold the tour mid-flight, the same "make the async window
 * controllable" idea `start-request.unit.test.ts` uses at the (synchronous) guard level, extended here
 * to the actual async `loadTourDefault()` boundary.
 */

import type { PreviewFrameConnection, PreviewFrameDriver } from '../preview-host/frame-driver'
import type { ImplementationExplorerStore } from './use-implementation-explorer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { createLabStore } from './use-lab-store'
import { createTutorialStore } from './use-tutorial'

function createFakeImplementationExplorer(): ImplementationExplorerStore {
	return {
		openRequestTick: shallowRef(0),
		requestedMode: shallowRef<'focused' | 'catalog'>('focused'),
		open: () => {},
	}
}

/** A resolvable/rejectable promise whose settlement the test controls explicitly. */
function createDeferred<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

/**
 * Flushes the real microtask queue `loadTourDefault()`'s `await`/`.then()`/`.finally()` chain runs
 * through once its underlying promise settles — a macrotask tick is enough and does not depend on any
 * fake-timer setup.
 */
async function flush(): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, 0))
}

interface DeferredTutorialEvaluation {
	tourId: 'survey' | 'crm'
	stepIndex: number
	progress: number
	resolve: (progress: number) => void
}

function previewConnection(revision: number): PreviewFrameConnection {
	const runtimeId = `runtime-${revision}`
	return {
		generation: 1,
		revision,
		runtimeId,
		blueprint: { runtimeId, rootNodeId: 0, nodes: [], invalidCycles: [] },
		inspectorClient: {} as PreviewFrameConnection['inspectorClient'],
		hostClient: {} as PreviewFrameConnection['hostClient'],
	}
}

function createFakePreviewDriver(): {
	driver: PreviewFrameDriver
	evaluations: DeferredTutorialEvaluation[]
	emitTutorialObservation: (tourId: 'survey' | 'crm') => void
} {
	const evaluations: DeferredTutorialEvaluation[] = []
	const observationListeners = new Set<(tourId: 'survey' | 'crm') => void>()
	const driver: PreviewFrameDriver = {
		mount: async descriptor => previewConnection(descriptor.revision),
		updatePresentation: () => {},
		setTutorialSpotlight: () => {},
		evaluateTutorial: (tourId, stepIndex, progress) => {
			// The first step has an unconditional stage so the test can advance to a predicate-backed step.
			if (stepIndex === 0)
				return Promise.resolve(1)

			return new Promise<number>((resolve) => {
				evaluations.push({ tourId, stepIndex, progress, resolve })
			})
		},
		onTutorialObservation: (listener) => {
			observationListeners.add(listener)
			return () => observationListeners.delete(listener)
		},
		dispose: () => {},
	}
	return {
		driver,
		evaluations,
		emitTutorialObservation: (tourId) => {
			for (const listener of [...observationListeners]) listener(tourId)
		},
	}
}

beforeEach(() => {
	sessionStorage.clear()
})

describe('createTutorialStore() "at most one current tour" invariant (selectTour)', () => {
	it('with CRM active, selectTour(\'survey\') is a no-op — activeTourId/status stay CRM/active, never orphaned', async () => {
		sessionStorage.setItem('widget-lab:tutorial:completed:survey', '1')
		const store = createLabStore()
		const tutorial = createTutorialStore(store, createFakeImplementationExplorer())

		expect(tutorial.crmTourUnlocked.value)
			.toBe(true)
		tutorial.selectTour('crm')
		expect(tutorial.activeTourId.value)
			.toBe('crm')

		tutorial.requestStart()
		await flush()
		expect(tutorial.snapshot.value.status)
			.toBe('active')
		expect(tutorial.tourPickerDisabled.value)
			.toBe(true)

		// The actual regression: switching away while CRM is active must be rejected.
		tutorial.selectTour('survey')
		expect(tutorial.activeTourId.value)
			.toBe('crm')
		expect(tutorial.snapshot.value.status)
			.toBe('active')

		store.dispose()
	})

	it('a paused tour also blocks selectTour — pausing does not release the "current tour" invariant', async () => {
		sessionStorage.setItem('widget-lab:tutorial:completed:survey', '1')
		const store = createLabStore()
		const tutorial = createTutorialStore(store, createFakeImplementationExplorer())

		tutorial.selectTour('crm')
		tutorial.requestStart()
		await flush()
		expect(tutorial.snapshot.value.status)
			.toBe('active')

		tutorial.pause()
		expect(tutorial.snapshot.value.status)
			.toBe('paused')
		expect(tutorial.tourPickerDisabled.value)
			.toBe(true)

		tutorial.selectTour('survey')
		expect(tutorial.activeTourId.value)
			.toBe('crm')

		store.dispose()
	})

	it('during a pending start, selectTour is rejected; once the start settles, the started tour IS the active/visible one', async () => {
		sessionStorage.setItem('widget-lab:tutorial:completed:survey', '1')
		const store = createLabStore()
		const deferredSwitch = createDeferred<void>()
		// Overrides the one call `loadTourDefault('crm')` makes from the default Sandbox showcase — a
		// plain property reassignment on the returned `LabStore` object (none of its methods are
		// `readonly` in the interface), so the rest of `store` stays the real, unmodified implementation.
		store.switchShowcase = () => deferredSwitch.promise

		const tutorial = createTutorialStore(store, createFakeImplementationExplorer())

		tutorial.selectTour('crm')
		expect(tutorial.activeTourId.value)
			.toBe('crm')

		tutorial.requestStart() // loadTourDefault('crm') is now pending on `deferredSwitch`
		expect(tutorial.tourPickerDisabled.value)
			.toBe(true)
		// The CRM engine has not even started yet (still 'idle') at this point — this is exactly the
		// "worst window" the review flagged: an engine-status-only check would miss it entirely.
		expect(tutorial.snapshot.value.status)
			.toBe('idle')

		// Rejected while pending — this is the regression: without the guard-phase check, this would
		// silently move `activeTourId` to 'survey' while CRM's own start is still in flight, and the CRM
		// engine would start moments later with `activeTourId` already pointed elsewhere (no rail, no
		// observation subscription — an orphaned active engine).
		tutorial.selectTour('survey')
		expect(tutorial.activeTourId.value)
			.toBe('crm')

		deferredSwitch.resolve()
		await flush()

		// Settled: CRM is the one that actually started, and it IS the active/visible tour.
		expect(tutorial.activeTourId.value)
			.toBe('crm')
		expect(tutorial.snapshot.value.status)
			.toBe('active')
		expect(tutorial.tourPickerDisabled.value)
			.toBe(true) // now blocked for the ordinary "active" reason, not the pending-start one

		store.dispose()
	})

	it('once idle/completed again, selectTour is accepted normally', async () => {
		sessionStorage.setItem('widget-lab:tutorial:completed:survey', '1')
		const store = createLabStore()
		const tutorial = createTutorialStore(store, createFakeImplementationExplorer())

		tutorial.selectTour('crm')
		tutorial.requestStart()
		await flush()
		expect(tutorial.snapshot.value.status)
			.toBe('active')

		tutorial.skip() // -> idle, releasing the invariant
		expect(tutorial.tourPickerDisabled.value)
			.toBe(false)

		tutorial.selectTour('survey')
		expect(tutorial.activeTourId.value)
			.toBe('survey')

		store.dispose()
	})
})

describe('createTutorialStore() duplicate start requests', () => {
	it('makes a rejected synchronous request a no-op while the first showcase switch is pending', async () => {
		const store = createLabStore()
		const deferredSwitch = createDeferred<void>()
		const switchShowcase = vi.fn(() => deferredSwitch.promise)
		store.switchShowcase = switchShowcase

		const tutorial = createTutorialStore(store, createFakeImplementationExplorer())

		tutorial.requestStart()
		tutorial.requestStart()

		// The first request is held at the real load boundary. A rejected duplicate must not start a
		// second load, prompt, or engine transition while that request is still pending.
		expect(switchShowcase)
			.toHaveBeenCalledTimes(1)
		expect(switchShowcase)
			.toHaveBeenCalledWith('survey')
		expect(tutorial.startPending.value)
			.toBe(true)
		expect(tutorial.snapshot.value.status)
			.toBe('idle')

		deferredSwitch.resolve()
		await flush()

		expect(tutorial.startPending.value)
			.toBe(false)
		expect(tutorial.snapshot.value.status)
			.toBe('active')

		store.dispose()
	})
})

describe('createTutorialStore() Preview recheck ordering', () => {
	it('ignores an older completed response after a newer response reports no progress', async () => {
		const store = createLabStore()
		await store.switchShowcase('survey')
		const preview = createFakePreviewDriver()
		store.previewHost.attachDriver(preview.driver)
		await vi.waitFor(() => expect(store.previewHost.connection.value)
			.not.toBeNull())

		const tutorial = createTutorialStore(store, createFakeImplementationExplorer())
		tutorial.requestStart()
		await vi.waitFor(() => expect(tutorial.snapshot.value.canAdvance)
			.toBe(true))
		tutorial.next()

		expect(tutorial.snapshot.value.stepIndex)
			.toBe(1)
		// A frame observation requests another evaluation of the same active step while the first is pending.
		preview.emitTutorialObservation('survey')
		await vi.waitFor(() => expect(preview.evaluations.filter(evaluation => evaluation.stepIndex === 1).length)
			.toBeGreaterThanOrEqual(2))

		const stepRechecks = preview.evaluations.filter(evaluation => evaluation.tourId === 'survey' && evaluation.stepIndex === 1)
		const newest = stepRechecks.at(-1)!
		const older = stepRechecks.slice(0, -1)
		expect(newest.progress)
			.toBe(0)
		expect(older.length)
			.toBeGreaterThanOrEqual(1)

		// The later frame evaluation observes no completion for the currently active step.
		newest.resolve(0)
		await flush()
		expect(tutorial.snapshot.value.revealed)
			.toHaveLength(0)
		expect(tutorial.snapshot.value.canAdvance)
			.toBe(false)

		// Earlier evaluations still carry a completed result, but their responses are stale now.
		for (const evaluation of older) evaluation.resolve(1)
		await flush()
		expect(tutorial.snapshot.value.stepIndex)
			.toBe(1)
		expect(tutorial.snapshot.value.revealed)
			.toHaveLength(0)
		expect(tutorial.snapshot.value.canAdvance)
			.toBe(false)

		store.dispose()
	})
})
