// @vitest-environment happy-dom

import type { PreviewFrameConnection, PreviewFrameDriver } from '../preview-host/frame-driver'
import type { PreviewHostDescriptor } from '../preview-host/protocol'
import type { LabStore } from './use-lab-store'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, onUnmounted } from 'vue'
import { replaceConfigScalar } from '../lab/author'
import { createLabStore } from './use-lab-store'

const capturedText = '{ "id": "root", "type": "Text", "config": { "text": "captured snapshot" } }\n'
const laterText = '{ "id": "root", "type": "Text", "config": { "text": "later snapshot" } }\n'

function createDeferred() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

function connectionFor(descriptor: PreviewHostDescriptor, sequence: number): PreviewFrameConnection {
	const runtimeId = `remote-${descriptor.showcaseId}-${descriptor.revision}-${sequence}`
	return {
		generation: 1,
		revision: descriptor.revision,
		runtimeId,
		blueprint: { runtimeId, rootNodeId: 0, nodes: [], invalidCycles: [] },
		inspectorClient: {} as PreviewFrameConnection['inspectorClient'],
		hostClient: {} as PreviewFrameConnection['hostClient'],
	}
}

function createRecordingDriver(options: {
	beforeMount?: (descriptor: PreviewHostDescriptor) => Promise<void> | void
	onDispose?: () => void
} = {}) {
	let sequence = 0
	const mount = vi.fn(async (descriptor: PreviewHostDescriptor) => {
		await options.beforeMount?.(descriptor)
		return connectionFor(descriptor, sequence++)
	})
	const dispose = vi.fn(() => options.onDispose?.())
	const driver: PreviewFrameDriver = {
		mount,
		updatePresentation: () => {},
		setTutorialSpotlight: () => {},
		evaluateTutorial: async (_tourId, _stepIndex, progress) => progress,
		onTutorialObservation: () => () => {},
		dispose,
	}
	return { driver, mount, dispose }
}

async function attachDriver(store: LabStore, driver: PreviewFrameDriver): Promise<void> {
	store.previewHost.attachDriver(driver)
	await vi.waitFor(() => expect(store.previewHost.connection.value).not.toBeNull())
}

function mountRevisions(mount: ReturnType<typeof vi.fn>): number[] {
	return mount.mock.calls.map(([descriptor]) => (descriptor as PreviewHostDescriptor).revision)
}

function mountShowcases(mount: ReturnType<typeof vi.fn>): string[] {
	return mount.mock.calls.map(([descriptor]) => (descriptor as PreviewHostDescriptor).showcaseId)
}

describe('createLabStore() remote Preview ownership', () => {
	it('disposes the iframe driver and clears the remote connection', async () => {
		const store = createLabStore()
		const recorded = createRecordingDriver()
		await attachDriver(store, recorded.driver)
		expect(store.previewHost.connection.value?.revision)
			.toBe(0)

		store.dispose()

		expect(recorded.dispose)
			.toHaveBeenCalledOnce()
		expect(store.previewHost.connection.value)
			.toBeNull()
	})

	it('retains the last-valid remote Preview when the current Document becomes invalid', async () => {
		const store = createLabStore()
		const recorded = createRecordingDriver()
		await attachDriver(store, recorded.driver)
		const retained = store.preview.value!

		await store.applyPreset('invalid-semantic')

		expect(store.documentState.value.blueprint.status)
			.toBe('invalid')
		expect(store.preview.value)
			.toBe(retained)
		expect(store.previewHost.connection.value?.revision)
			.toBe(0)
		expect(recorded.mount)
			.toHaveBeenCalledTimes(1)
		store.dispose()
	})

	it('mirrors App.vue teardown ordering: descendants unmount before the iframe host is disposed', async () => {
		const events: string[] = []
		const store = createLabStore()
		const recorded = createRecordingDriver({ onDispose: () => events.push('driver-dispose') })
		await attachDriver(store, recorded.driver)

		const PreviewProbe = defineComponent({
			setup() {
				onUnmounted(() => events.push('preview-panel-unmounted'))
				return () => h('div')
			},
		})
		const Root = defineComponent({
			setup() {
				onUnmounted(() => {
					events.push('app-dispose-start')
					store.dispose()
					events.push('app-dispose-end')
				})
				return () => h(PreviewProbe)
			},
		})

		const wrapper = mount(Root)
		wrapper.unmount()

		expect(events)
			.toEqual([
				'preview-panel-unmounted',
				'app-dispose-start',
				'driver-dispose',
				'app-dispose-end',
			])
	})
})

