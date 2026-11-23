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
import { createLabStore, JSON_COMMIT_DELAY_MS, PREVIEW_RESTARTED_MS } from './use-lab-store'

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

		store.editJson(capturedText)
		const applyOutcome = await store.flushJson()
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
		store.editJson(equivalentText)
		await store.flushJson()

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

		store.editJson(capturedText)
		const outcome = await store.flushJson()

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
			.toEqual(['survey', 'trip-budget', 'quote-rules', 'onboarding', 'document-repair', 'renderer-packs'])
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

		store.editJson(capturedText)
		const applyPromise = store.flushJson()
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

		store.editJson(capturedText)
		const applyPromise = store.flushJson()
		store.editJson(laterText)
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

	// Lab UX phase 3: a second commit in the same turn used to be refused (`skipped-concurrent`); the first one has already
	// taken the text into the Document synchronously, so the second has nothing left to commit.
	it('commits once when the JSON text is flushed twice in the same turn', async () => {
		const gate = createDeferred()
		const store = createSandboxStore()
		const recorded = createRecordingDriver({
			beforeMount: descriptor => descriptor.revision === 1 ? gate.promise : undefined,
		})
		await attachDriver(store, recorded.driver)
		store.editJson(capturedText)

		const firstPromise = store.flushJson()
		const secondPromise = store.flushJson()
		await vi.waitFor(() => expect(recorded.mount)
			.toHaveBeenCalledTimes(2))

		gate.resolve()
		const [firstOutcome, secondOutcome] = await Promise.all([firstPromise, secondPromise])
		expect(firstOutcome?.status)
			.toBe('applied')
		expect(secondOutcome)
			.toBeNull()
		expect(store.documentState.value.revision)
			.toBe(1)
		store.dispose()
	})

	it('blocks a new JSON commit while a showcase switch occupies the lifecycle boundary', async () => {
		const gate = createDeferred()
		const store = createSandboxStore()
		const recorded = createRecordingDriver({
			beforeMount: descriptor => descriptor.showcaseId === 'survey' ? gate.promise : undefined,
		})
		await attachDriver(store, recorded.driver)
		const preSwitchSession = store.session

		const switchPromise = store.switchShowcase('survey')
		store.editJson(capturedText)
		const applyOutcome = await store.flushJson()
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

	it('keeps at most one cluster expanded: expanding B collapses A, collapsing the expanded one leaves none (issue #254)', () => {
		const store = createSandboxStore()
		store.expandGraphCluster('cluster:a')
		expect([...store.graphExpandedClusterIds.value])
			.toEqual(['cluster:a'])

		store.expandGraphCluster('cluster:b')
		expect([...store.graphExpandedClusterIds.value])
			.toEqual(['cluster:b'])

		store.toggleGraphCluster('cluster:a')
		expect([...store.graphExpandedClusterIds.value])
			.toEqual(['cluster:a'])

		// Collapsing a widget that is not the expanded one changes nothing.
		store.collapseGraphCluster('cluster:b')
		expect([...store.graphExpandedClusterIds.value])
			.toEqual(['cluster:a'])

		store.toggleGraphCluster('cluster:a')
		expect(store.graphExpandedClusterIds.value.size)
			.toBe(0)

		store.expandGraphCluster('cluster:b')
		store.collapseAllGraphClusters()
		expect(store.graphExpandedClusterIds.value.size)
			.toBe(0)
		expect('expandAllGraphClusters' in store)
			.toBe(false)
	})

	it('does not replace the expanded set when the expanded cluster is expanded again (no relayout)', () => {
		const store = createSandboxStore()
		store.expandGraphCluster('cluster:a')
		const before = store.graphExpandedClusterIds.value
		store.expandGraphCluster('cluster:a')
		expect(store.graphExpandedClusterIds.value)
			.toBe(before)
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

	// Lab UX phase 3: there is no Apply. Undo is unavailable only while the JSON text does not parse (it would replace text
	// that was never committed); pending text that parses is committed first, and a running command is waited for.
	it('derives Undo availability from the JSON text and the committed history', async () => {
		const store = createSandboxStore()
		expect(store.canUndo.value)
			.toBe(false)

		// Pending text that parses can be undone: Undo commits it first.
		store.editJson(secondText)
		expect(store.canUndo.value)
			.toBe(true)
		const committing = store.flushJson()
		expect(store.isApplying.value)
			.toBe(true)
		expect(store.canUndo.value)
			.toBe(true)
		await committing
		expect(store.undoDepth.value)
			.toBe(1)

		store.editJson(`${secondText} {`)
		expect(store.jsonBlocked.value)
			.toBe(true)
		expect(store.canUndo.value)
			.toBe(false)
		expect(await store.undo())
			.toEqual({ status: 'draft-dirty' })
		store.discardJsonChanges()
		expect(store.jsonBlocked.value)
			.toBe(false)
		expect(store.canUndo.value)
			.toBe(true)

		expect(await store.undo())
			.toMatchObject({ status: 'undone' })
		expect(store.documentState.value.revision)
			.toBe(2)
		expect(store.draftSourceText.value)
			.toBe(store.documentState.value.sourceText)
		expect(store.canUndo.value)
			.toBe(false)
		store.dispose()
	})

	it('undo commits pending JSON text first, so it takes back that text and not the change before it', async () => {
		const store = createSandboxStore()
		const initial = store.documentState.value.sourceText
		store.editJson(secondText)
		expect(await store.undo())
			.toMatchObject({ status: 'undone' })
		expect(store.documentState.value.sourceText)
			.toBe(initial)
		// r1 committed the text, r2 is the Undo.
		expect(store.documentState.value.revision)
			.toBe(2)
		store.dispose()
	})

	it('a command that arrives while another runs waits for it instead of being refused', async () => {
		const gate = createDeferred()
		const store = createSandboxStore()
		const recorded = createRecordingDriver({
			beforeMount: descriptor => descriptor.revision === 1 ? gate.promise : undefined,
		})
		await attachDriver(store, recorded.driver)

		store.editJson(capturedText)
		const committing = store.flushJson()
		// The click on Undo lands while the blur commit is still promoting the Preview.
		const undoing = store.undo()
		expect(store.documentState.value.revision)
			.toBe(1)
		gate.resolve()
		expect(await committing)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })
		expect(await undoing)
			.toEqual({ status: 'undone', blueprintStatus: 'valid' })
		expect(store.documentState.value.revision)
			.toBe(2)
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

		store.editJson(secondText)
		expect(store.example.value.kind)
			.toBe('edited')
		await store.flushJson()
		expect(store.example.value.kind)
			.toBe('edited')

		await store.undo()
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
		store.editJson(secondText)
		await store.flushJson()
		expect(store.canUndo.value)
			.toBe(true)

		await store.switchShowcase('survey')

		expect(store.undoDepth.value)
			.toBe(0)
		expect(store.canUndo.value)
			.toBe(false)
		store.dispose()
	})

	it('derives the status chip and the Problems list from the Document and the live JSON syntax state', async () => {
		const store = createSandboxStore()
		expect(store.status.value)
			.toEqual({ validity: { kind: 'valid' }, preview: 'current', json: 'ok', chip: { kind: 'up-to-date' } })
		expect(store.problems.value)
			.toEqual([])

		await store.applyPreset('invalid-semantic')
		expect(store.status.value)
			.toEqual({ validity: { kind: 'problems', count: 1 }, preview: 'stale', json: 'ok', chip: { kind: 'problems', count: 1, previewShown: true } })
		expect(store.problems.value)
			.toHaveLength(1)
		expect(store.problems.value[0])
			.toMatchObject({ kind: 'diagnostic', code: 'missing-dependency-target' })

		// A syntax error is live: it shows while the text does not parse, before and without any commit.
		store.editJson('{ broken')
		expect(store.status.value.chip)
			.toEqual({ kind: 'json-not-applied', reason: 'syntax' })
		expect(store.status.value.validity)
			.toEqual({ kind: 'problems', count: 1 })
		expect(store.problems.value.map(problem => problem.kind))
			.toEqual(['syntax', 'diagnostic'])
		expect(await store.flushJson())
			.toBeNull()
		expect(store.documentState.value.revision)
			.toBe(1)

		store.editJson(secondText)
		expect(store.problems.value.map(problem => problem.kind))
			.toEqual(['diagnostic'])
		store.dispose()
	})

	it('does not recompute the Problems list while JSON text that parses is edited (only a commit or the syntax state changes it)', async () => {
		const store = createSandboxStore()
		await store.applyPreset('invalid-semantic')
		const listed = store.problems.value

		store.editJson(secondText)
		store.editJson(`${secondText} `)
		expect(store.problems.value)
			.toBe(listed)

		await store.flushJson()
		expect(store.problems.value).not.toBe(listed)
		expect(store.problems.value)
			.toEqual([])
		store.dispose()
	})

	it('opens Edit on the Structure view by default, for a fresh store and after a showcase switch (Lab UX phase 1)', async () => {
		const store = createSandboxStore()
		expect(store.activeTab.value)
			.toBe('edit')
		expect(store.authorView.value)
			.toBe('structure')
		// A view the user chose stays when the showcase changes: only the first load picks the default.
		store.authorView.value = 'json'
		await store.switchShowcase('survey')
		expect(store.authorView.value)
			.toBe('json')
		store.dispose()
	})

	it('showProblems() activates Edit, stays in the open view and flags the problems for focus', () => {
		const store = createSandboxStore()
		for (const [from, to] of [['structure', 'structure'], ['json', 'json']] as const) {
			const before = store.tabRequest.value?.tick ?? 0
			store.authorView.value = from
			store.problemsFocusPending.value = false

			store.showProblems()

			// A new request every time, also when Edit already is the active tab (it may be hidden behind a maximized Tools group).
			expect(store.tabRequest.value?.tab)
				.toBe('edit')
			expect(store.tabRequest.value!.tick)
				.toBeGreaterThan(before)
			expect(store.authorView.value, `from ${from}`)
				.toBe(to)
			expect(store.problemsFocusPending.value)
				.toBe(true)
		}
		store.dispose()
	})
})

