// @vitest-environment happy-dom
/**
 * The tutorial store with more than one tour: the active tour follows the open showcase, a tour that is running
 * belongs to its showcase, and starting loads that showcase's own teaching example.
 *
 * Against the REAL `createLabStore()`, like `use-tutorial.unit.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getShowcase } from '../showcases/registry'
import { createLabStore } from './use-lab-store'
import { createTutorialStore } from './use-tutorial'

/** The tutorial store opens expert views through this (`createToolOpener()` in the app); these tests open none. */
function explorer(): () => void {
	return () => {}
}

async function flush(): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
	sessionStorage.clear()
})

describe('createTutorialStore() with two tours', () => {
	it('starts on the open showcase\'s tour, and the default tour for a showcase without one', () => {
		const survey = createLabStore()
		expect(createTutorialStore(survey, explorer()).activeTourId.value)
			.toBe('survey')
		survey.dispose()

		const trip = createLabStore(getShowcase('trip-budget')!)
		expect(createTutorialStore(trip, explorer()).activeTourId.value)
			.toBe('trip-budget')
		trip.dispose()

		const sandbox = createLabStore(getShowcase('sandbox')!)
		expect(createTutorialStore(sandbox, explorer()).activeTourId.value)
			.toBe('survey')
		sandbox.dispose()
	})

	it('names its own teaching example in the draft confirmation', async () => {
		const store = createLabStore()
		const tutorial = createTutorialStore(store, explorer())
		expect(tutorial.confirmMessage.value)
			.toBe('Starting the tutorial will load the Survey teaching example and discard the JSON that can\'t be applied yet.')

		await store.switchShowcase('trip-budget')
		expect(tutorial.activeTourId.value)
			.toBe('trip-budget')
		expect(tutorial.confirmMessage.value)
			.toBe('Starting the tutorial will load the Trip budget teaching example and discard the JSON that can\'t be applied yet.')
		store.dispose()
	})

	it('reloads the trip default preset, not the survey one, when it starts on the trip showcase', async () => {
		const store = createLabStore(getShowcase('trip-budget')!)
		const applyPreset = vi.fn(async (_presetId: string) => undefined)
		const switchShowcase = vi.fn(async () => {})
		store.applyPreset = applyPreset
		store.switchShowcase = switchShowcase
		const tutorial = createTutorialStore(store, explorer())

		tutorial.requestStart()
		await flush()

		expect(applyPreset)
			.toHaveBeenCalledWith('trip-default')
		expect(switchShowcase)
			.not
			.toHaveBeenCalled()
		expect(tutorial.snapshot.value.status)
			.toBe('active')
		expect(tutorial.snapshot.value.step?.id)
			.toBe('orient')
		expect(tutorial.activeTourId.value)
			.toBe('trip-budget')
		store.dispose()
	})

	it('ends a running tour when another showcase opens, so the rail never describes a showcase that is not open', async () => {
		const store = createLabStore(getShowcase('trip-budget')!)
		const tutorial = createTutorialStore(store, explorer())
		tutorial.requestStart()
		await flush()
		expect(tutorial.snapshot.value.status)
			.toBe('active')

		await store.switchShowcase('survey')
		await flush()

		expect(tutorial.activeTourId.value)
			.toBe('survey')
		expect(tutorial.snapshot.value.status)
			.toBe('idle')
		// The trip tour was ended, not left running in the background: coming back offers a fresh start.
		await store.switchShowcase('trip-budget')
		await flush()
		expect(tutorial.activeTourId.value)
			.toBe('trip-budget')
		expect(tutorial.snapshot.value.status)
			.toBe('idle')
		store.dispose()
	})

	it('keeps a completed tour completed per tour (each has its own flag)', async () => {
		sessionStorage.setItem('widget-lab:tutorial:completed:trip-budget', '1')
		const store = createLabStore()
		const tutorial = createTutorialStore(store, explorer())
		expect(tutorial.snapshot.value.status)
			.toBe('idle')
		await store.switchShowcase('trip-budget')
		expect(tutorial.snapshot.value.status)
			.toBe('completed')
		store.dispose()
	})
})
