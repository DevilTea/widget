/**
 * Runtime Inspector member view models — the framework-agnostic passive-projection layer over
 * `@deviltea/widget-core/inspection`'s `RuntimeStateInspection`/`RuntimePropertyInspection`.
 *
 * Normative source: issue #13 (Widget Lab Phase 5) comments "Runtime Inspector becomes strictly
 * passive" and "inspectors are readonly consumers of core inspection". No Vue import on purpose (mirrors
 * `../lab/session.ts`'s plain-getter + `subscribe()` shape) — this is the regression-worthy logic,
 * independently testable without mounting anything.
 *
 * These view models call only `getSnapshot()`/`subscribe()` from the passive inspection contract —
 * never `state.get()`/`property.get()`, never a Method invocation, and never anything that could
 * activate a lazy Property. Opening/selecting/subscribing here must never perturb Runtime semantics.
 */

import type {
	InspectionObservable,
	RuntimePropertyInspectionSnapshot,
	RuntimeStateInspectionSnapshot,
} from '@deviltea/widget-core/inspection'

export interface MemberViewModel<Snapshot> {
	getSnapshot: () => Snapshot
	/** Lazily subscribes to the underlying inspection observable on first listener, unsubscribes on last. */
	subscribe: (listener: () => void) => () => void
	/** Tears down the underlying subscription (if any) and clears local listeners. Idempotent. */
	dispose: () => void
}

/**
 * Wraps one `InspectionObservable<Snapshot>` (a `RuntimeStateInspection`/`RuntimePropertyInspection`
 * facade) into a `MemberViewModel`. The wrapped observable is never queried beyond `getSnapshot()` once
 * at construction and again only from its own `subscribe()` notifications — this function has no other
 * way to observe/mutate Runtime state.
 */
function createMemberViewModel<Snapshot>(observable: InspectionObservable<Snapshot>): MemberViewModel<Snapshot> {
	let snapshot = observable.getSnapshot()
	const listeners = new Set<() => void>()
	let rawUnsubscribe: (() => void) | null = null
	let disposed = false

	function ensureSubscribed(): void {
		if (rawUnsubscribe !== null || disposed)
			return
		rawUnsubscribe = observable.subscribe((next) => {
			snapshot = next
			for (const listener of listeners) listener()
		})
	}

	function teardownIfUnused(): void {
		if (listeners.size === 0 && rawUnsubscribe !== null) {
			rawUnsubscribe()
			rawUnsubscribe = null
		}
	}

	return {
		getSnapshot: () => snapshot,

		subscribe: (listener) => {
			if (disposed)
				return () => {}
			ensureSubscribed()
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
				teardownIfUnused()
			}
		},

		dispose: () => {
			disposed = true
			listeners.clear()
			rawUnsubscribe?.()
			rawUnsubscribe = null
		},
	}
}

export type StateMemberViewModel = MemberViewModel<RuntimeStateInspectionSnapshot<unknown>>
export type PropertyMemberViewModel = MemberViewModel<RuntimePropertyInspectionSnapshot<unknown>>

export function createStateMemberViewModel(
	inspection: InspectionObservable<RuntimeStateInspectionSnapshot<unknown>>,
): StateMemberViewModel {
	return createMemberViewModel(inspection)
}

export function createPropertyMemberViewModel(
	inspection: InspectionObservable<RuntimePropertyInspectionSnapshot<unknown>>,
): PropertyMemberViewModel {
	return createMemberViewModel(inspection)
}