describe('createLabStore() expert views (Lab UX phase 3B)', () => {
	it('openTool() makes every call a new request, so asking again for an open view focuses it again', () => {
		const store = createSandboxStore()
		expect(store.toolOpenRequest.value)
			.toBeNull()
		store.openTool('runtime')
		const first = store.toolOpenRequest.value
		expect(first?.tool)
			.toBe('runtime')
		store.openTool('runtime')
		expect(store.toolOpenRequest.value?.tool)
			.toBe('runtime')
		expect(store.toolOpenRequest.value)
			.not
			.toBe(first)
		expect(store.toolOpenRequest.value!.tick)
			.toBeGreaterThan(first!.tick)
		// Opening a view never switches the tool group's tab: what the user was reading on the left stays.
		expect(store.activeTab.value)
			.toBe('edit')
		store.dispose()
	})
})

describe('createLabStore() problems use the showcase\'s config schemas', () => {
	it('locates a broken widget reference at its config value with the survey\'s generated schemas', async () => {
		const store = createLabStore(getShowcase('survey')!)
		await store.applyPreset('survey-ai-draft')
		expect(store.problems.value.find(problem => problem.code === 'missing-dependency-target'))
			.toMatchObject({ configPath: ['visibleWhen', 'question'], widgetLevel: false })
		store.dispose()
	})
})

