import { expect, test } from './fixtures'

// This spec intentionally loads the DevTools source fixture from Vite :4174. The override is local
// to these source-fixture tests; every built-app spec remains pinned to the preview origin from
// Playwright's `baseURL` (:4173).
test.use({ expectedRequestOrigin: 'http://127.0.0.1:4174' })

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
			navigationUnrelatedRpcResponseDidNotAcknowledge: true,
			navigationAgentResponseAttempted: true,
			navigationOwnerClosedInspectorClient: true,
			navigationPendingRequestRejectedDisconnected: true,
			postNavigationOldClientRejectedDisconnected: true,
			navigationRemountAdvancedGeneration: true,
			navigationRemountInspectorRequestResolved: true,
			navigationRemountRuntimeListUsesOnlyReconnectedRuntimeId: true,
			removalRequestPendingBeforeDispose: true,
			removalAgentResponseAttempted: true,
			removalOwnerClosedInspectorClient: true,
			removalPendingRequestRejectedDisconnected: true,
		})
})

test('Preview mount readiness timeout recovers after a cross-origin redirect drops bootstrap', async ({ page }) => {
	let previewFrameRequests = 0
	await page.route('http://127.0.0.1:4174/preview-frame.html*', async (route) => {
		previewFrameRequests++
		if (previewFrameRequests !== 1) {
			await route.continue()
			return
		}
		const redirected = new URL(route.request()
			.url())
		redirected.protocol = 'http:'
		redirected.hostname = 'localhost'
		redirected.port = '4173'
		await route.fulfill({
			status: 302,
			headers: { location: redirected.href },
			body: '',
		})
	})

	await page.goto('http://127.0.0.1:4174/e2e/fixtures/devtools-transport.html')
	const moduleUrl = await page.evaluate(() => new URL('/e2e/devtools-transport.browser.ts', location.origin).href)
	const result = await page.evaluate(async (url) => {
		const browserContracts = await import(url)
		return browserContracts.runPreviewReadinessTimeoutContract()
	}, moduleUrl)

	expect(result)
		.toEqual({
			timedOut: true,
			queueRecovered: true,
			retryAdvancedGeneration: true,
			errorCleared: true,
		})
	expect(previewFrameRequests)
		.toBe(2)
})

test('native Chromium bootstraps Preview across origins and rejects a same-origin sibling sender', async ({ page }) => {
	await page.goto('http://127.0.0.1:4174/e2e/fixtures/devtools-transport.html')
	const moduleUrl = await page.evaluate(() => new URL('/e2e/devtools-transport.browser.ts', location.origin).href)
	const result = await page.evaluate(async (url) => {
		const browserContracts = await import(url)
		return browserContracts.runCrossOriginPreviewBootstrapBrowserContracts()
	}, moduleUrl)

	expect(result)
		.toEqual({
			parentAndFrameOriginsDiffer: true,
			siblingAttackerSharesParentOrigin: true,
			untrustedBootstrapDidNotReceiveHostResponse: true,
			trustedCrossOriginBootstrapMounted: true,
			trustedCrossOriginInspectorRequestResolved: true,
		})
})

test('native Chromium inspect.hitTest resolves ShadowRoot widgets and respects topmost nonsemantic overlays', async ({ page }) => {
	await page.goto('http://127.0.0.1:4174/e2e/fixtures/devtools-transport.html')
	const moduleUrl = await page.evaluate(() => new URL('/e2e/devtools-transport.browser.ts', location.origin).href)
	const result = await page.evaluate(async (url) => {
		const browserContracts = await import(url)
		return browserContracts.runDevtoolsGeometryBrowserContracts()
	}, moduleUrl)

	expect(result)
		.toEqual({
			shadowWidgetTargetWidgetId: 'counter-1',
			shadowWidgetTargetWidgetType: 'Counter',
			shadowWidgetHitVisibility: 'visible',
			overlayCoveredHitResultIsNull: true,
			documentElementsFromPointRetargetedToHost: true,
			shadowElementsFromPointTopmostIsOverlay: true,
		})
})
