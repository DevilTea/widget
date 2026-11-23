import type { Page } from '@playwright/test'
import { expandGraphWidget, expect, openTool, setTheme, test } from './fixtures'

/** Opens the Survey's Dependencies view (Tools); most tests here are about the Graph, so it is switched to unless asked not to. */
async function openSurveyDependencies(page: Page, options: { graph?: boolean } = {}) {
	await page.goto('/')
	await openTool(page, 'dependencies')
	if (options.graph !== false) {
		await page.getByRole('tablist', { name: 'Dependencies views' })
			.getByRole('tab', { name: 'Graph' })
			.click()
	}
}

test('Relations is the default Dependencies view, with the Graph one click away', async ({ page }) => {
	await openSurveyDependencies(page, { graph: false })

	const viewTabs = page.getByRole('tablist', { name: 'Dependencies views' })
	await expect(viewTabs.getByRole('tab', { name: 'Relations' }))
		.toHaveAttribute('aria-selected', 'true')
	await expect(page.getByRole('tabpanel', { name: 'Relations' }))
		.toBeVisible()
	// The Graph canvas may already be laid out behind it (the two views are kept mounted), but it is not shown.
	await expect(page.locator('.vue-flow'))
		.toBeHidden()

	await viewTabs.getByRole('tab', { name: 'Graph' })
		.click()
	await expect(page.locator('.vue-flow'))
		.toBeVisible()
})

test('Relations inspects shared Document focus and switching back to Graph preserves it without refitting', async ({ page }) => {
	await openSurveyDependencies(page, { graph: false })

	const viewTabs = page.getByRole('tablist', { name: 'Dependencies views' })
	const graphViewTab = viewTabs.getByRole('tab', { name: 'Graph' })
	const relationsViewTab = viewTabs.getByRole('tab', { name: 'Relations' })

	await expect(relationsViewTab)
		.toHaveAttribute('aria-selected', 'true')

	// The default Document focus is the root widget. Relations deliberately treats that as
	// "no useful focus" rather than inventing a selection.
	await expect(page.getByText('No focus selected'))
		.toBeVisible()
	await expect(page.locator('.relations-view-surface'))
		.toHaveCount(0)

	// Use the existing Graph interaction path to select a real member with both incoming and
	// outgoing dependencies.
	await graphViewTab.click()
	await expandGraphWidget(page, 'phone')
	// `phone.required` reads `mode.value` and is read by the root's `response` and by its own `errors`.
	const phoneRequired = page.locator('.vue-flow__node[data-id="4:property:required"] .graph-node--member')
	await expect(phoneRequired)
		.toBeVisible({ timeout: 15_000 })
	await phoneRequired.click()

	const graphTransform = page.locator('.vue-flow__transformationpane')
	const transformBeforeRelations = await graphTransform.getAttribute('style')

	await relationsViewTab.click()
	const relations = page.locator('.dependencies-relations-view')
	await expect(relations.getByText('Focused member'))
		.toBeVisible()
	await expect(relations.getByText('required', { exact: true }))
		.toBeVisible()
	await expect(relations.locator('.relations-column--incoming'))
		.toContainText('Survey')
	await expect(relations.locator('.relations-column--incoming'))
		.toContainText('response')
	await expect(relations.locator('.relations-column--outgoing'))
		.toContainText('SingleChoice')
	await expect(relations.locator('.relations-column--outgoing'))
		.toContainText('value')
	await expect(relations.locator('.relations-column--outgoing'))
		.toContainText('reads')

	// A resolved related member is navigable through the same Document-scoped focus model.
	const incomingRelatedMember = relations.locator('.relations-column--incoming .relations-member-button')
		.filter({ hasText: 'response' })
		.first()
	await incomingRelatedMember.click()
	await expect(relations.locator('.relations-column--center'))
		.toContainText('Survey')
	await expect(relations.locator('.relations-column--center'))
		.toContainText('response')

	// Switching views is presentation-only. The Graph keeps its viewport and projects the new
	// shared focus instead of triggering a layout/refit. Only #phone is expanded (one widget at a time,
	// issue #254), so the Survey's `response` is not drawn and its collapsed #open-day card shows the focus.
	await graphViewTab.click()
	await expect(page.locator('.graph-node--focused'))
		.toHaveCount(1)
	await expect(page.locator('.graph-node--focused'))
		.toContainText('#open-day')
	await expect(graphTransform)
		.toHaveAttribute('style', transformBeforeRelations ?? '')
})