describe('createLabStore() committed edits and the replaced-document notice (Lab UX phase 2)', () => {
	it('has committed edits only while the applied source equals no preset of the showcase', async () => {
		const store = createLabStore(getShowcase('survey')!)
		expect(store.hasCommittedEdits.value)
			.toBe(false)
		await store.applyPreset('survey-ai-draft')
		expect(store.hasCommittedEdits.value)
			.toBe(false)

		// Lab UX phase 3: JSON text that parses is an edit already (it is committed before any replacement runs); text that
		// does not parse is not (that is `jsonBlocked`, which asks on its own).
		store.editJson('{ broken')
		expect(store.hasCommittedEdits.value)
			.toBe(false)
		store.editJson(store.documentState.value.sourceText.replace('How will you join?', 'Where will you be?'))
		expect(store.hasCommittedEdits.value)
			.toBe(true)
		await store.flushJson()
		expect(store.hasCommittedEdits.value)
			.toBe(true)

		await store.undo()
		expect(store.hasCommittedEdits.value)
			.toBe(false)
		store.dispose()
	})

	it('offers Undo after a preset load replaced committed edits, until Undo, a later commit or a showcase switch', async () => {
		const store = createLabStore(getShowcase('survey')!)
		// Nothing edited: reloading a preset replaces nothing worth a notice.
		await store.applyPreset('survey-ai-draft')
		expect(store.replacedNotice.value)
			.toBeNull()

		const edited = store.documentState.value.sourceText.replace('How will you join?', 'Where will you be?')
		store.editJson(edited)
		await store.flushJson()
		await store.applyPreset('survey-default')
		expect(store.replacedNotice.value)
			.toEqual({ subject: 'Default — open day sign-up', revision: store.documentState.value.revision })
		expect(store.replacedNoticeVisible.value)
			.toBe(true)

		// Undo brings the edits back and ends the notice.
		await store.undo()
		expect(store.documentState.value.sourceText)
			.toBe(edited)
		expect(store.replacedNoticeVisible.value)
			.toBe(false)

		await store.applyPreset('survey-default')
		expect(store.replacedNoticeVisible.value)
			.toBe(true)
		store.dismissReplacedNotice()
		expect(store.replacedNoticeVisible.value)
			.toBe(false)

		await store.undo()
		await store.applyPreset('survey-default')
		expect(store.replacedNoticeVisible.value)
			.toBe(true)
		await store.switchShowcase('trip-budget')
		expect(store.replacedNotice.value)
			.toBeNull()
		store.dispose()
	})
})

