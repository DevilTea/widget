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

import type { ImplementationExplorerStore } from './use-implementation-explorer'
import { beforeEach, describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
import { createLabStore } from './use-lab-store'
import { createTutorialStore } from './use-tutorial'

function createFakeImplementationExplorer(): ImplementationExplorerStore {
	return {
		openRequestTick: shallowRef(0),
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