describe('createLabStore() committed Document bridge', () => {
	it('exposes the high-level Author command and promotes the new valid revision remotely', async () => {
		const store = createLabStore()
		const recorded = createRecordingDriver()
		await attachDriver(store, recorded.driver)
		const nodeId = inspectBlueprint(store.documentState.value.blueprint).nodes.find(node => node.resolved && node.node.id === 'title')!.nodeId
		const previousPreview = store.preview.value!

		const outcome = await store.author(replaceConfigScalar(0, nodeId, 'text', 'store author value'))

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })
		expect(store.documentState.value.revision)
			.toBe(1)
		expect(store.preview.value?.revision)
			.toBe(1)
		expect(store.preview.value).not.toBe(previousPreview)
		expect(store.previewHost.connection.value?.revision)
			.toBe(1)
		expect(mountRevisions(recorded.mount))
			.toEqual([0, 1])
		expect(store.isDirty.value)
			.toBe(false)
		store.dispose()
	})

	it('tracks changed commits but does not remotely replace a structural no-op', async () => {
		const store = createLabStore()
		const recorded = createRecordingDriver()
		await attachDriver(store, recorded.driver)
		const initial = store.documentSnapshot.value

		await store.applyPreset('invalid-semantic')
		const committed = store.documentSnapshot.value
		expect(committed).not.toBe(initial)
		expect(committed.revision)
			.toBe(1)
		expect(committed.blueprint)
			.toBe(store.documentState.value.blueprint)

		const equivalentText = JSON.stringify(store.documentState.value.definition)
		store.setDraftSourceText(equivalentText)
		await store.apply()

		expect(store.documentSnapshot.value)
			.toBe(committed)
		expect(store.documentState.value.sourceText)
			.toBe(equivalentText)
		expect(recorded.mount)
			.toHaveBeenCalledTimes(1)
		store.dispose()
	})

	it('exposes current Document and retained Preview revisions independently after an invalid commit', async () => {
		const store = createLabStore()
		const recorded = createRecordingDriver()
		await attachDriver(store, recorded.driver)
		const initialPreview = store.preview.value!

		await store.applyPreset('invalid-semantic')

		expect(store.documentState.value.revision)
			.toBe(1)
		expect(store.documentState.value.blueprint.status)
			.toBe('invalid')
		expect(store.preview.value)
			.toBe(initialPreview)
		expect(store.preview.value?.revision)
			.toBe(0)
		expect(store.previewHost.connection.value?.revision)
			.toBe(0)
		store.dispose()
	})
})

describe('createLabStore() graph filter preferences', () => {
	it('survive a successful Apply to a new valid Blueprint', async () => {
		const store = createLabStore()
		store.graphShowAbsent.value = true
		store.graphShowIsolatedMembers.value = true

		store.setDraftSourceText(store.draftSourceText.value)
		await store.apply()

		expect(store.graphShowAbsent.value)
			.toBe(true)
		expect(store.graphShowIsolatedMembers.value)
			.toBe(true)
	})

	it('survive an Apply that lands on an invalid Blueprint', async () => {
		const store = createLabStore()
		store.graphShowAbsent.value = true
		const retained = store.preview.value!

		await store.applyPreset('invalid-semantic')

		expect(store.documentState.value.blueprint.status)
			.toBe('invalid')
		expect(store.preview.value)
			.toBe(retained)
		expect(store.graphShowAbsent.value)
			.toBe(true)
		expect(store.graphShowIsolatedMembers.value)
			.toBe(false)
	})
})

