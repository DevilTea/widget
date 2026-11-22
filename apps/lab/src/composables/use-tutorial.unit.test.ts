// @vitest-environment happy-dom
/**
 * Tutorial store lifecycle coverage: duplicate start requests and Preview recheck ordering.
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
import { getShowcase } from '../showcases/registry'
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
	tourId: string
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
	emitTutorialObservation: (tourId: string) => void
} {
	const evaluations: DeferredTutorialEvaluation[] = []
	const observationListeners = new Set<(tourId: string) => void>()
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
		onUnexpectedClose: () => () => {},
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

describe('createTutorialStore() duplicate start requests', () => {
	it('makes a rejected synchronous request a no-op while the first showcase switch is pending', async () => {
		// Start from the hidden Sandbox fixture so the tour has to switch showcase (Survey is the default).
		const store = createLabStore(getShowcase('sandbox')!)
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
describe('createTutorialStore() and the user\'s work and place (Lab UX phase 2)', () => {
	/** Commits an edit of the survey's mode label, so the Document equals no preset. */
	async function commitEdit(store: ReturnType<typeof createLabStore>): Promise<string> {
		const edited = store.documentState.value.sourceText.replace('How will you join?', 'Where will you be?')
		store.setDraftSourceText(edited)
		await store.apply()
		return edited
	}

	it('starting on the tour\'s own showcase over committed edits asks nothing and offers Undo afterwards', async () => {
		const store = createLabStore(getShowcase('survey')!)
		const edited = await commitEdit(store)
		const tutorial = createTutorialStore(store, createFakeImplementationExplorer())

		tutorial.requestStart()
		expect(tutorial.confirmVisible.value)
			.toBe(false)
		await flush()
		expect(tutorial.snapshot.value.status)
			.toBe('active')
		expect(store.hasCommittedEdits.value)
			.toBe(false)
		expect(store.replacedNoticeVisible.value)
			.toBe(true)
		expect(store.replacedNotice.value?.subject)
			.toBe('Default — open day sign-up')

		await store.undoLastApply()
		expect(store.documentState.value.sourceText)
			.toBe(edited)
		store.dispose()
	})

	it('starting from a showcase without a tour over committed edits asks first, naming that Undo cannot bring them back', async () => {
		const store = createLabStore(getShowcase('sandbox')!)
		store.setDraftSourceText('{ "id": "root", "type": "Text", "config": { "text": "mine" } }\n')
		await store.apply()
		const switchShowcase = vi.fn(async () => {})
		store.switchShowcase = switchShowcase
		const tutorial = createTutorialStore(store, createFakeImplementationExplorer())

		tutorial.requestStart()
		expect(tutorial.confirmVisible.value)
			.toBe(true)
		expect(tutorial.confirmMessage.value)
			.toBe('Starting the tutorial opens its teaching example in another showcase. Your edits to this document will be discarded, and Undo cannot bring them back.')
		expect(switchShowcase).not.toHaveBeenCalled()

		tutorial.cancelStart()
		expect(tutorial.confirmMessage.value)
			.toBe('Starting the tutorial will load the Survey teaching example and replace your unapplied changes.')
		store.dispose()
	})

	it('puts the user back on the tab and Author view they had when the tour ends with Finish or is skipped', async () => {
		const store = createLabStore(getShowcase('survey')!)
		store.activeTab.value = 'events'
		store.authorView.value = 'json'
		const tutorial = createTutorialStore(store, createFakeImplementationExplorer())
		tutorial.requestStart()
		await flush()
		// A step moves the user around.
		store.activeTab.value = 'author'
		store.authorView.value = 'structure'

		tutorial.skip()
		expect(store.activeTab.value)
			.toBe('events')
		expect(store.authorView.value)
			.toBe('json')

		// Pausing keeps the tour's place; a later end still restores what the user had before the tour.
		store.activeTab.value = 'runtime'
		tutorial.requestStart()
		await flush()
		store.activeTab.value = 'blueprint'
		tutorial.pause()
		expect(store.activeTab.value)
			.toBe('blueprint')
		tutorial.requestResume()
		tutorial.skip()
		expect(store.activeTab.value)
			.toBe('runtime')

		// The Preview is not a tool tab to go back to (activating its group again left the frame blank).
		store.activeTab.value = 'preview'
		tutorial.requestStart()
		await flush()
		store.activeTab.value = 'blueprint'
		tutorial.skip()
		expect(store.activeTab.value)
			.toBe('blueprint')
		store.dispose()
	})
})
