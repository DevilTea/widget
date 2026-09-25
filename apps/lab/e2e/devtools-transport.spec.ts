import { expect, test } from './fixtures'

test('native Chromium propagates explicit DevTools closes and settles iframe navigation locally', async ({ page }) => {
	await page.goto('http://127.0.0.1:4174/e2e/fixtures/devtools-transport.html')
	const moduleUrl = await page.evaluate(() => new URL('/e2e/devtools-transport.browser.ts', location.origin).href)
	const result = await page.evaluate(async (url) => {
		const browserContracts = await import(url)
		return browserContracts.runDevtoolsBrowserContracts()
	}, moduleUrl)

	expect(result)
		.toEqual({
			transportExplicitClosePropagated: true,
			transportCloseEnvelopeDelivered: true,
			transportControlWasNotDeliveredAsInspectorPayload: true,
			transportPendingClientRejected: true,
			hubExplicitClosePropagated: true,
			hubCloseEnvelopeDelivered: true,
			hubPendingClientRejected: true,
			logicalChannelCloseIsolated: true,
			payloadWithHubControlTagDelivered: true,
			navigationRequestPendingBeforeLoad: true,
			navigationPendingRequestRejectedDisconnected: true,
			postNavigationOldClientRejectedDisconnected: true,
			navigationRemountAdvancedGeneration: true,
			navigationRemountInspectorRequestResolved: true,
			removalRequestPendingBeforeDispose: true,
			removalPendingRequestRejectedDisconnected: true,
		})
})
