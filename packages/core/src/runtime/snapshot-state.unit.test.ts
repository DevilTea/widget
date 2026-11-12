/**
 * Conformance coverage for `WidgetSystemRuntime.snapshotState()`: the current value of every State
 * member in exactly the shape `overrideStateDefaults` accepts, so a host can carry State over to a new
 * Runtime (for example after a structural edit produced a new Blueprint) without Core migrating it.
 */

import type { WidgetId } from '../index'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'

interface FormInterfaces {
	slots: 'children'
	state: {
		label: string
		count: number
		payload: { readonly items: readonly number[] }
		/** Never defaulted: stays `null` until written. */
		draft: string
	}
}

interface NoteInterfaces {
	properties: {
		text: string
	}
}

const form = createWidgetPlugin('form')
	.description('Test widget')
	.interfaces<FormInterfaces>()
	.slots({ children: { description: 'Children' } })
	.state(state => state
		.label({ validate: (input): input is string => typeof input === 'string', default: () => 'initial' })
		.count({ validate: (input): input is number => typeof input === 'number', default: () => 0 })
		.payload({
			validate: (input): input is { readonly items: readonly number[] } => typeof input === 'object' && input !== null,
			default: () => ({ items: [1] }),
		})
		.draft({ validate: (input): input is string => typeof input === 'string' }))
	.done()

const note = createWidgetPlugin('note')
	.description('Test widget')
	.interfaces<NoteInterfaces>()
	.properties(properties => properties.text({ compute: () => 'note' }))
	.done()

const system = createWidgetSystem({ plugins: [form, note] })
const compiled = system.createBlueprint({
	id: 'root',
	type: 'form',
	slots: {
		children: [
			{ id: '__proto__', type: 'form' },
			{ id: 'empty', type: 'form' },
			{ id: 'note', type: 'note' },
		],
	},
})
if (compiled.status !== 'valid')
	throw new Error('fixture setup error: expected a valid Blueprint')
const blueprint = compiled

function formWidget(runtime: ReturnType<typeof blueprint.createRuntime>, id: string) {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== 'form')
		throw new Error('expected a form widget')
	return widget
}

function mutate(runtime: ReturnType<typeof blueprint.createRuntime>) {
	const root = formWidget(runtime, 'root')
	root.state.label.set('edited')
	root.state.count.set(3)
	root.state.draft.set('typed')
	formWidget(runtime, '__proto__').state.count.set(9)
}

describe('snapshotState', () => {
	it('returns every non-null State value keyed by widget id and member key', () => {
		const runtime = blueprint.createRuntime()
		mutate(runtime)
		const root = formWidget(runtime, 'root')

		const snapshot = runtime.snapshotState()

		expectTypeOf(snapshot)
			.toEqualTypeOf<Record<WidgetId, Record<string, unknown>>>()
		expect(Object.keys(snapshot))
			.toEqual(['root', '__proto__', 'empty'])
		expect(snapshot.root)
			.toEqual({ label: 'edited', count: 3, payload: { items: [1] }, draft: 'typed' })
		// `draft` was never written on these widgets: a `null` member is omitted.
		const protoEntry = Object.getOwnPropertyDescriptor(snapshot, '__proto__')?.value as Record<string, unknown>
		expect(Object.keys(protoEntry))
			.toEqual(['label', 'count', 'payload'])
		expect(protoEntry.count)
			.toBe(9)
		expect(snapshot.empty)
			.toEqual({ label: 'initial', count: 0, payload: { items: [1] } })
		// Values are passed by reference, not cloned.
		expect(snapshot.root!.payload)
			.toBe(root.state.payload.get())
	})

	it('omits widgets with no non-null State value and widgets without the state capability', () => {
		// Rejected overrides leave those members `null` (an invalid override does not fall back).
		const runtime = blueprint.createRuntime({ overrideStateDefaults: { empty: { label: null, count: null, payload: null } } })

		const snapshot = runtime.snapshotState()

		expect(Object.hasOwn(snapshot, 'empty'))
			.toBe(false)
		expect(Object.hasOwn(snapshot, 'note'))
			.toBe(false)
	})

	it('returns a fresh object owned by the caller', () => {
		const runtime = blueprint.createRuntime()
		const first = runtime.snapshotState()
		first.root!.count = 100
		delete first.empty

		const second = runtime.snapshotState()

		expect(second).not.toBe(first)
		expect(second.root).not.toBe(first.root)
		expect(second.root!.count)
			.toBe(0)
		expect(formWidget(runtime, 'root').state.count.get())
			.toBe(0)
		expect(Object.hasOwn(second, 'empty'))
			.toBe(true)
	})

	it('round-trips through overrideStateDefaults with no Runtime-level diagnostics', () => {
		const old = blueprint.createRuntime()
		mutate(old)

		const next = blueprint.createRuntime({ overrideStateDefaults: old.snapshotState() })

		expect(next.getDiagnostics())
			.toEqual([])
		for (const id of ['root', '__proto__', 'empty']) {
			const before = formWidget(old, id)
			const after = formWidget(next, id)
			for (const key of ['label', 'count', 'payload', 'draft'] as const) {
				expect(after.state[key].get())
					.toBe(before.state[key].get())
			}
		}
	})

	it('throws WidgetSystemRuntimeDisposedError after dispose', () => {
		const runtime = blueprint.createRuntime()
		runtime.dispose()

		expect(() => runtime.snapshotState())
			.toThrow(WidgetSystemRuntimeDisposedError)
	})
})
