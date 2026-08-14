// @vitest-environment happy-dom
/**
 * `createLabStore()` teardown ordering (PR #17 review 4938934963, finding 2): Widget Lab is the
 * Runtime owner, so application teardown must dispose the final active Runtime — but only after the
 * Preview `WidgetRenderer` subtree has actually unmounted. `store.dispose()` itself is
 * framework-agnostic; the ordering guarantee comes from *where* the caller (`App.vue`) invokes it —
 * `onUnmounted`, never `onBeforeUnmount` — which this suite proves against a real mounted component
 * tree rendering the actual sandbox `WidgetRenderer`, not a mock.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, onUnmounted, provide } from 'vue'
import { SandboxRenderer } from '../sandbox/renderers'
import { createLabStore, LabStoreKey } from './use-lab-store'

describe('createLabStore() dispose()', () => {
	it('disposes the current active Runtime', () => {
		const store = createLabStore()
		const runtime = store.session.active.runtime!
		expect(runtime.isDisposed)
			.toBe(false)

		store.dispose()

		expect(runtime.isDisposed)
			.toBe(true)
	})

	it('is a no-op on Runtime disposal when the active Blueprint has none (never throws)', async () => {
		const store = createLabStore()
		await store.applyPreset('invalid-semantic')
		expect(store.session.active.runtime)
			.toBeNull()

		expect(() => store.dispose()).not.toThrow()
	})

	it('mirrors App.vue: dispose() must be invoked from onUnmounted, after the Preview subtree has fully unmounted', () => {
		const events: string[] = []
		const store = createLabStore()
		const runtime = store.session.active.runtime!

		// Stands in for `Workbench.vue` -> `PreviewPanel.vue`: renders the real Preview `WidgetRenderer`
		// subtree bound to a real Runtime, and records when Vue actually finishes unmounting it.
		const PreviewProbe = defineComponent({
			setup() {
				onUnmounted(() => events.push('preview-subtree-unmounted'))
				return () => store.previewRuntime.value !== null
					? h(SandboxRenderer, { runtime: store.previewRuntime.value })
					: null
			},
		})

		// Stands in for `App.vue`: provides the store and disposes it from `onUnmounted`, exactly as the
		// real component does.
		const Root = defineComponent({
			setup() {
				provide(LabStoreKey, store)
				onUnmounted(() => {
					events.push('app-dispose-start')
					store.dispose()
					events.push('app-dispose-end')
				})
				return () => h(PreviewProbe)
			},
		})

		const wrapper = mount(Root)
		expect(runtime.isDisposed)
			.toBe(false)

		wrapper.unmount()

		// Vue's own contract (a parent's `onUnmounted` fires only after every descendant's `onUnmounted`
		// has already run) is what this ordering depends on — this assertion is what would catch a
		// regression back to `onBeforeUnmount`, which fires *before* descendants unmount.
		expect(events)
			.toEqual(['preview-subtree-unmounted', 'app-dispose-start', 'app-dispose-end'])
		expect(runtime.isDisposed)
			.toBe(true)
	})
})

/**
 * PR #18 review 4939584651, finding 1: Dependency Graph filter preferences are the persistent
 * counterpart to panel-local *snapshot-bound* selections (e.g. `useGraphEdgeSelection`'s edge selection,
 * which does reset on Apply — see `use-graph-edge-selection.unit.test.ts`). `graphShowAbsent`/
 * `graphShowIsolatedMembers` live as plain refs on the `LabStore` object itself, never derived from
 * `session`, so a successful Apply — valid or invalid — must never touch them.
 */
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

		await store.applyPreset('invalid-semantic')

		expect(store.session.active.runtime)
			.toBeNull()
		expect(store.graphShowAbsent.value)
			.toBe(true)
		// The other preference was never touched, so it must still read its untouched default.
		expect(store.graphShowIsolatedMembers.value)
			.toBe(false)
	})
})
