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

/**
 * Showcase switching (issue #13 "Source Apply lifecycle" checkpoint, "Presets / showcase changes"):
 * "Switching showcases ... detaches/disposes the old Runtime, switches showcase context, loads the
 * showcase source, and then uses the same Apply pipeline." `switchShowcase()` in `use-lab-store.ts` is
 * the larger-grained analogue of Apply's own replacement ordering — this suite drives it against the
 * real `sandbox` <-> `survey` registry entries (`src/showcases/registry.ts`), never a mock.
 */
describe('createLabStore() switchShowcase()', () => {
	it('starts on the default ("sandbox") showcase', () => {
		const store = createLabStore()
		expect(store.showcaseId.value)
			.toBe('sandbox')
		expect(store.session.active.blueprint.status)
			.toBe('valid')
	})

	it('disposes the old Runtime and replaces the session/renderer/presets with the target showcase', async () => {
		const store = createLabStore()
		const oldRuntime = store.session.active.runtime!

		await store.switchShowcase('survey')

		expect(oldRuntime.isDisposed)
			.toBe(true)
		expect(store.showcaseId.value)
			.toBe('survey')
		expect(store.session.active.blueprint.status)
			.toBe('valid')
		expect(store.session.active.runtime)
			.not.toBeNull()
		expect(store.session.active.runtime)
			.not.toBe(oldRuntime)
		expect(store.previewRuntime.value)
			.toBe(store.session.active.runtime)
		expect(store.presets.value.some(preset => preset.id === 'survey-default'))
			.toBe(true)
	})

	it('loads the target showcase\'s default preset source text as the new active/draft snapshot', async () => {
		const store = createLabStore()
		await store.switchShowcase('survey')

		expect(store.draftSourceText.value)
			.toBe(store.session.active.sourceText)
		expect(store.session.active.definition)
			.toMatchObject({ type: 'TripSurvey' })
	})

	it('is a no-op when switching to the already-current showcase', async () => {
		const store = createLabStore()
		const session = store.session

		await store.switchShowcase('sandbox')

		expect(store.session)
			.toBe(session)
		expect(store.showcaseId.value)
			.toBe('sandbox')
	})

	it('is a no-op for an unknown showcase id', async () => {
		const store = createLabStore()
		const session = store.session

		await store.switchShowcase('does-not-exist')

		expect(store.session)
			.toBe(session)
		expect(store.showcaseId.value)
			.toBe('sandbox')
	})

	it('applyPreset() after switching resolves presets against the new showcase, not the old one', async () => {
		const store = createLabStore()
		await store.switchShowcase('survey')

		// "survey-not-ready" is unknown to the sandbox showcase and only resolvable once `currentShowcase`
		// has actually flipped to "survey" — a stale showcase reference would make this `applyPreset` a
		// silent no-op (`undefined`) instead.
		const outcome = await store.applyPreset('survey-not-ready')
		expect(outcome?.status)
			.toBe('applied')
		expect(store.session.active.definition)
			.toMatchObject({ type: 'TripSurvey' })
	})
})
