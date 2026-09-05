import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

async function openSurveyDependencies(page: Page) {
	await page.goto('/')
	await page.getByLabel('Switch showcase')
		.selectOption('survey')
	await page.getByRole('tab', { name: 'Dependencies' })
		.click()
}

test('Relations inspects shared Document focus and switching back to Graph preserves it without refitting', async ({ page }) => {
	await openSurveyDependencies(page)

	const viewTabs = page.getByRole('tablist', { name: 'Dependencies views' })
	const graphViewTab = viewTabs.getByRole('tab', { name: 'Graph' })
	const relationsViewTab = viewTabs.getByRole('tab', { name: 'Relations' })

	await expect(graphViewTab)
		.toHaveAttribute('aria-selected', 'true')

	// The default Document focus is the root widget. Relations deliberately treats that as
	// "no useful focus" rather than inventing a selection.
	await relationsViewTab.click()
	await expect(page.getByText('No focus selected'))
		.toBeVisible()
	await expect(page.locator('.relations-view-surface'))
		.toHaveCount(0)

	// Use the existing Graph interaction path to select a real member with both incoming and
	// outgoing dependencies.
	await graphViewTab.click()
	await page.getByRole('button', { name: 'Expand all' })
		.click()
	const budgetPerPersonPerDay = page.locator('.graph-node--member')
		.filter({ hasText: 'budgetPerPersonPerDay' })
		.first()
	await expect(budgetPerPersonPerDay)
		.toBeVisible({ timeout: 15_000 })
	await budgetPerPersonPerDay.click()

	const graphTransform = page.locator('.vue-flow__transformationpane')
	const transformBeforeRelations = await graphTransform.getAttribute('style')

	await relationsViewTab.click()
	const relations = page.locator('.dependencies-relations-view')
	await expect(relations.getByText('Focused member'))
		.toBeVisible()
	await expect(relations.getByText('budgetPerPersonPerDay', { exact: true }))
		.toBeVisible()
	await expect(relations.locator('.relations-column--incoming'))
		.toContainText('TripRecommendation')
	await expect(relations.locator('.relations-column--incoming'))
		.toContainText('result')
	await expect(relations.locator('.relations-column--outgoing'))
		.toContainText('budget')
	await expect(relations.locator('.relations-column--outgoing'))
		.toContainText('tripDays')
	await expect(relations.locator('.relations-column--outgoing'))
		.toContainText('travelerCount')
	await expect(relations.locator('.relations-column--outgoing'))
		.toContainText('reads')

	// A resolved related member is navigable through the same Document-scoped focus model.
	const incomingRelatedMember = relations.locator('.relations-column--incoming .relations-member-button')
		.filter({ hasText: 'result' })
		.first()
	await incomingRelatedMember.click()
	await expect(relations.locator('.relations-column--center'))
		.toContainText('TripRecommendation')
	await expect(relations.locator('.relations-column--center'))
		.toContainText('result')

	// Switching views is presentation-only. The Graph keeps its viewport and projects the new
	// shared focus instead of triggering a layout/refit.
	await graphViewTab.click()
	await expect(page.locator('.graph-node--focused'))
		.toContainText('result')
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
		.filter({ hasText: 'TripMetrics' })
		.first()
	await expect(clusterIdentity)
		.toBeVisible({ timeout: 15_000 })
	await clusterIdentity.focus()
	await clusterIdentity.press('Enter')
	await expect(graphMembers)
		.toHaveCount(0)

	const graphTransform = page.locator('.vue-flow__transformationpane')
	const transformBeforeMemberFocus = await graphTransform.getAttribute('style')

	await relationsViewTab.click()
	await expect(relationsPanel.getByText('Focused widget'))
		.toBeVisible()

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
	await page.getByRole('button', { name: 'Expand all' })
		.click()
	const member = page.locator('.graph-node--member')
		.filter({ hasText: 'budgetPerPersonPerDay' })
		.first()
	await expect(member)
		.toBeVisible({ timeout: 15_000 })
	await member.click()
	await viewTabs.getByRole('tab', { name: 'Relations' })
		.click()
	await expect(page.locator('.relations-view-surface'))
		.toBeVisible()

	for (const theme of ['light', 'dark'] as const) {
		await page.getByLabel('Theme')
			.selectOption(theme)
		await expect.poll(async () => page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		})))
			.toEqual({ scrollWidth: 900, clientWidth: 900 })
	}
})
