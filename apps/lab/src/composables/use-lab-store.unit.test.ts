// @vitest-environment happy-dom

import type { PreviewFrameConnection, PreviewFrameDriver } from '../preview-host/frame-driver'
import type { PreviewHostDescriptor } from '../preview-host/protocol'
import type { LabStore } from './use-lab-store'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, onUnmounted } from 'vue'
import { replaceConfigScalar } from '../lab/author'
import { getShowcase } from '../showcases/registry'
import { createLabStore } from './use-lab-store'

/** Most lifecycle tests drive the minimal Sandbox fixture, which is hidden and no longer the default. */
function createSandboxStore(): LabStore {
	return createLabStore(getShowcase('sandbox')!)
}

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
		onUnexpectedClose: () => () => {},
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

function mountDescriptors(mount: ReturnType<typeof vi.fn>): PreviewHostDescriptor[] {
	return mount.mock.calls.map(([descriptor]) => descriptor as PreviewHostDescriptor)
}

function mountShowcases(mount: ReturnType<typeof vi.fn>): string[] {
	return mount.mock.calls.map(([descriptor]) => (descriptor as PreviewHostDescriptor).showcaseId)
}

describe('createLabStore() remote Preview ownership', () => {
	it('disposes the iframe driver and clears the remote connection', async () => {
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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

describe('createLabStore() Preview source forwarding', () => {
	it('mounts authoritative source text initially, after Apply, and after switching showcases', async () => {
		const store = createSandboxStore()
		const recorded = createRecordingDriver()
		await attachDriver(store, recorded.driver)

		const initialDocument = store.documentState.value
		const initialMount = mountDescriptors(recorded.mount)[0]!
		expect(initialMount.showcaseId)
			.toBe('sandbox')
		expect(initialMount.revision)
			.toBe(initialDocument.revision)
		expect(initialMount.sourceText)
			.toBe(initialDocument.sourceText)

		store.setDraftSourceText(capturedText)
		const applyOutcome = await store.apply()
		expect(applyOutcome)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })

		const appliedDocument = store.documentState.value
		const applyMount = mountDescriptors(recorded.mount)[1]!
		expect(applyMount.showcaseId)
			.toBe('sandbox')
		expect(applyMount.revision)
			.toBe(appliedDocument.revision)
		expect(applyMount.sourceText)
			.toBe(appliedDocument.sourceText)
		expect(applyMount.sourceText)
			.toBe(capturedText)

		await store.switchShowcase('survey')

		const switchedDocument = store.documentState.value
		const switchMount = mountDescriptors(recorded.mount)[2]!
		expect(switchMount.showcaseId)
			.toBe('survey')
		expect(switchMount.revision)
			.toBe(switchedDocument.revision)
		expect(switchMount.sourceText)
			.toBe(switchedDocument.sourceText)
		expect(switchMount.sourceText)
			.toBe(store.preview.value?.sourceText)
		store.dispose()
	})
})

describe('createLabStore() committed Document bridge', () => {
	it('exposes the high-level Author command and promotes the new valid revision remotely', async () => {
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
	it('survive a changed successful Apply to a new valid Blueprint', async () => {
		const store = createSandboxStore()
		store.graphShowAbsent.value = true
		store.graphShowIsolatedMembers.value = true
		const previousDocument = store.documentState.value
		const previousPreview = store.preview.value!

		store.setDraftSourceText(capturedText)
		const outcome = await store.apply()

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })
		expect(store.documentState.value.revision)
			.toBe(previousDocument.revision + 1)
		expect(store.documentState.value)
			.not.toBe(previousDocument)
		expect(store.documentState.value.blueprint)
			.not.toBe(previousDocument.blueprint)
		expect(store.preview.value)
			.not.toBe(previousPreview)
		expect(store.preview.value?.revision)
			.toBe(previousPreview.revision + 1)
		expect(store.graphShowAbsent.value)
			.toBe(true)
		expect(store.graphShowIsolatedMembers.value)
			.toBe(true)
		store.dispose()
	})

	it('survive an Apply that lands on an invalid Blueprint', async () => {
		const store = createSandboxStore()
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
	it('starts on the default (survey) authored context and lists only non-hidden showcases', () => {
		const store = createLabStore()
		expect(store.showcaseId.value)
			.toBe('survey')
		expect(store.showcases.map(showcase => showcase.id))
			.toEqual(['survey', 'trip-budget'])
		expect(store.documentState.value.blueprint.status)
			.toBe('valid')
		expect(store.preview.value?.revision)
			.toBe(0)
		store.dispose()
	})

	it('starts on the given initial showcase, including a hidden test fixture', () => {
		const store = createSandboxStore()
		expect(store.showcaseId.value)
			.toBe('sandbox')
		expect(store.presets.value.some(preset => preset.id === 'valid-interactive'))
			.toBe(true)
		expect(store.documentState.value.blueprint.status)
			.toBe('valid')
		expect(store.preview.value?.revision)
			.toBe(0)
		store.dispose()
	})

	it('replaces the authored session/presets and promotes the target revision-0 Preview', async () => {
		const store = createSandboxStore()
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
		const store = createSandboxStore()
		await store.switchShowcase('survey')

		expect(store.draftSourceText.value)
			.toBe(store.documentState.value.sourceText)
		expect(store.documentState.value.definition)
			.toMatchObject({ type: 'Survey' })
	})

	it('is a no-op for the current or an unknown showcase', async () => {
		const store = createSandboxStore()
		const session = store.session

		await store.switchShowcase('sandbox')
		await store.switchShowcase('does-not-exist')

		expect(store.session)
			.toBe(session)
		expect(store.showcaseId.value)
			.toBe('sandbox')
	})

	it('resolves applyPreset() against the new showcase after switching', async () => {
		const store = createSandboxStore()
		await store.switchShowcase('survey')

		const outcome = await store.applyPreset('survey-cycle')

		expect(outcome?.status)
			.toBe('applied')
		expect(store.documentState.value.definition)
			.toMatchObject({ type: 'Survey' })
	})

	it('adopts the target authoritative revision-0 snapshot without a synthetic same-source Apply', async () => {
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
		const store = createSandboxStore()
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
		const store = createSandboxStore()
		store.expandAllGraphClusters()
		expect(store.graphExpandedClusterIds.value.size)
			.toBeGreaterThan(0)
		store.collapseAllGraphClusters()
		expect(store.graphExpandedClusterIds.value.size)
			.toBe(0)
	})

	it('keeps graph cluster presentation state unchanged when a member is focused', () => {
		const store = createSandboxStore()
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
		const store = createSandboxStore()
		store.expandGraphCluster('cluster:custom')
		await store.switchShowcase('survey')
		expect(store.graphExpandedClusterIds.value.size)
			.toBe(0)
	})
})

describe('createLabStore() header and feedback state', () => {
	const secondText = '{ "id": "root", "type": "Text", "config": { "text": "second" } }\n'

	it('derives Apply/Undo availability from the draft and the applied history', async () => {
		const store = createSandboxStore()
		expect(store.canApply.value)
			.toBe(false)
		expect(store.canUndo.value)
			.toBe(false)

		store.setDraftSourceText(secondText)
		expect(store.canApply.value)
			.toBe(true)
		const applying = store.apply()
		expect(store.canApply.value)
			.toBe(false)
		await applying
		expect(store.undoDepth.value)
			.toBe(1)
		expect(store.canUndo.value)
			.toBe(true)

		store.setDraftSourceText(`${secondText} `)
		expect(store.canUndo.value)
			.toBe(false)
		store.revert()
		expect(store.canUndo.value)
			.toBe(true)

		expect(await store.undoLastApply())
			.toMatchObject({ status: 'undone' })
		expect(store.documentState.value.revision)
			.toBe(2)
		expect(store.draftSourceText.value)
			.toBe(store.documentState.value.sourceText)
		expect(store.canUndo.value)
			.toBe(false)
		store.dispose()
	})

	it('names the loaded preset until the source stops matching it, then reports edited', async () => {
		const store = createSandboxStore()
		expect(store.loadedPresetId.value)
			.toBe('valid-interactive')
		expect(store.example.value)
			.toMatchObject({ kind: 'preset', preset: { id: 'valid-interactive' } })

		await store.applyPreset('invalid-semantic')
		expect(store.loadedPresetId.value)
			.toBe('invalid-semantic')
		expect(store.example.value)
			.toMatchObject({ kind: 'preset', preset: { id: 'invalid-semantic' } })

		store.setDraftSourceText(secondText)
		expect(store.example.value.kind)
			.toBe('edited')
		await store.apply()
		expect(store.example.value.kind)
			.toBe('edited')

		await store.undoLastApply()
		expect(store.example.value)
			.toMatchObject({ kind: 'preset', preset: { id: 'invalid-semantic' } })

		await store.switchShowcase('survey')
		expect(store.loadedPresetId.value)
			.toBe('survey-default')
		expect(store.example.value)
			.toMatchObject({ kind: 'preset', preset: { id: 'survey-default' } })
		store.dispose()
	})

	it('starts a fresh undo history in a switched showcase', async () => {
		const store = createSandboxStore()
		store.setDraftSourceText(secondText)
		await store.apply()
		expect(store.canUndo.value)
			.toBe(true)

		await store.switchShowcase('survey')

		expect(store.undoDepth.value)
			.toBe(0)
		expect(store.canUndo.value)
			.toBe(false)
		store.dispose()
	})

	it('derives plain-language status and the Problems list from the last Apply', async () => {
		const store = createSandboxStore()
		expect(store.status.value)
			.toEqual({ validity: { kind: 'valid' }, preview: 'current' })
		expect(store.problems.value)
			.toEqual([])

		await store.applyPreset('invalid-semantic')
		expect(store.status.value)
			.toEqual({ validity: { kind: 'problems', count: 1 }, preview: 'stale' })
		expect(store.problems.value)
			.toHaveLength(1)
		expect(store.problems.value[0])
			.toMatchObject({ kind: 'diagnostic', code: 'missing-dependency-target' })

		store.setDraftSourceText('{ broken')
		await store.apply()
		expect(store.status.value.validity)
			.toEqual({ kind: 'problems', count: 2 })
		expect(store.problems.value.map(problem => problem.kind))
			.toEqual(['syntax', 'diagnostic'])

		// Editing clears the Lab-only syntax error, as before.
		store.setDraftSourceText(secondText)
		expect(store.problems.value.map(problem => problem.kind))
			.toEqual(['diagnostic'])
		store.dispose()
	})

	it('does not recompute the Problems list while the draft is edited (only a commit or the parse error changes it)', async () => {
		const store = createSandboxStore()
		await store.applyPreset('invalid-semantic')
		const listed = store.problems.value

		store.setDraftSourceText(secondText)
		store.setDraftSourceText(`${secondText} `)
		expect(store.problems.value)
			.toBe(listed)

		await store.apply()
		expect(store.problems.value).not.toBe(listed)
		expect(store.problems.value)
			.toEqual([])
		store.dispose()
	})

	it('showProblems() opens Author > JSON and flags the Problems list for focus', () => {
		const store = createSandboxStore()
		store.activeTab.value = 'runtime'
		store.authorView.value = 'catalog'

		store.showProblems()

		expect(store.activeTab.value)
			.toBe('author')
		expect(store.authorView.value)
			.toBe('json')
		expect(store.problemsFocusPending.value)
			.toBe(true)
		store.dispose()
	})
})