describe('createLabStore() JSON auto-commit (Lab UX phase 3)', () => {
	const textSource = (text: string): string => `{ "id": "root", "type": "Text", "config": { "text": "${text}" } }`

	it('commits JSON text that parses once typing pauses for JSON_COMMIT_DELAY_MS, and not before', async () => {
		vi.useFakeTimers()
		try {
			const store = createSandboxStore()
			store.beginJsonEdit()
			store.editJson(textSource('a'))
			await vi.advanceTimersByTimeAsync(JSON_COMMIT_DELAY_MS - 100)
			store.editJson(textSource('ab'))
			// Each edit restarts the pause: nothing is committed while typing goes on.
			await vi.advanceTimersByTimeAsync(JSON_COMMIT_DELAY_MS - 100)
			expect(store.documentState.value.revision)
				.toBe(0)
			await vi.advanceTimersByTimeAsync(100)
			expect(store.documentState.value.revision)
				.toBe(1)
			expect(store.documentState.value.sourceText)
				.toBe(textSource('ab'))
			expect(store.isDirty.value)
				.toBe(false)
			store.dispose()
		}
		finally {
			vi.useRealTimers()
		}
	})

	it('commits at once on blur, and the pending timer then has nothing left to do', async () => {
		vi.useFakeTimers()
		try {
			const store = createSandboxStore()
			store.beginJsonEdit()
			store.editJson(textSource('blurred'))
			const outcome = store.endJsonEdit()
			expect(store.documentState.value.revision)
				.toBe(1)
			expect(await outcome)
				.toEqual({ status: 'applied', blueprintStatus: 'valid' })
			await vi.advanceTimersByTimeAsync(JSON_COMMIT_DELAY_MS * 2)
			expect(store.documentState.value.revision)
				.toBe(1)
			store.dispose()
		}
		finally {
			vi.useRealTimers()
		}
	})

	it('never commits text that does not parse, by timer or blur, and keeps the Document and Preview', async () => {
		vi.useFakeTimers()
		try {
			const store = createSandboxStore()
			const preview = store.preview.value
			store.beginJsonEdit()
			store.editJson('{ "id": "root", ')
			await vi.advanceTimersByTimeAsync(JSON_COMMIT_DELAY_MS * 2)
			expect(await store.endJsonEdit())
				.toBeNull()
			expect(store.documentState.value.revision)
				.toBe(0)
			expect(store.preview.value)
				.toBe(preview)
			expect(store.jsonBlocked.value)
				.toBe(true)
			expect(store.status.value.chip)
				.toEqual({ kind: 'json-not-applied', reason: 'syntax' })

			store.discardJsonChanges()
			expect(store.jsonBlocked.value)
				.toBe(false)
			expect(store.isDirty.value)
				.toBe(false)
			store.dispose()
		}
		finally {
			vi.useRealTimers()
		}
	})

	it('coalesces the commits of one focus session into one Undo entry; a new focus session is a new entry', async () => {
		vi.useFakeTimers()
		try {
			const store = createSandboxStore()
			const initial = store.documentState.value.sourceText
			store.beginJsonEdit()
			for (const text of ['a', 'ab', 'abc']) {
				store.editJson(textSource(text))
				await vi.advanceTimersByTimeAsync(JSON_COMMIT_DELAY_MS)
			}
			store.editJson(textSource('abcd'))
			await store.endJsonEdit()
			// Four commits (the Preview followed each one), one Undo entry.
			expect(store.documentState.value.revision)
				.toBe(4)
			expect(store.undoDepth.value)
				.toBe(1)

			store.beginJsonEdit()
			store.editJson(textSource('second session'))
			await store.endJsonEdit()
			expect(store.undoDepth.value)
				.toBe(2)

			await store.undo()
			expect(store.documentState.value.sourceText)
				.toBe(textSource('abcd'))
			await store.undo()
			expect(store.documentState.value.sourceText)
				.toBe(initial)
			store.dispose()
		}
		finally {
			vi.useRealTimers()
		}
	})

	it('format commits the formatted text as its own change, outside the typing burst', async () => {
		const store = createSandboxStore()
		store.editJson(JSON.stringify(JSON.parse(textSource('compact'))))
		await store.flushJson()
		await store.format()
		expect(store.documentState.value.sourceText)
			.toBe(JSON.stringify(JSON.parse(textSource('compact')), null, 2))
		// Same document, other layout: a structural no-op, so no revision and no Undo entry.
		expect(store.documentState.value.revision)
			.toBe(1)
		expect(store.undoDepth.value)
			.toBe(1)
		store.dispose()
	})

	it('a preset load commits pending JSON text first, so Undo brings that text back', async () => {
		const store = createSandboxStore()
		store.editJson(textSource('pending'))
		await store.applyPreset('invalid-semantic')
		expect(store.loadedPresetId.value)
			.toBe('invalid-semantic')
		await store.undo()
		expect(store.documentState.value.sourceText)
			.toBe(textSource('pending'))
		store.dispose()
	})

	it('a showcase switch drops pending text and its timer', async () => {
		vi.useFakeTimers()
		try {
			const store = createSandboxStore()
			store.editJson(textSource('pending'))
			await store.switchShowcase('survey')
			await vi.advanceTimersByTimeAsync(JSON_COMMIT_DELAY_MS * 2)
			expect(store.showcaseId.value)
				.toBe('survey')
			expect(store.documentState.value.revision)
				.toBe(0)
			expect(store.isDirty.value)
				.toBe(false)
			store.dispose()
		}
		finally {
			vi.useRealTimers()
		}
	})
})