describe('createLabStore() switchShowcase()', () => {
	it('starts on the default sandbox authored context', () => {
		const store = createLabStore()
		expect(store.showcaseId.value)
			.toBe('sandbox')
		expect(store.documentState.value.blueprint.status)
			.toBe('valid')
		expect(store.preview.value?.revision)
			.toBe(0)
	})

	it('replaces the authored session/presets and promotes the target revision-0 Preview', async () => {
		const store = createLabStore()
		const recorded = createRecordingDriver()
		await attachDriver(store, recorded.driver)
		const oldSession = store.session

		await store.switchShowcase('survey')

		expect(store.session).not.toBe(oldSession)
		expect(store.showcaseId.value)
			.toBe('survey')
		expect(store.documentState.value.blueprint.status)
			.toBe('valid')
		expect(store.documentState.value.revision)
			.toBe(0)
		expect(store.preview.value?.revision)
			.toBe(0)
		expect(store.previewHost.connection.value?.revision)
			.toBe(0)
		expect(mountShowcases(recorded.mount))
			.toEqual(['sandbox', 'survey'])
		expect(store.presets.value.some(preset => preset.id === 'survey-default'))
			.toBe(true)
		store.dispose()
	})

	it('loads the target showcase default source as the new Document and draft', async () => {
		const store = createLabStore()
		await store.switchShowcase('survey')

		expect(store.draftSourceText.value)
			.toBe(store.documentState.value.sourceText)
		expect(store.documentState.value.definition)
			.toMatchObject({ type: 'TripSurvey' })
	})

	it('is a no-op for the current or an unknown showcase', async () => {
		const store = createLabStore()
		const session = store.session

		await store.switchShowcase('sandbox')
		await store.switchShowcase('does-not-exist')

		expect(store.session)
			.toBe(session)
		expect(store.showcaseId.value)
			.toBe('sandbox')
	})

	it('resolves applyPreset() against the new showcase after switching', async () => {
		const store = createLabStore()
		await store.switchShowcase('survey')

		const outcome = await store.applyPreset('survey-not-ready')

		expect(outcome?.status)
			.toBe('applied')
		expect(store.documentState.value.definition)
			.toMatchObject({ type: 'TripSurvey' })
	})

	it('adopts the target authoritative revision-0 snapshot without a synthetic same-source Apply', async () => {
		const store = createLabStore()
		await store.switchShowcase('survey')

		expect(store.documentState.value.revision)
			.toBe(0)
		expect(store.preview.value?.revision)
			.toBe(0)
		expect(store.isApplying.value)
			.toBe(false)
	})
})

