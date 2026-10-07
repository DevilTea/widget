// @vitest-environment happy-dom

import type { InspectorMemberRef, InspectorRequestMessage, InspectorRuntimeMemberSnapshot, WidgetRef } from '@deviltea/widget-inspector/protocol'
import { createInspectorClient } from '@deviltea/widget-inspector/client'
import { INSPECTOR_PROTOCOL_VERSION, parseInspectorRequestMessage } from '@deviltea/widget-inspector/protocol'
import { createInProcessInspectorTransportPair } from '@deviltea/widget-inspector/transport'
import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useRemoteRuntimeMember } from './use-remote-runtime-member'

function respond(pair: ReturnType<typeof createInProcessInspectorTransportPair>, request: InspectorRequestMessage, result: unknown): void {
	pair.agent.send({
		protocol: INSPECTOR_PROTOCOL_VERSION,
		kind: 'response',
		requestId: request.requestId,
		ok: true,
		result,
	})
}

describe('useRemoteRuntimeMember()', () => {
	it('ignores queued member changes from the previous Runtime subscription', async () => {
		const pair = createInProcessInspectorTransportPair()
		const client = createInspectorClient(pair.client)
		const requests: InspectorRequestMessage[] = []
		pair.agent.subscribe((message) => {
			const request = parseInspectorRequestMessage(message)
			if (request === null)
				return

			requests.push(request)
			if (request.method === 'runtime.unsubscribeMember')
				respond(pair, request, { removed: true })
		})

		const oldRef: WidgetRef = { runtimeId: 'runtime-r0', nodeId: 3 }
		const newRef: WidgetRef = { runtimeId: 'runtime-r1', nodeId: 8 }
		const member: InspectorMemberRef = { type: 'state', name: 'count' }
		const oldInitial: InspectorRuntimeMemberSnapshot = { type: 'state', name: 'count', value: { type: 'number', value: 3 } }
		const newInitial: InspectorRuntimeMemberSnapshot = { type: 'state', name: 'count', value: { type: 'number', value: 8 } }
		const currentChange: InspectorRuntimeMemberSnapshot = { type: 'state', name: 'count', value: { type: 'number', value: 80 } }
		const staleChange: InspectorRuntimeMemberSnapshot = { type: 'state', name: 'count', value: { type: 'number', value: 999 } }
		const selectedRef = ref<WidgetRef | null>(oldRef)
		const scope = effectScope()
		const snapshot = scope.run(() => useRemoteRuntimeMember(
			() => client,
			() => selectedRef.value,
			() => member,
			() => selectedRef.value?.runtimeId === oldRef.runtimeId ? oldInitial : newInitial,
		))!

		function sendMemberChange(subscriptionId: string, ref: WidgetRef, change: InspectorRuntimeMemberSnapshot): void {
			pair.agent.send({
				protocol: INSPECTOR_PROTOCOL_VERSION,
				kind: 'event',
				event: 'runtime.memberChanged',
				payload: { subscriptionId, ref, member: change },
			})
		}

		try {
			const subscribeRequests = () => requests.filter(request => request.method === 'runtime.subscribeMember')
			expect(subscribeRequests())
				.toHaveLength(1)
			const oldSubscribe = subscribeRequests()[0]!
			expect(oldSubscribe)
				.toMatchObject({ method: 'runtime.subscribeMember', params: { ref: oldRef, member } })
			const oldSubscriptionId = 'subscription-r0'
			respond(pair, oldSubscribe, { subscriptionId: oldSubscriptionId, member: oldInitial })
			await Promise.resolve()
			expect(snapshot.value)
				.toEqual(oldInitial)

			selectedRef.value = newRef
			await nextTick()
			expect(subscribeRequests())
				.toHaveLength(2)
			const newSubscribe = subscribeRequests()[1]!
			expect(newSubscribe)
				.toMatchObject({ method: 'runtime.subscribeMember', params: { ref: newRef, member } })
			const newSubscriptionId = 'subscription-r1'
			expect(oldSubscriptionId).not.toBe(newSubscriptionId)
			respond(pair, newSubscribe, { subscriptionId: newSubscriptionId, member: newInitial })
			await Promise.resolve()
			expect(snapshot.value)
				.toEqual(newInitial)

			sendMemberChange(newSubscriptionId, newRef, currentChange)
			expect(snapshot.value)
				.toEqual(currentChange)

			sendMemberChange(oldSubscriptionId, oldRef, staleChange)
			expect(snapshot.value)
				.toEqual(currentChange)
		}
		finally {
			scope.stop()
			client.close()
		}
	})

	it('ignores a late subscription response after watcher cleanup and unsubscribes its remote ID', async () => {
		const pair = createInProcessInspectorTransportPair()
		const client = createInspectorClient(pair.client)
		const requests: InspectorRequestMessage[] = []
		pair.agent.subscribe((message) => {
			const request = parseInspectorRequestMessage(message)
			if (request === null)
				return

			requests.push(request)
			if (request.method === 'runtime.unsubscribeMember')
				respond(pair, request, { removed: true })
		})

		const oldRef: WidgetRef = { runtimeId: 'runtime-r0', nodeId: 3 }
		const newRef: WidgetRef = { runtimeId: 'runtime-r1', nodeId: 8 }
		const member: InspectorMemberRef = { type: 'state', name: 'count' }
		const oldInitial: InspectorRuntimeMemberSnapshot = { type: 'state', name: 'count', value: { type: 'number', value: 3 } }
		const newInitial: InspectorRuntimeMemberSnapshot = { type: 'state', name: 'count', value: { type: 'number', value: 8 } }
		const newRemoteSnapshot: InspectorRuntimeMemberSnapshot = { type: 'state', name: 'count', value: { type: 'number', value: 80 } }
		const selectedRef = ref<WidgetRef | null>(oldRef)
		const scope = effectScope()
		const snapshot = scope.run(() => useRemoteRuntimeMember(
			() => client,
			() => selectedRef.value,
			() => member,
			() => selectedRef.value?.runtimeId === oldRef.runtimeId ? oldInitial : newInitial,
		))!

		try {
			expect(requests)
				.toHaveLength(1)
			selectedRef.value = newRef
			await nextTick()
			expect(requests)
				.toHaveLength(2)

			const oldSubscribe = requests[0]!
			const newSubscribe = requests[1]!
			expect(oldSubscribe)
				.toMatchObject({ method: 'runtime.subscribeMember', params: { ref: oldRef, member } })
			expect(newSubscribe)
				.toMatchObject({ method: 'runtime.subscribeMember', params: { ref: newRef, member } })

			respond(pair, newSubscribe, { subscriptionId: 'subscription-r1', member: newRemoteSnapshot })
			await Promise.resolve()
			expect(snapshot.value)
				.toEqual(newRemoteSnapshot)

			respond(pair, oldSubscribe, { subscriptionId: 'subscription-r0-late', member: oldInitial })
			await Promise.resolve()

			expect.soft(snapshot.value)
				.toEqual(newRemoteSnapshot)
			expect.soft(requests)
				.toEqual([
					{
						protocol: INSPECTOR_PROTOCOL_VERSION,
						kind: 'request',
						requestId: 'request-1',
						method: 'runtime.subscribeMember',
						params: { ref: oldRef, member },
					},
					{
						protocol: INSPECTOR_PROTOCOL_VERSION,
						kind: 'request',
						requestId: 'request-2',
						method: 'runtime.subscribeMember',
						params: { ref: newRef, member },
					},
					{
						protocol: INSPECTOR_PROTOCOL_VERSION,
						kind: 'request',
						requestId: 'request-3',
						method: 'runtime.unsubscribeMember',
						params: { subscriptionId: 'subscription-r0-late' },
					},
				])

			// The new subscription is already established. Disposing the scope must
			// release its live remote ID, separately from the late-response path.
			scope.stop()
			await Promise.resolve()
			expect(requests)
				.toHaveLength(4)
			expect(requests[3])
				.toMatchObject({
					method: 'runtime.unsubscribeMember',
					params: { subscriptionId: 'subscription-r1' },
				})
		}
		finally {
			scope.stop()
			client.close()
		}
	})
})
