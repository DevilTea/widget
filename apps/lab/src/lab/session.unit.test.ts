import type { WidgetSystem } from '@deviltea/widget-core'
import type { SandboxPlugins } from '../sandbox/plugins'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it, vi } from 'vitest'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { replaceConfigScalar } from './author'
import { LAB_DOCUMENT_TRACE_LIMIT, LAB_UNDO_LIMIT, LabSession } from './session'

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
 * Wraps a real `WidgetSystem` so Document compilation and valid-Blueprint remote Preview replacement are
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
			return blueprint
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
		await session.commitJson()
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
	})

	// Phase 3A review: JSON that parses but that Core refuses used to look like a pending commit (and was never retried or
	// discardable). It is now a block of its own, as visible as a syntax error, until the text changes.
	describe('jSON text that parses but cannot be applied (jsonBlock)', () => {
		it('blocks a number outside the JSON domain (1e400) until the text changes', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			const infinite = validSource.replace('"Widget Lab sandbox"', '1e400')
			session.setDraftSourceText(infinite)
			expect(session.jsonBlock)
				.toBeNull()
			expect(await session.commitJson())
				.toMatchObject({ status: 'patch-error', failure: { code: 'json-incompatible-value', reason: 'non-finite-number' } })
			expect(session.jsonBlock)
				.toMatchObject({ kind: 'commit', sourceText: infinite, failure: { reason: 'non-finite-number', path: ['slots', 'items', 0, 'config', 'text'] } })
			expect(session.parseError)
				.toBeNull()
			expect(session.documentState.revision)
				.toBe(0)

			session.setDraftSourceText(validSource.replace('"Widget Lab sandbox"', '1'))
			expect(session.jsonBlock)
				.toBeNull()
			// Back to the refused text: it is tried again, and blocked again.
			session.setDraftSourceText(infinite)
			expect(session.jsonBlock)
				.toBeNull()
			await session.commitJson()
			expect(session.jsonBlock?.kind)
				.toBe('commit')
			session.revert()
			expect(session.jsonBlock)
				.toBeNull()
		})

		it('blocks a document nested deeper than Core accepts, and reports a syntax error as a block too', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			let deep: unknown = 0
			for (let level = 0; level < 300; level++)
				deep = [deep]
			session.setDraftSourceText(JSON.stringify(deep))
			await session.commitJson()
			expect(session.jsonBlock)
				.toMatchObject({ kind: 'commit', failure: { code: 'json-incompatible-value', reason: 'max-depth-exceeded' } })

			session.setDraftSourceText('{ nope')
			expect(session.jsonBlock)
				.toMatchObject({ kind: 'syntax', error: { sourceText: '{ nope' } })
		})
	})

	it('reports a too-deeply-nested JSON draft as a json-incompatible-value patch failure with operand path and reason', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		let deep: unknown = 0
		for (let level = 0; level < 300; level++)
			deep = [deep]
		session.setDraftSourceText(JSON.stringify(deep))

		const outcome = await session.commitJson()

		expect(outcome)
			.toMatchObject({ status: 'patch-error', failure: { code: 'json-incompatible-value', reason: 'max-depth-exceeded' } })
		expect(session.documentState.revision)
			.toBe(0)
		expect(session.documentTrace.at(-1))
			.toMatchObject({ kind: 'patch-error', revision: 0, code: 'json-incompatible-value', reason: 'max-depth-exceeded', path: expect.any(Array) })
	})

	describe('undo last change', () => {
		const thirdValidSource = '{ "id": "root", "type": "Text", "config": { "text": "third snapshot" } }\n'

		it('restores the previously applied source as a new Document revision and promotes it to Preview', async () => {
			const events: string[] = []
			const session = new LabSession({
				system: sandboxSystem,
				initialSourceText: validSource,
				hooks: { replacePreview: (preview) => { events.push(`preview:r${preview.revision}`) } },
			})
			expect(session.undoDepth)
				.toBe(0)
			session.setDraftSourceText(secondValidSource)
			await session.commitJson()
			expect(session.undoDepth)
				.toBe(1)

			const outcome = await session.undo()

			expect(outcome)
				.toEqual({ status: 'undone', blueprintStatus: 'valid' })
			// A new revision (r2), not a rewind to r0, and it went through the ordinary Preview promotion.
			expect(session.documentState.revision)
				.toBe(2)
			expect(session.documentState.sourceText)
				.toBe(validSource)
			expect(session.preview?.revision)
				.toBe(2)
			expect(events)
				.toEqual(['preview:r1', 'preview:r2'])
			expect(session.draftSourceText)
				.toBe(validSource)
			expect(session.isDirty)
				.toBe(false)
			expect(session.lastAppliedSourcePatch)
				.toMatchObject({ origin: 'undo', revision: 2, patch: [{ op: 'replace', path: '' }] })
			expect(session.undoDepth)
				.toBe(0)
		})

		it('walks back one applied source at a time and reports nothing-to-undo at the bottom', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			for (const text of [secondValidSource, thirdValidSource]) {
				session.setDraftSourceText(text)
				await session.commitJson()
			}
			expect(session.undoDepth)
				.toBe(2)

			await session.undo()
			expect(session.documentState.sourceText)
				.toBe(secondValidSource)
			await session.undo()
			expect(session.documentState.sourceText)
				.toBe(validSource)
			expect(await session.undo())
				.toEqual({ status: 'nothing-to-undo' })
			expect(session.documentState.revision)
				.toBe(4)
		})

		it('can undo an invalid apply while the old Preview was still running, and an applied invalid source back again', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			session.setDraftSourceText(invalidSource)
			await session.commitJson()
			expect(session.documentState.blueprint.status)
				.toBe('invalid')
			expect(session.preview?.revision)
				.toBe(0)

			expect(await session.undo())
				.toEqual({ status: 'undone', blueprintStatus: 'valid' })
			expect(session.documentState.blueprint.status)
				.toBe('valid')
			expect(session.preview?.revision)
				.toBe(2)
		})

		it('is unavailable while an unapplied draft exists and never discards it', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			session.setDraftSourceText(secondValidSource)
			await session.commitJson()
			session.setDraftSourceText(thirdValidSource)

			expect(await session.undo())
				.toEqual({ status: 'draft-dirty' })
			expect(session.draftSourceText)
				.toBe(thirdValidSource)
			expect(session.documentState.revision)
				.toBe(1)

			session.revert()
			expect(await session.undo())
				.toMatchObject({ status: 'undone' })
		})

		it('does not record a structural no-op apply, a failed parse, or the undo itself', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			session.setDraftSourceText(JSON.stringify(JSON.parse(validSource)))
			await session.commitJson()
			session.setDraftSourceText('{ nope')
			await session.commitJson()
			expect(session.undoDepth)
				.toBe(0)

			session.setDraftSourceText(secondValidSource)
			await session.commitJson()
			expect(session.undoDepth)
				.toBe(1)
			await session.undo()
			expect(session.undoDepth)
				.toBe(0)
		})

		it('records Structure commits too and keeps the stack bounded', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			const nodeId = inspectBlueprint(session.documentState.blueprint).nodes.find(node => node.resolved && node.node.id === 'title')!.nodeId
			await session.author(replaceConfigScalar(0, nodeId, 'text', 'changed through Structure'))
			expect(session.undoDepth)
				.toBe(1)
			await session.undo()
			expect(session.documentState.sourceText)
				.toBe(validSource)

			for (let index = 0; index < 30; index++) {
				session.setDraftSourceText(`{ "id": "root", "type": "Text", "config": { "text": "n${index}" } }`)
				await session.commitJson()
			}
			expect(session.undoDepth)
				.toBe(LAB_UNDO_LIMIT)
		})

		it('skips a concurrent command instead of overlapping it', async () => {
			const gate = createDeferred()
			const session = new LabSession({
				system: sandboxSystem,
				initialSourceText: validSource,
				hooks: { replacePreview: () => gate.promise },
			})
			session.setDraftSourceText(secondValidSource)
			const applying = session.commitJson()
			expect(await session.undo())
				.toEqual({ status: 'skipped-concurrent' })
			gate.resolve()
			await applying
		})
	})

	describe('coalesced JSON commits (Lab UX phase 3)', () => {
		const textSource = (text: string): string => `{ "id": "root", "type": "Text", "config": { "text": "${text}" } }`

		it('shares one Undo entry between JSON commits with the same key, so one Undo restores the source before the burst', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			for (const text of ['a', 'ab', 'abc']) {
				session.setDraftSourceText(textSource(text))
				expect(await session.commitJson({ coalesceKey: 1 }))
					.toEqual({ status: 'applied', blueprintStatus: 'valid' })
			}
			// Every commit is a real Document revision (the Preview follows each one), but only one Undo entry.
			expect(session.documentState.revision)
				.toBe(3)
			expect(session.undoDepth)
				.toBe(1)

			await session.undo()
			expect(session.documentState.sourceText)
				.toBe(validSource)
			expect(session.undoDepth)
				.toBe(0)
		})

		it('starts a new entry for a new key, and after any other commit or an Undo even with the same key', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			session.setDraftSourceText(textSource('first session'))
			await session.commitJson({ coalesceKey: 1 })
			session.setDraftSourceText(textSource('second session'))
			await session.commitJson({ coalesceKey: 2 })
			expect(session.undoDepth)
				.toBe(2)

			// A commit without a key (a preset, Format) never coalesces, and the next keyed commit pushes again.
			session.setDraftSourceText(textSource('no key'))
			await session.commitJson()
			session.setDraftSourceText(textSource('key 2 again'))
			await session.commitJson({ coalesceKey: 2 })
			expect(session.undoDepth)
				.toBe(4)

			// After Undo the same key no longer owns the top entry.
			await session.undo()
			session.setDraftSourceText(textSource('after undo'))
			await session.commitJson({ coalesceKey: 2 })
			expect(session.undoDepth)
				.toBe(4)
			await session.undo()
			expect(session.documentState.sourceText)
				.toBe(textSource('no key'))
		})

		it('a Structure commit in between ends the burst', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			const nodeId = inspectBlueprint(session.documentState.blueprint).nodes.find(node => node.resolved && node.node.id === 'title')!.nodeId
			await session.author(replaceConfigScalar(0, nodeId, 'text', 'through Structure'))
			const afterStructure = session.documentState.sourceText
			session.setDraftSourceText(afterStructure.replace('through Structure', 'then JSON'))
			await session.commitJson({ coalesceKey: 7 })
			expect(session.undoDepth)
				.toBe(2)
			await session.undo()
			expect(session.documentState.sourceText)
				.toBe(afterStructure)
		})

		it('drops the entry when the burst lands back on the source before it, and ignores a structural no-op', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			session.setDraftSourceText(textSource('typed'))
			await session.commitJson({ coalesceKey: 1 })
			// The same document in another layout is a structural no-op: no revision, no entry change.
			session.setDraftSourceText(JSON.stringify(JSON.parse(textSource('typed')), null, 4))
			await session.commitJson({ coalesceKey: 1 })
			expect(session.undoDepth)
				.toBe(1)

			session.setDraftSourceText(JSON.stringify(JSON.parse(validSource)))
			await session.commitJson({ coalesceKey: 1 })
			expect(session.undoDepth)
				.toBe(0)
			expect(session.documentState.revision)
				.toBe(2)
		})

		it('a burst that drops its entry at the Undo limit gives back the history its push evicted', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			for (let index = 0; index < LAB_UNDO_LIMIT; index++) {
				session.setDraftSourceText(textSource(`n${index}`))
				await session.commitJson()
			}
			expect(session.undoDepth)
				.toBe(LAB_UNDO_LIMIT)
			const start = session.documentState.sourceText
			// The burst's first commit pushes one more entry and evicts the oldest (the initial source)...
			session.setDraftSourceText(textSource('typed'))
			await session.commitJson({ coalesceKey: 9 })
			expect(session.undoDepth)
				.toBe(LAB_UNDO_LIMIT)
			// ...and landing back on where it started drops that entry and restores the evicted one.
			session.setDraftSourceText(start)
			await session.commitJson({ coalesceKey: 9 })
			expect(session.undoDepth)
				.toBe(LAB_UNDO_LIMIT)
			for (let index = 0; index < LAB_UNDO_LIMIT; index++)
				await session.undo()
			expect(session.documentState.sourceText)
				.toBe(validSource)
		})

		it('coalesces invalid commits too, and keeps the last valid Preview through them', async () => {
			const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
			session.setDraftSourceText('{ "id": "root", "type": "NoSuchWidget" }')
			expect(await session.commitJson({ coalesceKey: 1 }))
				.toEqual({ status: 'applied', blueprintStatus: 'invalid' })
			session.setDraftSourceText('{ "id": "root", "type": "NoSuchWidgetEither" }')
			await session.commitJson({ coalesceKey: 1 })
			expect(session.preview?.revision)
				.toBe(0)
			expect(session.undoDepth)
				.toBe(1)
			await session.undo()
			expect(session.documentState.sourceText)
				.toBe(validSource)
		})
	})

	it('keeps the observation trace bounded and drops the oldest entries', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		for (let index = 0; index < LAB_DOCUMENT_TRACE_LIMIT + 3; index++)
			await session.commitJson()
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
		const oldPreview = session.preview!

		const outcome = await session.author(replaceConfigScalar(0, nodeId, 'text', 'edited by Structure'))

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })
		expect(session.documentState.revision)
			.toBe(1)
		expect(session.preview?.revision)
			.toBe(1)
		expect(session.preview)
			.not.toBe(oldPreview)
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
		expect(session.preview)
			.not.toBe(previousPreview)
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
			hooks: { replacePreview: () => detach },
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
		expect(session.draftSourceText)
			.toBe(validSource)
		expect(session.isDirty)
			.toBe(false)
		expect(session.parseError)
			.toBeNull()
		expect(session.isApplying)
			.toBe(false)
	})

	// Lab UX phase 3: the syntax state is live. It used to be "the parse error of the last Apply", cleared by the next edit.
	it('setDraftSourceText() updates isDirty and the syntax error of the current text, without committing', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		session.setDraftSourceText('{ this is not JSON')
		expect(session.parseError?.sourceText)
			.toBe('{ this is not JSON')
		expect(session.isDirty)
			.toBe(true)

		session.setDraftSourceText('{ still not JSON')
		expect(session.parseError?.sourceText)
			.toBe('{ still not JSON')

		session.setDraftSourceText(secondValidSource)
		expect(session.parseError)
			.toBeNull()
		expect(session.isDirty)
			.toBe(true)
		expect(session.documentState.revision)
			.toBe(0)
	})

	it('commitJson() on a JSON syntax failure leaves the active snapshot untouched and sets a Lab-only SourceParseError', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const activeBefore = session.documentState
		const previewBefore = session.preview
		const invalidDraft = 'not json at all'

		session.setDraftSourceText(invalidDraft)
		const outcome = await session.commitJson()

		expect(outcome.status)
			.toBe('parse-error')
		if (outcome.status !== 'parse-error')
			throw new Error('unreachable')
		expect(outcome.error.sourceText)
			.toBe(invalidDraft)
		expect(typeof outcome.error.message)
			.toBe('string')
		expect(session.draftSourceText)
			.toBe(invalidDraft)
		expect(session.isDirty)
			.toBe(true)
		// Untouched by identity, not merely by value: the old Runtime/Preview must remain live.
		expect(session.documentState)
			.toBe(activeBefore)
		expect(session.preview)
			.toBe(previewBefore)
	})

	it('commitJson() never injects a JSON syntax failure into core Blueprint diagnostics', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: invalidSource })
		const diagnosticsBefore = session.documentState.blueprint.diagnostics

		session.setDraftSourceText('{ broken')
		await session.commitJson()

		// Same frozen array by identity: the syntax failure never touched the active Blueprint's
		// own (already non-empty) diagnostics.
		expect(session.documentState.blueprint.diagnostics)
			.toBe(diagnosticsBefore)
	})

	it('commits an invalid Document revision while retaining the exact last-valid Preview metadata', async () => {
		const events: string[] = []
		const session = new LabSession({
			system: sandboxSystem,
			initialSourceText: validSource,
			hooks: { replacePreview: () => { events.push('replace') } },
		})
		const previewBefore = session.preview!

		session.setDraftSourceText(invalidSource)
		const outcome = await session.commitJson()

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
			hooks: { replacePreview: () => { events.push('replace') } },
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
		expect(events)
			.toEqual([])

		await session.applyPreset(secondValidSource)

		expect(session.documentState.revision)
			.toBe(3)
		expect(session.documentState.blueprint.status)
			.toBe('valid')
		expect(session.preview?.revision)
			.toBe(3)
		expect(session.preview?.blueprint)
			.toBe(session.documentState.blueprint)
		expect(session.preview)
			.not.toBe(originalPreview)
		expect(events)
			.toEqual(['replace'])
	})

	it('accepts a text-only structural no-op without compiling, revising, or replacing Preview/Blueprint', async () => {
		const events: string[] = []
		const trackedSystem = createCompileTrackingSystem(sandboxSystem, events)
		const session = new LabSession({
			system: trackedSystem,
			initialSourceText: validSource,
			hooks: { replacePreview: () => { events.push('replace') } },
		})
		const document = session.documentState
		const preview = session.preview
		const equivalentSource = JSON.stringify(JSON.parse(validSource))
		events.length = 0 // Ignore revision-0 compile from construction.

		session.setDraftSourceText(equivalentSource)
		const outcome = await session.commitJson()

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
		expect(events)
			.toEqual([])
		expect(session.isDirty)
			.toBe(false)
	})

	it('commitJson() captures the draft at command start; edits made while it is in flight are not applied', async () => {
		const detach = createDeferred<void>()
		const session = new LabSession({
			system: sandboxSystem,
			initialSourceText: validSource,
			hooks: { replacePreview: () => detach.promise },
		})

		session.setDraftSourceText(secondValidSource)
		const applyPromise = session.commitJson()
		expect(session.isApplying)
			.toBe(true)

		// Mutate the draft while the in-flight apply is still awaiting remote Preview replacement.
		session.setDraftSourceText(invalidSource)

		detach.resolve()
		const outcome = await applyPromise

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })
		expect(session.documentState.sourceText)
			.toBe(secondValidSource)
		expect(session.draftSourceText)
			.toBe(invalidSource)
		expect(session.isDirty)
			.toBe(true)
	})

	it('disables concurrent Apply: a second commitJson() call while one is in flight is a no-op', async () => {
		const detach = createDeferred<void>()
		const session = new LabSession({
			system: sandboxSystem,
			initialSourceText: validSource,
			hooks: { replacePreview: () => detach.promise },
		})

		session.setDraftSourceText(secondValidSource)
		const first = session.commitJson()
		const second = await session.commitJson()

		expect(second)
			.toEqual({ status: 'skipped-concurrent' })

		detach.resolve()
		const firstOutcome = await first
		expect(firstOutcome)
			.toEqual({ status: 'applied', blueprintStatus: 'valid' })
	})

	it('commits the Document before awaiting remote Preview replacement acknowledgement', async () => {
		const events: string[] = []
		const detach = createDeferred<void>()
		const trackedSystem = createCompileTrackingSystem(sandboxSystem, events)
		const session = new LabSession({
			system: trackedSystem,
			initialSourceText: validSource,
			hooks: {
				replacePreview: async () => {
					events.push('replace-start')
					await detach.promise
					events.push('replace-end')
				},
			},
		})
		const oldPreview = session.preview!
		// The constructor's initial compile seeds revision 0 and is out of scope for this sequencing assertion.
		events.length = 0

		session.setDraftSourceText(secondValidSource)
		const applyPromise = session.commitJson()

		// `WidgetDocument.applyPatch()` is synchronous: compilation/commit finishes before remote replacement is awaited.
		expect(events)
			.toEqual(['compile', 'replace-start'])

		detach.resolve()
		await applyPromise

		expect(events)
			.toEqual(['compile', 'replace-start', 'replace-end'])
		expect(session.documentState.revision)
			.toBe(1)
		expect(session.preview?.revision)
			.toBe(1)
		expect(session.preview)
			.not.toBe(oldPreview)
	})

	it('starts with no Preview for invalid source and keeps it absent across invalid commits', async () => {
		const events: string[] = []
		const session = new LabSession({
			system: sandboxSystem,
			initialSourceText: invalidSource,
			hooks: { replacePreview: () => { events.push('replace') } },
		})

		session.setDraftSourceText(invalidSource.replace('does-not-exist', 'still-does-not-exist'))
		const outcome = await session.commitJson()

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
		expect(session.documentState.sourceText)
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
		expect(session.parseError).not.toBeNull()
		const activeBefore = session.documentState

		session.revert()

		expect(session.draftSourceText)
			.toBe(validSource)
		expect(session.parseError)
			.toBeNull()
		expect(session.isDirty)
			.toBe(false)
		expect(session.documentState)
			.toBe(activeBefore)
	})

	it('revert() restores the invalid committed Document source while retaining the older Preview', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })
		const initialDocument = session.documentState
		const initialPreview = session.preview!

		const outcome = await session.applyPreset(invalidSource)
		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'invalid' })

		const committedDocument = session.documentState
		const retainedPreview = session.preview!
		expect(committedDocument)
			.not.toBe(initialDocument)
		expect(committedDocument.revision)
			.toBe(1)
		expect(committedDocument.sourceText)
			.toBe(invalidSource)
		expect(retainedPreview)
			.toBe(initialPreview)
		expect(retainedPreview.revision)
			.toBe(0)

		session.setDraftSourceText(secondValidSource)
		expect(session.isDirty)
			.toBe(true)
		const documentBeforeRevert = session.documentState
		const previewBeforeRevert = session.preview

		session.revert()

		expect(session.draftSourceText)
			.toBe(invalidSource)
		expect(session.isDirty)
			.toBe(false)
		expect(session.documentState)
			.toBe(documentBeforeRevert)
		expect(session.documentState)
			.toBe(committedDocument)
		expect(session.documentState.revision)
			.toBe(1)
		expect(session.preview)
			.toBe(previewBeforeRevert)
		expect(session.preview)
			.toBe(retainedPreview)
		expect(session.preview?.revision)
			.toBe(0)
	})

	it('applyPreset() sets the draft and runs the same Apply pipeline as manual editing', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		const outcome = await session.applyPreset(invalidSource)

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'invalid' })
		expect(session.documentState.sourceText)
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
		expect(session.documentState.sourceText)
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

		await session.commitJson()
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

	describe('retryPreview (audit U22)', () => {
		it('after a promotion that failed, mounts the newest valid Document, so the Preview and the revision status agree', async () => {
			const mounted: number[] = []
			let failNext = false
			const session = new LabSession({
				system: sandboxSystem,
				initialSourceText: validSource,
				hooks: {
					replacePreview: (preview) => {
						if (failNext) {
							failNext = false
							throw new Error('Preview iframe did not become ready within 1000 ms.')
						}
						mounted.push(preview.revision)
					},
				},
			})
			failNext = true
			session.setDraftSourceText(secondValidSource)
			await expect(session.commitJson())
				.rejects
				.toThrow('did not become ready')
			// The Document committed; the Preview is still the older one.
			expect(session.documentState.revision)
				.toBe(1)
			expect(session.preview?.revision)
				.toBe(0)

			await session.retryPreview()

			expect(mounted)
				.toEqual([1])
			expect(session.preview?.revision)
				.toBe(1)
			expect(session.preview?.sourceText)
				.toBe(session.documentState.sourceText)
		})

		it('with an invalid Document, mounts the last valid Preview again; with nothing to mount it does nothing', async () => {
			const mounted: number[] = []
			const session = new LabSession({
				system: sandboxSystem,
				initialSourceText: validSource,
				hooks: { replacePreview: (preview) => { mounted.push(preview.revision) } },
			})
			await session.applyPreset(invalidSource)
			expect(session.preview?.revision)
				.toBe(0)

			await session.retryPreview()
			expect(mounted)
				.toEqual([0])
			expect(session.preview?.revision)
				.toBe(0)

			const replacePreview = vi.fn()
			const none = new LabSession({ system: sandboxSystem, initialSourceText: invalidSource, hooks: { replacePreview } })
			await expect(none.retryPreview())
				.resolves
				.toBeUndefined()
			expect(replacePreview)
				.not
				.toHaveBeenCalled()
		})

		it('a mount that fails again rejects and leaves the Preview as it was', async () => {
			const session = new LabSession({
				system: sandboxSystem,
				initialSourceText: validSource,
				hooks: { replacePreview: () => { throw new Error('still down') } },
			})
			await expect(session.retryPreview())
				.rejects
				.toThrow('still down')
			expect(session.preview?.revision)
				.toBe(0)
			expect(session.isApplying)
				.toBe(false)
		})
	})
})