describe('createLabStore() lifecycle transaction serialization', () => {
	it('serializes an in-flight valid Apply before a concurrent showcase switch', async () => {
		const gate = createDeferred()
		const store = createLabStore()
		const recorded = createRecordingDriver({
			beforeMount: descriptor => descriptor.showcaseId === 'sandbox' && descriptor.revision === 1 ? gate.promise : undefined,
		})
		await attachDriver(store, recorded.driver)
		const preSwitchSession = store.session

		store.setDraftSourceText(capturedText)
		const applyPromise = store.apply()
		await vi.waitFor(() => expect(recorded.mount)
			.toHaveBeenCalledTimes(2))
		const switchPromise = store.switchShowcase('survey')
		expect(store.session)
			.toBe(preSwitchSession)

		gate.resolve()
		await Promise.all([applyPromise, switchPromise])

		expect(preSwitchSession.preview?.revision)
			.toBe(1)
		expect(store.showcaseId.value)
			.toBe('survey')
		expect(store.documentState.value.revision)
			.toBe(0)
		expect(mountShowcases(recorded.mount))
			.toEqual(['sandbox', 'sandbox', 'survey'])
		expect(mountRevisions(recorded.mount))
			.toEqual([0, 1, 0])
		store.dispose()
	})

	it('serializes repeated switchShowcase() calls and the last queued call wins', async () => {
		const store = createLabStore()
		const recorded = createRecordingDriver()
		await attachDriver(store, recorded.driver)

		const survey = store.switchShowcase('survey')
		const sandbox = store.switchShowcase('sandbox')
		const surveyAgain = store.switchShowcase('survey')
		await Promise.all([survey, sandbox, surveyAgain])

		expect(store.showcaseId.value)
			.toBe('survey')
		expect(store.documentState.value.blueprint.status)
			.toBe('valid')
		expect(mountShowcases(recorded.mount))
			.toEqual(['sandbox', 'survey', 'sandbox', 'survey'])
		store.dispose()
	})

	it('serializes switchShowcase() behind an already-started applyPreset()', async () => {
		const store = createLabStore()
		const applyPresetPromise = store.applyPreset('invalid-semantic')
		const switchPromise = store.switchShowcase('survey')
		const [applyPresetOutcome] = await Promise.all([applyPresetPromise, switchPromise])

		expect(applyPresetOutcome?.status)
			.toBe('applied')
		expect(store.showcaseId.value)
			.toBe('survey')
		expect(store.documentState.value.blueprint.status)
			.toBe('valid')
	})

	it('captures the Apply draft at command-call time even while remote promotion is pending', async () => {
		const gate = createDeferred()
		const store = createLabStore()
		const recorded = createRecordingDriver({
			beforeMount: descriptor => descriptor.revision === 1 ? gate.promise : undefined,
		})
		await attachDriver(store, recorded.driver)

		store.setDraftSourceText(capturedText)
		const applyPromise = store.apply()
		store.setDraftSourceText(laterText)
		await vi.waitFor(() => expect(recorded.mount)
			.toHaveBeenCalledTimes(2))
		gate.resolve()

		const outcome = await applyPromise
		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })
		expect(store.documentState.value.sourceText)
			.toBe(capturedText)
		expect(store.draftSourceText.value)
			.toBe(laterText)
		expect(store.isDirty.value)
			.toBe(true)
		store.dispose()
	})

	it('rejects a second same-turn Apply while the first one is in flight', async () => {
		const gate = createDeferred()
		const store = createLabStore()
		const recorded = createRecordingDriver({
			beforeMount: descriptor => descriptor.revision === 1 ? gate.promise : undefined,
		})
		await attachDriver(store, recorded.driver)
		store.setDraftSourceText(capturedText)

		const firstPromise = store.apply()
		const secondPromise = store.apply()
		await vi.waitFor(() => expect(recorded.mount)
			.toHaveBeenCalledTimes(2))

		gate.resolve()
		const [firstOutcome, secondOutcome] = await Promise.all([firstPromise, secondPromise])
		expect(firstOutcome.status)
			.toBe('applied')
		expect(secondOutcome)
			.toEqual({ status: 'skipped-concurrent' })
		store.dispose()
	})

	it('blocks a new apply() while a showcase switch occupies the lifecycle boundary', async () => {
		const gate = createDeferred()
		const store = createLabStore()
		const recorded = createRecordingDriver({
			beforeMount: descriptor => descriptor.showcaseId === 'survey' ? gate.promise : undefined,
		})
		await attachDriver(store, recorded.driver)
		const preSwitchSession = store.session

		const switchPromise = store.switchShowcase('survey')
		const applyOutcome = await store.apply()
		expect(applyOutcome)
			.toEqual({ status: 'skipped-concurrent' })
		expect(preSwitchSession.documentState.revision)
			.toBe(0)

		await vi.waitFor(() => expect(recorded.mount)
			.toHaveBeenCalledTimes(2))
		gate.resolve()
		await switchPromise
		expect(store.showcaseId.value)
			.toBe('survey')
		store.dispose()
	})

	it('blocks a new applyPreset() while a showcase switch occupies the lifecycle boundary', async () => {
		const gate = createDeferred()
		const store = createLabStore()
		const recorded = createRecordingDriver({
			beforeMount: descriptor => descriptor.showcaseId === 'survey' ? gate.promise : undefined,
		})
		await attachDriver(store, recorded.driver)
		const preSwitchSession = store.session

		const switchPromise = store.switchShowcase('survey')
		const presetOutcome = await store.applyPreset('invalid-semantic')
		expect(presetOutcome)
			.toEqual({ status: 'skipped-concurrent' })
		expect(preSwitchSession.documentState.revision)
			.toBe(0)

		await vi.waitFor(() => expect(recorded.mount)
			.toHaveBeenCalledTimes(2))
		gate.resolve()
		await switchPromise
		expect(store.showcaseId.value)
			.toBe('survey')
		store.dispose()
	})

	it('does not record a conflict demonstration while a showcase switch is outstanding', async () => {
		const gate = createDeferred()
		const store = createLabStore()
		const recorded = createRecordingDriver({
			beforeMount: descriptor => descriptor.showcaseId === 'survey' ? gate.promise : undefined,
		})
		await attachDriver(store, recorded.driver)
		const outgoingSession = store.session

		const switchPromise = store.switchShowcase('survey')
		expect(store.demonstrateRevisionConflict())
			.toBeNull()
		expect(outgoingSession.documentTrace)
			.toHaveLength(0)

		await vi.waitFor(() => expect(recorded.mount)
			.toHaveBeenCalledTimes(2))
		expect(store.demonstrateRevisionConflict())
			.toBeNull()
		expect(outgoingSession.documentTrace)
			.toHaveLength(0)
		gate.resolve()
		await switchPromise
		store.dispose()
	})

	it('dispose() during a remote showcase mount prevents a late connection from being published', async () => {
		const gate = createDeferred()
		const store = createLabStore()
		const recorded = createRecordingDriver({
			beforeMount: descriptor => descriptor.showcaseId === 'survey' ? gate.promise : undefined,
		})
		await attachDriver(store, recorded.driver)

		const switchPromise = store.switchShowcase('survey')
		await vi.waitFor(() => expect(recorded.mount)
			.toHaveBeenCalledTimes(2))
		store.dispose()
		gate.resolve()
		await switchPromise

		expect(recorded.dispose)
			.toHaveBeenCalledOnce()
		expect(store.previewHost.connection.value)
			.toBeNull()
	})
})