describe('createLabStore() "Preview restarted" (Lab UX phase 3)', () => {
	it('is set for PREVIEW_RESTARTED_MS after a commit replaced the Runtime, not by an invalid commit or a showcase switch', async () => {
		vi.useFakeTimers()
		try {
			const store = createSandboxStore()
			expect(store.previewRestarted.value)
				.toBe(false)

			store.editJson('{ "id": "root", "type": "Text", "config": { "text": "restart" } }')
			await store.flushJson()
			expect(store.previewRestarted.value)
				.toBe(true)
			expect(store.status.value.chip)
				.toEqual({ kind: 'restarted' })
			await vi.advanceTimersByTimeAsync(PREVIEW_RESTARTED_MS)
			expect(store.previewRestarted.value)
				.toBe(false)
			expect(store.status.value.chip)
				.toEqual({ kind: 'up-to-date' })

			// An invalid commit keeps the last valid Preview: nothing restarted.
			await store.applyPreset('invalid-semantic')
			expect(store.previewRestarted.value)
				.toBe(false)

			// A showcase switch mounts another session's Preview: not "restarted" by a commit.
			await store.switchShowcase('survey')
			expect(store.previewRestarted.value)
				.toBe(false)
			store.dispose()
		}
		finally {
			vi.useRealTimers()
		}
	})

	// Phase 3A review: a switch right after a commit used to keep "Preview restarted" (and its timer) from the old session.
	it('is cleared, with its timer, by a showcase switch', async () => {
		vi.useFakeTimers()
		try {
			const store = createSandboxStore()
			store.editJson('{ "id": "root", "type": "Text", "config": { "text": "restart" } }')
			await store.flushJson()
			expect(store.previewRestarted.value)
				.toBe(true)
			await store.switchShowcase('survey')
			expect(store.previewRestarted.value)
				.toBe(false)
			expect(store.status.value.chip)
				.toEqual({ kind: 'up-to-date' })
			expect(vi.getTimerCount())
				.toBe(0)
			store.dispose()
		}
		finally {
			vi.useRealTimers()
		}
	})
})

