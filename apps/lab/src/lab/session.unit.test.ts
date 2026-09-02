import type { WidgetSystem } from '@deviltea/widget-core'
import type { SandboxPlugins } from '../sandbox/plugins'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { replaceConfigScalar } from './author'
import { LAB_DOCUMENT_TRACE_LIMIT, LabSession } from './session'

const validSource = sandboxPresets.find(preset => preset.id === 'valid-interactive')!.sourceText
const invalidSource = sandboxPresets.find(preset => preset.id === 'invalid-semantic')!.sourceText
const secondValidSource = '{ "id": "root", "type": "Text", "config": { "text": "second snapshot" } }\n'

function createDeferred<T = void>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

/**
 * Wraps a real `WidgetSystem` so Document compilation and valid-Blueprint Runtime creation are
 * observable in the same event trace as the Lab Preview hooks. `getPlugin`/`validateStructure` are
 * copied by reference (they close over the real system's own state, not `this`), so the wrapper is
 * otherwise behaviorally identical.
 */
function createCompileTrackingSystem(system: WidgetSystem<SandboxPlugins>, events: string[]): WidgetSystem<SandboxPlugins> {
	return {
		...system,
		createBlueprint: (definition) => {
			events.push('compile')
			const blueprint = system.createBlueprint(definition)
			if (blueprint.status !== 'valid')
				return blueprint
			return {
				...blueprint,
				createRuntime: (options) => {
					events.push('runtime-create')
					return blueprint.createRuntime(options)
				},
			}
		},
	}
}

