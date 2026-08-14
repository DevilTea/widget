/**
 * Vue reactivity bridge over `../runtime-inspector/viewmodel.ts`'s framework-agnostic member view
 * models. Mirrors `use-lab-store.ts`'s role for `LabSession`: the one place that adapts a plain
 * `getSnapshot()` + `subscribe()` shape into a Vue ref, and owns disposing the previous view model
 * whenever the reactive `observableGetter()` source yields a different (or `null`) observable — e.g. a
 * different selected member, or a Runtime replaced by Apply — as well as on component unmount (issue
 * #13 Phase 5: "Unsubscribe all inspection subscriptions with component/panel scope disposal and on
 * snapshot replacement").
 */

import type { InspectionObservable } from '@deviltea/widget-core/inspection'
import type { Ref } from 'vue'
import type { MemberViewModel } from '../runtime-inspector/viewmodel'
import { onUnmounted, shallowRef, watch } from 'vue'

export function useMemberSnapshot<Snapshot>(
	createViewModel: (observable: InspectionObservable<Snapshot>) => MemberViewModel<Snapshot>,
	observableGetter: () => InspectionObservable<Snapshot> | null,
): Readonly<Ref<Snapshot | null>> {
	const snapshot = shallowRef<Snapshot | null>(null) as Ref<Snapshot | null>

	let currentViewModel: MemberViewModel<Snapshot> | null = null
	let currentUnsubscribe: (() => void) | null = null

	function teardown(): void {
		currentUnsubscribe?.()
		currentUnsubscribe = null
		currentViewModel?.dispose()
		currentViewModel = null
	}

	watch(
		observableGetter,
		(observable) => {
			teardown()
			if (observable === null) {
				snapshot.value = null
				return
			}

			const viewModel = createViewModel(observable)
			currentViewModel = viewModel
			snapshot.value = viewModel.getSnapshot()
			currentUnsubscribe = viewModel.subscribe(() => {
				snapshot.value = viewModel.getSnapshot()
			})
		},
		{ immediate: true },
	)

	onUnmounted(teardown)

	return snapshot
}