test('Dependencies view tabs are keyboard-operable and member focus does not mutate collapsed Graph layout', async ({ page }) => {
	await openSurveyDependencies(page)

	const viewTabs = page.getByRole('tablist', { name: 'Dependencies views' })
	const graphViewTab = viewTabs.getByRole('tab', { name: 'Graph' })
	const relationsViewTab = viewTabs.getByRole('tab', { name: 'Relations' })
	const graphPanel = page.getByRole('tabpanel', { name: 'Graph' })
	const relationsPanel = page.getByRole('tabpanel', { name: 'Relations' })

	await expect(graphViewTab)
		.toHaveAttribute('aria-controls', 'dependencies-view-panel-graph')
	await expect(graphViewTab)
		.toHaveAttribute('tabindex', '0')
	await expect(relationsViewTab)
		.toHaveAttribute('aria-controls', 'dependencies-view-panel-relations')
	await expect(relationsViewTab)
		.toHaveAttribute('tabindex', '-1')
	await expect(graphPanel)
		.toBeVisible()

	await graphViewTab.focus()
	await graphViewTab.press('ArrowLeft')
	await expect(relationsViewTab)
		.toBeFocused()
	await expect(relationsViewTab)
		.toHaveAttribute('aria-selected', 'true')
	await expect(relationsPanel)
		.toBeVisible()

	await relationsViewTab.press('ArrowRight')
	await expect(graphViewTab)
		.toBeFocused()
	await expect(graphViewTab)
		.toHaveAttribute('aria-selected', 'true')
	await expect(graphPanel)
		.toBeVisible()

	const graphMembers = page.locator('.graph-node--member')
	await expect(graphMembers)
		.toHaveCount(0)

	// A collapsed cluster has a keyboard-operable identity separate from the expand toggle.
	// Selecting the identity focuses the widget but must leave progressive-disclosure state intact.
	const clusterIdentity = page.locator('.graph-cluster-identity--collapsed')
		.filter({ hasText: 'Numeric' })
		.first()
	await expect(clusterIdentity)
		.toBeVisible({ timeout: 15_000 })
	// Pin both semantic identity parts on the rendered cluster label. A generic text/visibility check
	// can pass while the widget id is omitted or replaced by a cluster implementation id (#27 guard).
	await expect(clusterIdentity)
		.toHaveAttribute('aria-label', 'Numeric #guests')
	await expect(clusterIdentity.locator('.graph-cluster-type'))
		.toHaveText('Numeric')
	await expect(clusterIdentity.locator('.graph-cluster-id'))
		.toHaveText('#guests')
	await clusterIdentity.focus()
	await clusterIdentity.press('Enter')
	await expect(graphMembers)
		.toHaveCount(0)

	const graphTransform = page.locator('.vue-flow__transformationpane')
	const transformBeforeMemberFocus = await graphTransform.getAttribute('style')

	await relationsViewTab.click()
	await expect(relationsPanel.getByText('Focused widget'))
		.toBeVisible()
	const focusedWidget = relationsPanel.locator('.relations-column--center .relations-focus-card')
	await expect(focusedWidget.getByText('Numeric', { exact: true }))
		.toBeVisible()
	await expect(focusedWidget)
		.toContainText('#guests')

	const memberChoice = relationsPanel.getByTitle(/^Focus (state|property|method) /)
		.first()
	await expect(memberChoice)
		.toBeVisible()
	await memberChoice.click()
	await expect(relationsPanel.getByText('Focused member'))
		.toBeVisible()

	// Focus is semantic inspector state only. It must not auto-expand a Graph cluster, request a
	// fresh ELK layout, or destroy the preserved Graph viewport while the Graph view is hidden.
	await page.waitForTimeout(500)
	await expect(graphMembers)
		.toHaveCount(0)
	await expect(graphTransform)
		.toHaveAttribute('style', transformBeforeMemberFocus ?? '')

	await graphViewTab.click()
	await expect(graphMembers)
		.toHaveCount(0)
	await expect(graphTransform)
		.toHaveAttribute('style', transformBeforeMemberFocus ?? '')
})

test('Relations keeps page-level width contained at the 900px minimum in light and dark themes', async ({ page }) => {
	await page.setViewportSize({ width: 900, height: 900 })
	await openSurveyDependencies(page)

	const viewTabs = page.getByRole('tablist', { name: 'Dependencies views' })
	await expandGraphWidget(page, 'phone')
	const member = page.locator('.vue-flow__node[data-id="4:property:required"] .graph-node--member')
	await expect(member)
		.toBeVisible({ timeout: 15_000 })
	await member.click()
	await viewTabs.getByRole('tab', { name: 'Relations' })
		.click()
	await expect(page.locator('.relations-view-surface'))
		.toBeVisible()

	for (const theme of ['light', 'dark'] as const) {
		await setTheme(page, theme)
		await expect.poll(async () => page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		})))
			.toEqual({ scrollWidth: 900, clientWidth: 900 })
	}
})
