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

	// PR #19 review 4940219714, finding 2: showcase replacement must cross `LabSession.apply()`'s
	// authoritative boundary rather than only relying on the replacement `LabSession`'s own
	// constructor-seeded Runtime as final state — constructor seeding is the initial-boot exception,
	// never a stand-in for `apply()`. The observable, black-box discriminator between the two is
	// `isApplying`: only `LabSession.apply()` ever toggles it true→false; constructor seeding never
	// touches it at all. Sampling across microtask boundaries for the whole switch (rather than only
	// checking the final settled state) is what actually distinguishes "loaded through the Apply
	// pipeline" from "only synchronously bootstrapped".
	it('switchShowcase() loads the target showcase source through the authoritative Apply pipeline (isApplying trace, not just final state)', async () => {
		const store = createLabStore()
		const oldRuntime = store.session.active.runtime!

		const isApplyingSamples: boolean[] = []
		// Plain object rather than a bare `let` so the loop's exit condition is visibly mutated across
		// the closure boundary (`sampler.running = false` below) rather than looking to a linter like a
		// permanently-true condition.
		const sampler = { running: true }
		async function sample(): Promise<void> {
			while (sampler.running) {
				isApplyingSamples.push(store.isApplying.value)
				await Promise.resolve()
			}
		}
		const samplingDone = sample()

		await store.switchShowcase('survey')
		sampler.running = false
		await samplingDone

		expect(oldRuntime.isDisposed)
			.toBe(true)
		// The switch must have actually observed `isApplying === true` at some point — proof its "load
		// the showcase source" step really called `session.apply()` and not only the constructor.
		expect(isApplyingSamples.some(sample => sample))
			.toBe(true)
		expect(store.isApplying.value)
			.toBe(false)
		expect(store.session.active.runtime)
			.not.toBeNull()
	})
})

/**
 * PR #19 review 4940219714, finding 1: showcase replacement must be one serialized lifecycle
 * transaction, mutually exclusive with an in-flight Apply and with itself — deliberately overlapping
 * calls (never awaited individually before firing the next one) rather than only sequential switching.
 */
