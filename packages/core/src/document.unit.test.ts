import { describe, expect, it, vi } from 'vitest'
import { createWidgetDocument, createWidgetPlugin, createWidgetSystem } from './index'

function createFixture() {
	const plugin = createWidgetPlugin('panel')
		.description('A panel')
		.interfaces<Record<never, never>>()
		.done()
	const system = createWidgetSystem({ plugins: [plugin] })
	return { plugin, system }
}

describe('widgetDocument', () => {
	it('compiles an initial snapshot and commits one revision per changed patch', () => {
		const { system } = createFixture()
		const document = createWidgetDocument({ system, source: { type: 'panel' } })
		const listener = vi.fn()
		document.subscribe(listener)

		expect(document.getSnapshot().revision)
			.toBe(0)
		const result = document.applyPatch([{ op: 'add', path: '/config', value: { enabled: true } }])

		expect(result)
			.toEqual({ ok: true, changed: true })
		expect(document.getSnapshot().revision)
			.toBe(1)
		expect(document.getSnapshot().blueprint.source)
			.toEqual({ type: 'panel', config: { enabled: true } })
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(listener)
			.toHaveBeenCalledWith(document.getSnapshot())
	})

	it('does not compile, revise, or notify for a no-op patch', () => {
		const { system } = createFixture()
		const createBlueprint = vi.fn(system.createBlueprint)
		const instrumentedSystem = { ...system, createBlueprint }
		const document = createWidgetDocument({ system: instrumentedSystem, source: { type: 'panel' } })
		const listener = vi.fn()
		document.subscribe(listener)
		createBlueprint.mockClear()

		const result = document.applyPatch([{ op: 'test', path: '/type', value: 'panel' }])

		expect(result)
			.toEqual({ ok: true, changed: false })
		expect(document.getSnapshot().revision)
			.toBe(0)
		expect(createBlueprint).not.toHaveBeenCalled()
		expect(listener).not.toHaveBeenCalled()
	})

	it('checks expectedRevision before evaluating a patch', () => {
		const { system } = createFixture()
		const document = createWidgetDocument({ system, source: { type: 'panel' } })

		const result = document.applyPatch([{ op: 'remove', path: '/missing' }], { expectedRevision: 99 })

		expect(result)
			.toMatchObject({ ok: false, failure: {
				code: 'document-revision-conflict',
				expectedRevision: 99,
				actualRevision: 0,
			} })
	})

	it('rejects root removal without compiling, committing, revising, or notifying', () => {
		const { system } = createFixture()
		const createBlueprint = vi.fn(system.createBlueprint)
		const instrumentedSystem = { ...system, createBlueprint }
		const document = createWidgetDocument({ system: instrumentedSystem, source: { type: 'panel' } })
		const listener = vi.fn()
		document.subscribe(listener)
		createBlueprint.mockClear()

		const result = document.applyPatch([{ op: 'remove', path: '' }])

		expect(result)
			.toMatchObject({ ok: false, failure: { code: 'invalid-path', operationIndex: 0 } })
		expect(document.getSnapshot().revision)
			.toBe(0)
		expect(createBlueprint).not.toHaveBeenCalled()
		expect(listener).not.toHaveBeenCalled()
	})

	it('commits a semantically invalid authored result after a successful mechanical patch', () => {
		const { system } = createFixture()
		const document = createWidgetDocument({ system, source: { id: 'root', type: 'panel', value: 1 } })
		const listener = vi.fn()
		document.subscribe(listener)

		const result = document.applyPatch([{ op: 'remove', path: '/type' }])

		expect(result)
			.toEqual({ ok: true, changed: true })
		expect(document.getSnapshot().revision)
			.toBe(1)
		expect(document.getSnapshot().blueprint.status)
			.toBe('invalid')
		expect(listener)
			.toHaveBeenCalledTimes(1)
	})

	it('rejects reentrant application while notifying and keeps the committed snapshot', () => {
		const { system } = createFixture()
		const document = createWidgetDocument({ system, source: { type: 'panel' } })
		let nestedResult: unknown
		document.subscribe((snapshot) => {
			nestedResult = document.applyPatch([{ op: 'replace', path: '/type', value: 'panel' }])
			expect(snapshot.revision)
				.toBe(1)
		})

		expect(document.applyPatch([{ op: 'add', path: '/enabled', value: true }]))
			.toEqual({ ok: true, changed: true })
		expect(nestedResult)
			.toMatchObject({ ok: false, failure: { code: 'reentrant-apply' } })
		expect(document.getSnapshot().blueprint.source)
			.toEqual({ type: 'panel', enabled: true })
	})

	it('notifies only the audience captured at dispatch start', () => {
		const { system } = createFixture()
		const document = createWidgetDocument({ system, source: { type: 'panel' } })
		const late = vi.fn()
		const first = vi.fn(() => {
			document.subscribe(late)
		})
		document.subscribe(first)

		document.applyPatch([{ op: 'add', path: '/value', value: 1 }])
		document.applyPatch([{ op: 'replace', path: '/value', value: 2 }])

		expect(first)
			.toHaveBeenCalledTimes(2)
		expect(late)
			.toHaveBeenCalledTimes(1)
	})

	it('isolates subscriber exceptions and preserves the captured audience across unsubscribe', async () => {
		const { system } = createFixture()
		const document = createWidgetDocument({ system, source: { type: 'panel' } })
		const first = vi.fn()
		const second = vi.fn()
		let unsubscribeSecond: (() => void) | undefined
		let uncaught = 0
		const uncaughtHandler = () => {
			uncaught++
		}
		process.on('uncaughtException', uncaughtHandler)
		try {
			first.mockImplementationOnce(() => {
				unsubscribeSecond?.()
				throw new Error('subscriber failure')
			})
			unsubscribeSecond = document.subscribe(second)
			document.subscribe(first)

			expect(document.applyPatch([{ op: 'add', path: '/value', value: 1 }]))
				.toEqual({ ok: true, changed: true })
			expect(second)
				.toHaveBeenCalledTimes(1)

			expect(document.applyPatch([{ op: 'replace', path: '/value', value: 2 }]))
				.toEqual({ ok: true, changed: true })
			expect(first)
				.toHaveBeenCalledTimes(2)
			expect(second)
				.toHaveBeenCalledTimes(1)

			await new Promise(resolve => setTimeout(resolve, 0))
			expect(uncaught)
				.toBe(1)
		}
		finally {
			process.off('uncaughtException', uncaughtHandler)
		}
	})
})
