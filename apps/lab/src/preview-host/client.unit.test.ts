import { createInProcessInspectorTransportPair } from '@deviltea/widget-devtools'
import { describe, expect, it } from 'vitest'
import { createPreviewHostClient, PreviewHostClientError } from './client'
import { parsePreviewHostRequest, PREVIEW_HOST_PROTOCOL_VERSION } from './protocol'

describe('preview host client', () => {
	it('correlates mount and tutorial evaluation responses out of order', async () => {
		const pair = createInProcessInspectorTransportPair()
		const client = createPreviewHostClient(pair.client)
		const requests: ReturnType<typeof parsePreviewHostRequest>[] = []
		pair.agent.subscribe((raw) => {
			const request = parsePreviewHostRequest(raw)
			if (request !== null)
				requests.push(request)
		})
		try {
			const mount = client.mount('session-a', 2, { showcaseId: 'survey', revision: 1, sourceText: '{}' })
			const evaluate = client.evaluateTutorial('survey', 1, 0)
			expect(requests)
				.toHaveLength(2)
			const mountRequest = requests.find(request => request?.kind === 'mount')!
			const evaluateRequest = requests.find(request => request?.kind === 'tutorial.evaluate')!
			pair.agent.send({
				protocol: PREVIEW_HOST_PROTOCOL_VERSION,
				kind: 'tutorial.evaluated',
				requestId: evaluateRequest!.requestId,
				tourId: 'survey',
				stepIndex: 1,
				progress: 1,
			})
			pair.agent.send({
				protocol: PREVIEW_HOST_PROTOCOL_VERSION,
				kind: 'mounted',
				requestId: mountRequest!.requestId,
				generation: 2,
				revision: 1,
				runtimeId: 'runtime-a',
			})
			await expect(evaluate).resolves.toMatchObject({ progress: 1 })
			await expect(mount).resolves.toMatchObject({ runtimeId: 'runtime-a' })
		}
		finally {
			client.close()
			pair.agent.close()
		}
	})

	it('forwards observation events and rejects pending requests on disconnect', async () => {
		const pair = createInProcessInspectorTransportPair()
		const client = createPreviewHostClient(pair.client)
		let observations = 0
		client.onEvent(() => observations++)
		pair.agent.send({ protocol: 1, kind: 'tutorial.observation-changed', tourId: 'crm' })
		expect(observations)
			.toBe(1)

		const pending = client.mount('session-a', 1, { showcaseId: 'crm', revision: 0, sourceText: '{}' })
		pair.agent.close()
		await expect(pending).rejects.toBeInstanceOf(PreviewHostClientError)
	})
})