describe('createLabStore() lifecycle transaction serialization', () => {
	it('an in-flight apply() never leaves an orphaned, never-mounted, never-disposed replacement Runtime behind a concurrent switchShowcase()', async () => {
		const store = createLabStore()
		// Captured by reference, independent of `store.session`'s own getter: this is exactly the
		// object identity `LabSession.apply()`'s in-flight call closes over as `this`. Under the bug,
		// `switchShowcase()` reassigns the store's *outer* `session` variable while that in-flight
		// `apply()` is still awaiting its own `detachPreview()`/`mountPreview()` hooks — hooks which
		// read that same outer variable rather than `this` — so the in-flight call's own replacement
		// Runtime gets orphaned on `preSwitchSession` (never mounted into Preview, and never disposed,
		// because nothing ever calls back into this exact object to tear it down again).
		const preSwitchSession = store.session
		const initialRuntime = preSwitchSession.active.runtime!

		const applyPromise = store.apply()
		const switchPromise = store.switchShowcase('survey')
		await Promise.all([applyPromise, switchPromise])

		const replacement = preSwitchSession.active.runtime
		if (replacement !== null && replacement !== initialRuntime) {
			expect(replacement.isDisposed)
				.toBe(true)
		}
		expect(initialRuntime.isDisposed)
			.toBe(true)
	})

	it('serializes an in-flight apply() against a concurrent switchShowcase() with no leaked/mismatched Runtime', async () => {
		const store = createLabStore()

		// Samples the exact invariant the described race breaks: whenever a Runtime is active,
		// `previewRuntime` must point at that *same* Runtime (never null-while-active, never a stale or
		// already-disposed one) — sampled continuously across microtask boundaries throughout the
		// overlap, not just once at the end.
		const violations: string[] = []
		const sampler = { running: true }
		async function sample(): Promise<void> {
			while (sampler.running) {
				const runtime = store.session.active.runtime
				const preview = store.previewRuntime.value
				if (runtime !== null && !runtime.isDisposed && preview !== null && preview !== runtime)
					violations.push(`previewRuntime pointed at a different, non-disposed Runtime than session.active.runtime (showcase=${store.showcaseId.value})`)
				if (preview !== null && preview.isDisposed)
					violations.push('previewRuntime pointed at an already-disposed Runtime')
				await Promise.resolve()
			}
		}
		const samplingDone = sample()

		// Fired back to back, neither awaited first: `apply()` starts its own detach/compile/mount
		// sequence, and `switchShowcase()` is issued while that is still (at minimum) queued behind it.
		const applyPromise = store.apply()
		const switchPromise = store.switchShowcase('survey')
		await Promise.all([applyPromise, switchPromise])

		sampler.running = false
		await samplingDone

		expect(violations)
			.toEqual([])
		expect(store.showcaseId.value)
			.toBe('survey')
		expect(store.session.active.blueprint.status)
			.toBe('valid')
		expect(store.session.active.runtime)
			.not.toBeNull()
		expect(store.session.active.runtime!.isDisposed)
			.toBe(false)
		expect(store.previewRuntime.value)
			.toBe(store.session.active.runtime)
	})

	it('serializes repeated switchShowcase() calls fired without awaiting between them', async () => {
		const store = createLabStore()

		const survey = store.switchShowcase('survey')
		const sandbox = store.switchShowcase('sandbox')
		const surveyAgain = store.switchShowcase('survey')
		await Promise.all([survey, sandbox, surveyAgain])

		// The last queued call wins, and the end state is fully consistent — never a runtime left over
		// from an intermediate switch.
		expect(store.showcaseId.value)
			.toBe('survey')
		expect(store.session.active.blueprint.status)
			.toBe('valid')
		expect(store.session.active.runtime)
			.not.toBeNull()
		expect(store.session.active.runtime!.isDisposed)
			.toBe(false)
		expect(store.previewRuntime.value)
			.toBe(store.session.active.runtime)
	})

	it('serializes switchShowcase() against a concurrent applyPreset() on the pre-switch showcase', async () => {
		const store = createLabStore()

		const applyPresetPromise = store.applyPreset('invalid-semantic')
		const switchPromise = store.switchShowcase('survey')
		const [applyPresetOutcome] = await Promise.all([applyPresetPromise, switchPromise])

		// The preset applied to the *sandbox* session before the switch tore it down — it must not
		// leak into or affect the survey showcase now active.
		expect(applyPresetOutcome?.status)
			.toBe('applied')
		expect(store.showcaseId.value)
			.toBe('survey')
		expect(store.session.active.blueprint.status)
			.toBe('valid')
		expect(store.previewRuntime.value)
			.toBe(store.session.active.runtime)
	})

	// PR #19 review 4940219714, finding 1's "final disposal has guard" ask: `dispose()` stays
	// synchronous (App.vue's `onUnmounted` never awaits it), so a `switchShowcase()` already mid-flight
	// when `dispose()` runs cannot be cancelled — it resumes afterward and may still create a Runtime.
	// That Runtime must be disposed immediately rather than mounted into a Preview nobody owns anymore.
	it('dispose() while a switchShowcase() is mid-flight disposes whatever Runtime that switch eventually produces, without throwing', async () => {
		const store = createLabStore()
		const switchPromise = store.switchShowcase('survey')
		// Let the queued transaction actually start (past its first internal await) before tearing down,
		// so this exercises the mid-flight guard rather than the early `if (disposed) return` no-op.
		await Promise.resolve()
		await Promise.resolve()

		expect(() => store.dispose()).not.toThrow()

		await switchPromise

		const runtime = store.session.active.runtime
		expect(runtime === null || runtime.isDisposed)
			.toBe(true)
		expect(store.previewRuntime.value)
			.toBeNull()
	})
})