describe('createLabStore() graph cluster expansion', () => {
	it('supports expanding, collapsing, and toggling clusters', () => {
		const store = createLabStore()
		expect(store.graphExpandedClusterIds.value.size)
			.toBe(0)

		store.expandGraphCluster('cluster:test')
		expect(store.graphExpandedClusterIds.value.has('cluster:test'))
			.toBe(true)
		store.toggleGraphCluster('cluster:test')
		expect(store.graphExpandedClusterIds.value.has('cluster:test'))
			.toBe(false)
		store.toggleGraphCluster('cluster:test')
		expect(store.graphExpandedClusterIds.value.has('cluster:test'))
			.toBe(true)
		store.collapseGraphCluster('cluster:test')
		expect(store.graphExpandedClusterIds.value.has('cluster:test'))
			.toBe(false)
	})

	it('supports expandAll and collapseAll', () => {
		const store = createLabStore()
		store.expandAllGraphClusters()
		expect(store.graphExpandedClusterIds.value.size)
			.toBeGreaterThan(0)
		store.collapseAllGraphClusters()
		expect(store.graphExpandedClusterIds.value.size)
			.toBe(0)
	})

	it('keeps graph cluster presentation state unchanged when a member is focused', () => {
		const store = createLabStore()
		const inspection = inspectBlueprint(store.documentState.value.blueprint)
		const titleWidget = inspection.nodes.find(node => node.resolved && node.node.id === 'title')!

		store.setFocus('document', {
			nodeId: titleWidget.nodeId,
			member: { type: 'state', name: 'text' },
		})

		expect(store.graphExpandedClusterIds.value.has(`cluster:${titleWidget.nodeId}`))
			.toBe(false)
	})

	it('resets expanded clusters on switchShowcase', async () => {
		const store = createLabStore()
		store.expandGraphCluster('cluster:custom')
		await store.switchShowcase('survey')
		expect(store.graphExpandedClusterIds.value.size)
			.toBe(0)
	})
})