describe('labSession', () => {
	it('records the latest applied patch provenance for Structure and JSON without replacing Document authority', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const nodeId = inspectBlueprint(session.documentState.blueprint).nodes.find(node => node.resolved && node.node.id === 'title')!.nodeId

		await session.author(replaceConfigScalar(0, nodeId, 'text', 'developer-tools-structure'))
		expect(session.lastAppliedSourcePatch)
			.toMatchObject({ origin: 'structure', revision: 1, patch: expect.any(Array) })

		session.setDraftSourceText(secondValidSource)
		await session.apply()
		expect(session.lastAppliedSourcePatch)
			.toMatchObject({ origin: 'json', revision: 2, patch: [{ op: 'replace', path: '', value: JSON.parse(secondValidSource) }] })
	})

	it('demonstrates Core revision conflict without changing Document or retained Preview', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const beforeDocumentRevision = session.documentSnapshot.revision
		const beforePreview = session.preview!

		const demo = session.demonstrateRevisionConflict()

		expect(demo.expectedRevision)
			.toBe(beforeDocumentRevision - 1)
		expect(demo.result)
			.toMatchObject({ ok: false, failure: { code: 'document-revision-conflict' } })
		expect(demo.beforeDocumentRevision)
			.toBe(demo.afterDocumentRevision)
		expect(session.documentSnapshot.revision)
			.toBe(beforeDocumentRevision)
		expect(session.preview)
			.toBe(beforePreview)
		expect(session.preview!.runtime.isDisposed)
			.toBe(false)
	})

	it('keeps the observation trace bounded and drops the oldest entries', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		for (let index = 0; index < LAB_DOCUMENT_TRACE_LIMIT + 3; index++)
			await session.apply()
		expect(session.documentTrace)
			.toHaveLength(LAB_DOCUMENT_TRACE_LIMIT)
		expect(session.documentTrace.every(event => event.kind === 'commit'))
			.toBe(true)

		session.demonstrateRevisionConflict()
		expect(session.documentTrace)
			.toHaveLength(LAB_DOCUMENT_TRACE_LIMIT)
		expect(session.documentTrace.at(-1))
			.toMatchObject({ kind: 'conflict-demo', failureCode: 'document-revision-conflict' })
	})

	it('routes an Author command through SourcePatch, increments Document revision, promotes a valid Runtime, and cleans JSON', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const nodeId = inspectBlueprint(session.documentState.blueprint).nodes.find(node => node.resolved && node.node.id === 'title')!.nodeId
		const oldRuntime = session.preview!.runtime

		const outcome = await session.author(replaceConfigScalar(0, nodeId, 'text', 'edited by Structure'))

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })
		expect(session.documentState.revision)
			.toBe(1)
		expect(session.preview?.revision)
			.toBe(1)
		expect(session.preview?.runtime)
			.not.toBe(oldRuntime)
		expect(oldRuntime.isDisposed)
			.toBe(true)
		expect(session.draftSourceText)
			.toBe(JSON.stringify(session.documentState.blueprint.source, null, 2))
		expect(session.isDirty)
			.toBe(false)
	})

	it('rejects Author commands while the JSON draft is dirty without side effects, then applies after revert', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const nodeId = inspectBlueprint(session.documentState.blueprint).nodes.find(node => node.resolved && node.node.id === 'title')!.nodeId
		const previousPreview = session.preview!
		const previousRevision = session.documentState.revision

		session.setDraftSourceText(`${validSource}\n`)
		const rejected = await session.author(replaceConfigScalar(previousRevision, nodeId, 'text', 'after revert'))

		expect(rejected)
			.toEqual({ status: 'draft-dirty' })
		expect(session.documentState.revision)
			.toBe(previousRevision)
		expect(session.preview)
			.toBe(previousPreview)
		expect(previousPreview.runtime.isDisposed)
			.toBe(false)
		expect(session.lastAppliedSourcePatch)
			.toBeNull()
		expect(session.documentTrace)
			.toHaveLength(0)

		session.revert()
		const applied = await session.author(replaceConfigScalar(previousRevision, nodeId, 'text', 'after revert'))

		expect(applied)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })
		expect(session.documentState.revision)
			.toBe(previousRevision + 1)
		expect(session.preview?.runtime)
			.not.toBe(previousPreview.runtime)
		expect(previousPreview.runtime.isDisposed)
			.toBe(true)
	})

	it('commits an invalid Author command while retaining the prior Preview revision', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const nodeId = inspectBlueprint(session.documentState.blueprint).nodes.find(node => node.resolved && node.node.id === 'summary-1')!.nodeId
		const retainedPreview = session.preview!

		const outcome = await session.author(replaceConfigScalar(0, nodeId, 'counterId', 'does-not-exist'))

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'invalid' })
		expect(session.documentState.revision)
			.toBe(1)
		expect(session.documentState.blueprint.status)
			.toBe('invalid')
		expect(session.preview)
			.toBe(retainedPreview)
		expect(retainedPreview.runtime.isDisposed)
			.toBe(false)
		expect(session.draftSourceText)
			.toBe(JSON.stringify(session.documentState.blueprint.source, null, 2))
		expect(session.isDirty)
			.toBe(false)
	})

	it('does not overwrite a concurrent JSON draft edit while Runtime promotion is pending', async () => {
		let releaseDetach!: () => void
		const detach = new Promise<void>((resolve) => {
			releaseDetach = resolve
		})
		const session = new LabSession({
			system: sandboxSystem,
			initialSourceText: validSource,
			hooks: { detachPreview: () => detach, mountPreview: () => {} },
		})
		const nodeId = inspectBlueprint(session.documentState.blueprint).nodes.find(node => node.resolved && node.node.id === 'title')!.nodeId
		const concurrentDraft = '{ "id": "root", "type": "Text", "config": { "text": "typed while promoting" } }\n'

		const authorPromise = session.author(replaceConfigScalar(0, nodeId, 'text', 'author value'))
		session.setDraftSourceText(concurrentDraft)
		releaseDetach()
		await authorPromise

		expect(session.draftSourceText)
			.toBe(concurrentDraft)
		expect(session.isDirty)
			.toBe(true)
		expect(session.documentState.sourceText)
			.toBe(JSON.stringify(session.documentState.blueprint.source, null, 2))
	})

	it('constructs Document r0 and Preview r0 synchronously from valid initial source text', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		expect(session.documentState.sourceText)
			.toBe(validSource)
		expect(session.documentState.revision)
			.toBe(0)
		expect(session.documentState.blueprint.status)
			.toBe('valid')
		expect(session.preview?.revision)
			.toBe(0)
		expect(session.preview?.blueprint)
			.toBe(session.documentState.blueprint)
		expect(session.preview?.runtime).not.toBeNull()
		expect(session.draftSourceText)
			.toBe(validSource)
		expect(session.isDirty)
			.toBe(false)
		expect(session.parseError)
			.toBeNull()
		expect(session.isApplying)
			.toBe(false)
	})

	it('setDraftSourceText() updates isDirty and clears a stale parse error', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		session.setDraftSourceText('{ this is not JSON')
		const outcome = await session.apply()
		expect(outcome.status)
			.toBe('parse-error')
		expect(session.parseError).not.toBeNull()

		session.setDraftSourceText('{ still not JSON')
		expect(session.parseError)
			.toBeNull()
		expect(session.isDirty)
			.toBe(true)
	})

	it('apply() on a JSON syntax failure leaves the active snapshot untouched and sets a Lab-only SourceParseError', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const activeBefore = session.active

		session.setDraftSourceText('not json at all')
		const outcome = await session.apply()

		expect(outcome.status)
			.toBe('parse-error')
		if (outcome.status !== 'parse-error')
			throw new Error('unreachable')
		expect(outcome.error.sourceText)
			.toBe('not json at all')
		expect(typeof outcome.error.message)
			.toBe('string')
		// Untouched by identity, not merely by value: the old Runtime/Preview must remain live.
		expect(session.active)
			.toBe(activeBefore)
	})

	it('apply() never injects a JSON syntax failure into core Blueprint diagnostics', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: invalidSource })
		const diagnosticsBefore = session.active.blueprint.diagnostics

		session.setDraftSourceText('{ broken')
		await session.apply()

		// Same frozen array by identity: the syntax failure never touched the active Blueprint's
		// own (already non-empty) diagnostics.
		expect(session.active.blueprint.diagnostics)
			.toBe(diagnosticsBefore)
	})

	it('commits an invalid Document revision while retaining the exact last-valid Preview Runtime', async () => {
		const events: string[] = []
		const session = new LabSession({
			system: sandboxSystem,
			initialSourceText: validSource,
			hooks: {
				detachPreview: () => { events.push('detach') },
				mountPreview: () => { events.push('mount') },
			},
		})
		const previewBefore = session.preview!

		session.setDraftSourceText(invalidSource)
		const outcome = await session.apply()

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'invalid' })
		expect(session.documentState.sourceText)
			.toBe(invalidSource)
		expect(session.documentState.revision)
			.toBe(1)
		expect(session.documentState.blueprint.status)
			.toBe('invalid')
		expect(session.preview)
			.toBe(previewBefore)
		expect(session.preview!.revision)
			.toBe(0)
		expect(session.preview!.runtime.isDisposed)
			.toBe(false)
		expect(events)
			.toEqual([])
		expect(session.isDirty)
			.toBe(false)
	})

	it('keeps the same last-valid Preview across multiple invalid revisions, then replaces it on the next valid revision', async () => {
		const events: string[] = []
		const session = new LabSession({
			system: sandboxSystem,
			initialSourceText: validSource,
			hooks: {
				detachPreview: () => { events.push('detach') },
				mountPreview: () => { events.push('mount') },
			},
		})
		const originalPreview = session.preview!

		await session.applyPreset(invalidSource)
		await session.applyPreset(invalidSource.replace('does-not-exist', 'still-does-not-exist'))

		expect(session.documentState.revision)
			.toBe(2)
		expect(session.documentState.blueprint.status)
			.toBe('invalid')
		expect(session.preview)
			.toBe(originalPreview)
		expect(originalPreview.runtime.isDisposed)
			.toBe(false)
		expect(events)
			.toEqual([])

		await session.applyPreset(secondValidSource)

		expect(session.documentState.revision)
			.toBe(3)
		expect(session.documentState.blueprint.status)
			.toBe('valid')
		expect(originalPreview.runtime.isDisposed)
			.toBe(true)
		expect(session.preview?.revision)
			.toBe(3)
		expect(session.preview?.blueprint)
			.toBe(session.documentState.blueprint)
		expect(session.preview?.runtime)
			.not.toBe(originalPreview.runtime)
		expect(events)
			.toEqual(['detach', 'mount'])
	})

	it('accepts a text-only structural no-op without compiling, revising, or replacing Runtime/Blueprint', async () => {
		const events: string[] = []
		const trackedSystem = createCompileTrackingSystem(sandboxSystem, events)
		const session = new LabSession({
			system: trackedSystem,
			initialSourceText: validSource,
			hooks: {
				detachPreview: () => { events.push('detach') },
				mountPreview: () => { events.push('mount') },
			},
		})
		const document = session.documentState
		const preview = session.preview
		const equivalentSource = JSON.stringify(JSON.parse(validSource))
		events.length = 0 // Ignore revision-0 compile/Runtime creation from construction.

		session.setDraftSourceText(equivalentSource)
		const outcome = await session.apply()

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })
		expect(session.documentState.sourceText)
			.toBe(equivalentSource)
		expect(session.documentState.revision)
			.toBe(0)
		expect(session.documentState.blueprint)
			.toBe(document.blueprint)
		expect(session.preview)
			.toBe(preview)
		expect(preview?.runtime.isDisposed)
			.toBe(false)
		expect(events)
			.toEqual([])
		expect(session.isDirty)
			.toBe(false)
	})

	it('apply() captures the draft at command start; edits made while it is in flight are not applied', async () => {
		const detach = createDeferred<void>()
		const session = new LabSession({
			system: sandboxSystem,
			initialSourceText: validSource,
			hooks: { detachPreview: () => detach.promise, mountPreview: () => {} },
		})

		session.setDraftSourceText(secondValidSource)
		const applyPromise = session.apply()
		expect(session.isApplying)
			.toBe(true)

		// Mutate the draft while the in-flight apply is still stuck awaiting detachPreview().
		session.setDraftSourceText(invalidSource)

		detach.resolve()
		const outcome = await applyPromise

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })
		expect(session.active.sourceText)
			.toBe(secondValidSource)
		expect(session.draftSourceText)
			.toBe(invalidSource)
		expect(session.isDirty)
			.toBe(true)
	})

	it('disables concurrent Apply: a second apply() call while one is in flight is a no-op', async () => {
		const detach = createDeferred<void>()
		const session = new LabSession({
			system: sandboxSystem,
			initialSourceText: validSource,
			hooks: { detachPreview: () => detach.promise, mountPreview: () => {} },
		})

		session.setDraftSourceText(secondValidSource)
		const first = session.apply()
		const second = await session.apply()

		expect(second)
			.toEqual({ status: 'skipped-concurrent' })

		detach.resolve()
		const firstOutcome = await first
		expect(firstOutcome)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })
	})

	it('commits the Document before detach/dispose, then creates and mounts the replacement Runtime', async () => {
		const events: string[] = []
		const detach = createDeferred<void>()
		const trackedSystem = createCompileTrackingSystem(sandboxSystem, events)
		const session = new LabSession({
			system: trackedSystem,
			initialSourceText: validSource,
			hooks: {
				detachPreview: async () => {
					events.push('detach-start')
					await detach.promise
					events.push('detach-end')
				},
				mountPreview: () => {
					events.push('mount')
				},
			},
		})
		const oldRuntime = session.preview!.runtime
		// The constructor's initial compile + Runtime creation seed revision 0 and are out of scope for
		// this Apply-sequencing assertion.
		events.length = 0

		session.setDraftSourceText(secondValidSource)
		const applyPromise = session.apply()

		// `WidgetDocument.applyPatch()` is synchronous: compilation/commit must finish before the first
		// Preview-detach await begins. The old Runtime remains alive until detach has actually completed.
		expect(events)
			.toEqual(['compile', 'detach-start'])
		expect(oldRuntime.isDisposed)
			.toBe(false)

		detach.resolve()
		await applyPromise

		expect(events)
			.toEqual(['compile', 'detach-start', 'detach-end', 'runtime-create', 'mount'])
		expect(session.documentState.revision)
			.toBe(1)
		expect(session.preview?.revision)
			.toBe(1)
		expect(oldRuntime.isDisposed)
			.toBe(true)
		expect(session.preview?.runtime).not.toBe(oldRuntime)
		expect(session.preview!.runtime.isDisposed)
			.toBe(false)
	})

	it('starts with no Preview for invalid source and keeps it absent across invalid commits', async () => {
		const events: string[] = []
		const session = new LabSession({
			system: sandboxSystem,
			initialSourceText: invalidSource,
			hooks: {
				detachPreview: () => {
					events.push('detach')
				},
				mountPreview: () => {
					events.push('mount')
				},
			},
		})

		session.setDraftSourceText(invalidSource.replace('does-not-exist', 'still-does-not-exist'))
		const outcome = await session.apply()

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'invalid' })
		expect(events)
			.toEqual([])
		expect(session.preview)
			.toBeNull()
		expect(session.documentState.revision)
			.toBe(1)
	})

	it('format() rewrites the draft as pretty JSON, clears a stale parse error, and never applies', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		session.setDraftSourceText('{"id":"root","type":"Text","config":{"text":"x"}}')
		session.format()

		expect(session.draftSourceText)
			.toBe(JSON.stringify({ id: 'root', type: 'Text', config: { text: 'x' } }, null, 2))
		expect(session.active.sourceText)
			.toBe(validSource)
		expect(session.isDirty)
			.toBe(true)
	})

	it('format() is a no-op on unparseable draft text', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		session.setDraftSourceText('not json')
		session.format()

		expect(session.draftSourceText)
			.toBe('not json')
	})

	it('revert() restores the draft to active.sourceText, clears the parse error, and never touches active', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		session.setDraftSourceText('garbled')
		await session.apply()
		expect(session.parseError).not.toBeNull()
		const activeBefore = session.active

		session.revert()

		expect(session.draftSourceText)
			.toBe(validSource)
		expect(session.parseError)
			.toBeNull()
		expect(session.isDirty)
			.toBe(false)
		expect(session.active)
			.toBe(activeBefore)
	})

	it('applyPreset() sets the draft and runs the same Apply pipeline as manual editing', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		const outcome = await session.applyPreset(invalidSource)

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'invalid' })
		expect(session.active.sourceText)
			.toBe(invalidSource)
		expect(session.draftSourceText)
			.toBe(invalidSource)
		expect(session.isDirty)
			.toBe(false)
	})

	it('applyPreset() surfaces a parse-error for malformed preset text exactly like manual Apply', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		const outcome = await session.applyPreset('{not valid json')

		expect(outcome.status)
			.toBe('parse-error')
		expect(session.active.sourceText)
			.toBe(validSource)
	})

	it('subscribe() notifies listeners on draft edits, Apply start/end, revert, and format, and stops after unsubscribing', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		let calls = 0
		const unsubscribe = session.subscribe(() => {
			calls++
		})

		session.setDraftSourceText(secondValidSource)
		expect(calls)
			.toBe(1)

		await session.apply()
		expect(calls)
			.toBe(3) // apply-start emit + apply-end emit

		session.setDraftSourceText('garbled')
		session.revert()
		expect(calls)
			.toBe(5)

		session.setDraftSourceText('{"id":"root","type":"Text","config":{"text":"y"}}')
		session.format()
		expect(calls)
			.toBe(7)

		unsubscribe()
		session.setDraftSourceText(validSource)
		expect(calls)
			.toBe(7)
	})
})