// Phase 3A review fixes.
describe('createLabStore() JSON that parses but cannot be applied', () => {
	it('1e400 is blocked on blur: the chip names the reason, Discard and Undo behave as for a syntax error, and a new text clears it', async () => {
		const store = createSandboxStore()
		const initial = store.documentState.value.sourceText
		const infinite = initial.replace('"Widget Lab sandbox"', '1e400')
		store.beginJsonEdit()
		store.editJson(infinite)
		expect(await store.endJsonEdit())
			.toMatchObject({ status: 'patch-error', failure: { reason: 'non-finite-number' } })
		expect(store.jsonBlocked.value)
			.toBe(true)
		expect(store.status.value.chip)
			.toEqual({ kind: 'json-not-applied', reason: 'commit', detail: 'non-finite-number' })
		expect(store.problems.value[0])
			.toMatchObject({ kind: 'commit', code: 'json-incompatible-value' })
		expect(store.canUndo.value)
			.toBe(false)
		expect(await store.undo())
			.toEqual({ status: 'draft-dirty' })
		// Not retried by flushing again: the same text stays refused.
		expect(await store.flushJson())
			.toBeNull()
		expect(store.documentState.value.revision)
			.toBe(0)

		store.editJson(initial.replace('"Widget Lab sandbox"', '"fixed"'))
		expect(store.jsonBlocked.value)
			.toBe(false)
		expect(store.status.value.chip.kind)
			.not
			.toBe('json-not-applied')

		store.editJson(infinite)
		await store.flushJson()
		store.discardJsonChanges()
		expect(store.jsonBlocked.value)
			.toBe(false)
		expect(store.isDirty.value)
			.toBe(false)
		store.dispose()
	})

	it('a document nested deeper than Core accepts is blocked the same way', async () => {
		const store = createSandboxStore()
		let deep: unknown = 0
		for (let level = 0; level < 300; level++)
			deep = [deep]
		store.editJson(JSON.stringify(deep))
		await store.flushJson()
		expect(store.status.value.chip)
			.toEqual({ kind: 'json-not-applied', reason: 'commit', detail: 'max-depth-exceeded' })
		expect(store.hasCommittedEdits.value)
			.toBe(false)
		store.dispose()
	})
})

describe('createLabStore() commands that wait', () => {
	function gatedStore(gatedRevision: number) {
		const gate = createDeferred()
		const store = createSandboxStore()
		const recorded = createRecordingDriver({
			beforeMount: descriptor => descriptor.revision === gatedRevision ? gate.promise : undefined,
		})
		return { gate, store, recorded }
	}
	const titleNodeId = (store: LabStore) => inspectBlueprint(store.documentState.value.blueprint).nodes.find(node => node.resolved && node.node.id === 'title')!.nodeId

	it('a Structure command built when it starts takes the revision current then, not the one it was asked against', async () => {
		const { gate, store, recorded } = gatedStore(1)
		await attachDriver(store, recorded.driver)
		const first = store.author(replaceConfigScalar(0, titleNodeId(store), 'text', 'one'))
		const undoing = store.undo()
		// Asked while r1 is still promoting and Undo waits: built later, against r2.
		const second = store.author(() => replaceConfigScalar(store.documentState.value.revision, titleNodeId(store), 'text', 'two'))
		gate.resolve()
		expect(await first)
			.toMatchObject({ status: 'applied' })
		expect(await undoing)
			.toMatchObject({ status: 'undone' })
		expect(await second)
			.toMatchObject({ status: 'applied' })
		expect(store.documentState.value.revision)
			.toBe(3)
		expect(store.documentState.value.sourceText)
			.toContain('"text": "two"')
		store.dispose()
	})

	it('undo requests while an Undo is on its way are that same Undo; a request after it finished undoes the next step', async () => {
		const store = createSandboxStore()
		for (const text of ['a', 'b']) {
			store.editJson(`{ "id": "root", "type": "Text", "config": { "text": "${text}" } }`)
			await store.flushJson()
		}
		const firstClick = store.undo()
		const doubleClick = store.undo()
		expect(doubleClick)
			.toBe(firstClick)
		expect(await firstClick)
			.toMatchObject({ status: 'undone' })
		expect(store.documentState.value.sourceText)
			.toContain('"text": "a"')
		expect(await store.undo())
			.toMatchObject({ status: 'undone' })
		expect(store.undoDepth.value)
			.toBe(0)
		store.dispose()
	})

	it('a focus that comes back to an open editing session (the window was away) continues its burst', async () => {
		const store = createSandboxStore()
		const initial = store.documentState.value.sourceText
		store.beginJsonEdit()
		store.editJson('{ "id": "root", "type": "Text", "config": { "text": "before alt-tab" } }')
		await store.flushJson()
		// The window blur is ignored by the editor (no endJsonEdit); its focus comes back.
		store.beginJsonEdit()
		store.editJson('{ "id": "root", "type": "Text", "config": { "text": "after alt-tab" } }')
		await store.endJsonEdit()
		expect(store.undoDepth.value)
			.toBe(1)
		await store.undo()
		expect(store.documentState.value.sourceText)
			.toBe(initial)
		store.dispose()
	})
})
