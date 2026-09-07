import type { InspectorClient, InspectorMemberRef, InspectorRuntimeMemberSnapshot, WidgetRef } from '@deviltea/widget-devtools'
import type { Ref } from 'vue'
import { shallowRef, watch } from 'vue'

/**
 * Vue bridge for one remote Runtime member. Subscription ownership stays tied to the selected row;
 * changing Runtime/node/member unsubscribes the old remote subscription before observing the new one.
 */
export function useRemoteRuntimeMember(
	clientGetter: () => InspectorClient | null,
	refGetter: () => WidgetRef | null,
	memberGetter: () => InspectorMemberRef,
	initialGetter: () => InspectorRuntimeMemberSnapshot | null,
): Readonly<Ref<InspectorRuntimeMemberSnapshot | null>> {
	const snapshot = shallowRef<InspectorRuntimeMemberSnapshot | null>(initialGetter())

	watch(
		() => {
			const client = clientGetter()
			const ref = refGetter()
			const member = memberGetter()
			return [client, ref?.runtimeId ?? null, ref?.nodeId ?? null, member.type, member.name] as const
		},
		([client, runtimeId, nodeId, type, name], _previous, onCleanup) => {
			snapshot.value = initialGetter()
			if (client === null || runtimeId === null || nodeId === null)
				return

			let active = true
			let subscriptionId: string | null = null
			const ref: WidgetRef = { runtimeId, nodeId }
			const member: InspectorMemberRef = { type, name }
			const stopEvents = client.on('runtime.memberChanged', (event) => {
				if (active && event.subscriptionId === subscriptionId)
					snapshot.value = event.member
			})

			onCleanup(() => {
				active = false
				stopEvents()
				if (subscriptionId !== null) {
					void client.request('runtime.unsubscribeMember', { subscriptionId })
						.catch(() => {})
				}
			})

			void client.request('runtime.subscribeMember', { ref, member })
				.then((result) => {
					if (!active) {
						void client.request('runtime.unsubscribeMember', { subscriptionId: result.subscriptionId })
							.catch(() => {})
						return
					}
					subscriptionId = result.subscriptionId
					snapshot.value = result.member
				})
				.catch(() => {
					// A disconnect/replacement is represented by the parent connection becoming unavailable.
				})
		},
		{ immediate: true },
	)

	return snapshot
}
