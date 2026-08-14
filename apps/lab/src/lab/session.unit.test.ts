import { describe, expect, it } from 'vitest'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { LabSession } from './session'

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

describe('labSession', () => {
	it('constructs the initial active snapshot synchronously from valid initial source text', () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		expect(session.active.sourceText)
			.toBe(validSource)
		expect(session.active.blueprint.status)
			.toBe('valid')
		expect(session.active.runtime).not.toBeNull()
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
		const issuesBefore = session.active.blueprint.getCollectedIssues()

		session.setDraftSourceText('{ broken')
		await session.apply()

		// Same frozen array by identity: the syntax failure never touched the active Blueprint's
		// own (already non-empty) diagnostics.
		expect(session.active.blueprint.getCollectedIssues())
			.toBe(issuesBefore)
	})

	it('apply() on a semantically invalid Blueprint still crosses the applied-snapshot boundary, with runtime null', async () => {
		const session = new LabSession({ system: sandboxSystem, initialSourceText: validSource })

		session.setDraftSourceText(invalidSource)
		const outcome = await session.apply()

		expect(outcome)
			.toEqual({ status: 'applied', blueprintStatus: 'invalid' })
		expect(session.active.sourceText)
			.toBe(invalidSource)
		expect(session.active.blueprint.status)
			.toBe('invalid')
		expect(session.active.runtime)
			.toBeNull()
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

	it('sequences detach -> dispose -> commit -> create Runtime -> mount, never disposing before the old Preview detaches', async () => {
		const events: string[] = []
		const detach = createDeferred<void>()
		const session = new LabSession({
			system: sandboxSystem,
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
		const oldRuntime = session.active.runtime!

		session.setDraftSourceText(secondValidSource)
		const applyPromise = session.apply()

		// Let detachPreview() start, but not resolve yet.
		await Promise.resolve()
		expect(events)
			.toEqual(['detach-start'])
		expect(oldRuntime.isDisposed)
			.toBe(false)

		detach.resolve()
		await applyPromise

		expect(events)
			.toEqual(['detach-start', 'detach-end', 'mount'])
		expect(oldRuntime.isDisposed)
			.toBe(true)
		expect(session.active.runtime).not.toBe(oldRuntime)
		expect(session.active.runtime!.isDisposed)
			.toBe(false)
	})

	it('does not call detachPreview()/mountPreview() when there is no old Runtime and the new Blueprint is invalid', async () => {
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
		expect(session.active.runtime)
			.toBeNull()
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
