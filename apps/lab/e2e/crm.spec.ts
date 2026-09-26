import type { FrameLocator, Locator, Page } from '@playwright/test'
import { expect, previewFrame, test } from './fixtures'

/**
 * Issue #28 Sales Pipeline CRM contract, against the default preset (`crm-default` —
 * `showcases/crm/presets.ts`, `showcases/crm/domain.ts`'s eight-deal seed set).
 */

/**
 * `BarChartRenderer.vue`'s "Deals by stage" — each row renders as two separate rendered lines
 * (a capitalized stage label, then its count), so `innerText()` (layout-aware, unlike `textContent`)
 * parses cleanly into a label -> count map.
 */
async function stageChartCounts(preview: FrameLocator): Promise<Record<string, string>> {
	const container = preview.locator('h3', { hasText: 'Deals by stage' })
		.locator('..')
	// `innerText()` (not `textContent()`) is required here: it is layout-aware, so each grid-cell
	// `<span>` renders on its own line — `textContent()` would concatenate every label/count with no
	// separator at all. This is Playwright's `Locator.innerText()`, not the DOM node API
	// `unicorn/prefer-dom-node-text-content` assumes.
	// eslint-disable-next-line unicorn/prefer-dom-node-text-content
	const lines = (await container.innerText()).split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0)
	const counts: Record<string, string> = {}
	for (let i = 1; i + 1 < lines.length; i += 2) counts[lines[i]!.toLowerCase()] = lines[i + 1]!
	return counts
}

/** `MetricCardRenderer.vue` renders `<span>{label}</span><strong>{value}</strong>` as siblings. */
function metricValue(preview: FrameLocator, label: string): Locator {
	return preview.locator('span', { hasText: label })
		.locator('..')
		.locator('strong')
}

function dealRow(preview: FrameLocator, company: string): Locator {
	return preview.getByRole('row')
		.filter({ hasText: company })
}

interface FocusTarget {
	readonly context: 'body' | 'preview-frame' | 'interactive' | 'other'
	readonly label: string | null
}

interface ModalFocusObservation {
	readonly parent: FocusTarget
	readonly preview: {
		readonly context: 'body' | 'dialog' | 'background-interactive' | 'other'
		readonly dialogOpen: boolean
	}
}

/** Observe each document independently; a Preview BODY never stands in for the parent's active element. */
async function observeModalFocus(page: Page, preview: FrameLocator): Promise<ModalFocusObservation> {
	const [parent, child] = await Promise.all([
		page.evaluate(() => {
			const active = document.activeElement
			const previewFrame = document.querySelector('iframe[data-testid="preview-frame"]')
			const interactive = active instanceof HTMLElement
				&& active.matches('button, a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
			const textContent = active instanceof HTMLElement ? active.textContent : null
			const text = textContent?.trim()
				.replace(/\s+/g, ' ')
				.slice(0, 48) ?? ''
			return {
				context: active === document.body ? 'body' as const : active === previewFrame ? 'preview-frame' as const : interactive ? 'interactive' as const : 'other' as const,
				label: active?.getAttribute('aria-label') ?? (text || null),
			}
		}),
		preview.locator('html')
			.evaluate(() => {
				const active = document.activeElement
				const dialog = document.querySelector('dialog')
				const inDialog = dialog !== null && dialog.contains(active)
				const interactive = active instanceof HTMLElement
					&& active.matches('button, a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
				return {
					context: active === document.body ? 'body' as const : inDialog ? 'dialog' as const : interactive ? 'background-interactive' as const : 'other' as const,
					dialogOpen: dialog?.open ?? false,
				}
			}),
	])
	return { parent, preview: child }
}

function assertModalFocusObservation(observation: ModalFocusObservation, step: string): 'body-transition' | 'parent-shell' | 'preview-dialog' {
	expect(observation.preview.dialogOpen, `${step}: Preview dialog must remain open`)
		.toBe(true)
	expect(['dialog', 'body'], `${step}: Preview focus must stay in the dialog or its document BODY`)
		.toContain(observation.preview.context)

	if (observation.preview.context === 'dialog') {
		expect(observation.parent.context, `${step}: dialog focus must be represented by the parent iframe element`)
			.toBe('preview-frame')
		return 'preview-dialog'
	}

	if (observation.parent.context === 'body') {
		// Chromium has shown this paired BODY/BODY state at the iframe boundary. It is a transition
		// between two documents, never evidence that the parent BODY is contained by the child dialog.
		return 'body-transition'
	}

	// With child BODY focus, Chromium has shown a parent shell control after focus leaves the iframe.
	// Parent 'other' is deliberately not permitted: no genuine Tab path observed it. Child 'other' is
	// already excluded above, as are Preview background controls.
	expect(observation.parent.context, `${step}: child BODY focus must pair with a focused parent control or BODY boundary transition`)
		.toBe('interactive')
	return 'parent-shell'
}

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Switch showcase')
		.selectOption('crm')
})

test('search filters the table and the Visible deals KPI coherently', async ({ page }) => {
	const preview = previewFrame(page)
	await expect(metricValue(preview, 'Visible deals'))
		.toHaveText('8')

	await preview.getByLabel('Search', { exact: true })
		.fill('Aurora')
	await expect(dealRow(preview, 'Aurora Systems'))
		.toBeVisible()
	await expect(preview.locator('tbody tr'))
		.toHaveCount(1)
	await expect(metricValue(preview, 'Visible deals'))
		.toHaveText('1')
})

test('stage filter updates the table and the Visible deals KPI coherently', async ({ page }) => {
	const preview = previewFrame(page)
	// Exactly one seed deal is `won` (Fjord Robotics) — showcases/crm/domain.ts.
	await preview.getByLabel('Stage', { exact: true })
		.selectOption('won')
	await expect(dealRow(preview, 'Fjord Robotics'))
		.toBeVisible()
	await expect(preview.locator('tbody tr'))
		.toHaveCount(1)
	await expect(metricValue(preview, 'Visible deals'))
		.toHaveText('1')
})

test('keyboard-selecting rows with Enter and Space both drive Table.selectedRowId, moving aria-current and the detail panel without scrolling the Preview frame', async ({ page }) => {
	const preview = previewFrame(page)
	const auroraRow = dealRow(preview, 'Aurora Systems')
	const borealisRow = dealRow(preview, 'Borealis Retail')
	const detailPanelCompany = () => preview.getByText('Deal details')
		.locator('..')
		.locator('dd')
		.first()

	// Native table semantics throughout (PR #32 review round 1: no `role="grid"` without its full
	// keyboard contract) — an unselected row carries no `aria-current` attribute at all. Per WAI-ARIA
	// 1.2 (https://www.w3.org/TR/wai-aria/#aria-current), `aria-current`'s spec-defined default value is
	// already `"false"`, and an element with no `aria-current` attribute computes to that default (not
	// exposed to assistive technology) automatically — omission relies on the documented default rather
	// than there being no `"false"` value at all (PR #32 round 2 correction).
	await expect(auroraRow)
		.not.toHaveAttribute('aria-current')
	await expect(borealisRow)
		.not.toHaveAttribute('aria-current')

	// Enter activates the focused row through the exact same `Table.selectRow(id)` Method a pointer
	// click uses.
	await auroraRow.focus()
	await page.keyboard.press('Enter')

	await expect(detailPanelCompany())
		.toHaveText('Aurora Systems')
	await expect(auroraRow)
		.toHaveAttribute('aria-current', 'true')
	await expect(borealisRow)
		.not.toHaveAttribute('aria-current')

	// Space must activate a *different* focused row through the same Method — and must not scroll the
	// page as Space's native default action would on an ordinary focused, non-form-control element.
	const scrollYBeforeSpace = await preview.locator('html')
		.evaluate(() => window.scrollY)
	await borealisRow.focus()
	await page.keyboard.press('Space')
	const scrollYAfterSpace = await preview.locator('html')
		.evaluate(() => window.scrollY)
	expect(scrollYAfterSpace)
		.toBe(scrollYBeforeSpace)

	await expect(detailPanelCompany())
		.toHaveText('Borealis Retail')
	await expect(borealisRow)
		.toHaveAttribute('aria-current', 'true')
	// Selection is single-row: activating Borealis moves `aria-current` off Aurora, driven by the same
	// Runtime-backed `Table.selectedRowId` State, never renderer-local selection.
	await expect(auroraRow)
		.not.toHaveAttribute('aria-current')
})

test('Preview-local Change stage dialog: child background stays blocked while parent shell remains usable', async ({ page }) => {
	const preview = previewFrame(page)
	const row = dealRow(preview, 'Aurora Systems')
	await row.focus()
	await page.keyboard.press('Enter')

	const changeStageButton = preview.getByRole('button', { name: 'Change stage' })
	await changeStageButton.click()

	const dialog = preview.getByRole('dialog', { name: 'Change deal stage' })
	await expect(dialog)
		.toBeVisible()
	// Opening moves focus into the dialog, to its first control ("New stage").
	await expect(preview.getByLabel('New stage'))
		.toBeFocused()

	// Follow real Tab input until it reaches a known parent control. The bound is only a safety limit;
	// reaching the named control, rather than consuming a fixed number of samples, is the milestone.
	const implementationButton = page.getByRole('button', { name: 'Implementation', exact: true })
	const maxBoundaryTabSteps = 32
	let reachedImplementationByTab = false
	let sawForwardBodyTransition = false
	for (let i = 0; i < maxBoundaryTabSteps; i++) {
		await page.keyboard.press('Tab')
		const observation = await observeModalFocus(page, preview)
		const position = assertModalFocusObservation(observation, `forward Tab ${i + 1}`)
		if (position === 'body-transition') {
			sawForwardBodyTransition = true
		}
		if (observation.parent.context === 'interactive' && observation.parent.label === 'Implementation') {
			reachedImplementationByTab = true
			break
		}
	}
	expect(reachedImplementationByTab, `Tab from the focused New stage control must reach the Implementation parent control within ${maxBoundaryTabSteps} steps`)
		.toBe(true)
	expect(sawForwardBodyTransition, 'forward Tab must recognize the observed BODY/BODY document-boundary transition without treating parent BODY as dialog containment')
		.toBe(true)
	await expect(implementationButton)
		.toBeFocused()

	// Anchor reverse traversal on the parent control reached by real Tab input, then require a real
	// reverse-key re-entry into the child dialog. Merely observing a parent control cannot satisfy this.
	let reenteredPreviewDialog = false
	let sawReverseBodyTransition = false
	for (let i = 0; i < maxBoundaryTabSteps; i++) {
		await page.keyboard.press('Shift+Tab')
		const observation = await observeModalFocus(page, preview)
		const position = assertModalFocusObservation(observation, `reverse Shift+Tab ${i + 1}`)
		if (position === 'body-transition') {
			sawReverseBodyTransition = true
		}
		if (position === 'preview-dialog') {
			reenteredPreviewDialog = true
			break
		}
	}
	expect(reenteredPreviewDialog, `Shift+Tab from the focused Implementation parent control must re-enter the still-open Preview dialog within ${maxBoundaryTabSteps} steps`)
		.toBe(true)
	expect(sawReverseBodyTransition, 'reverse Shift+Tab must recognize the observed BODY/BODY document-boundary transition without treating parent BODY as dialog containment')
		.toBe(true)

	// A real click and subsequent Tab/Shift+Tab keep the parent toolbar usable while the Preview dialog
	// remains open. Tab naturally moves from Implementation to its next toolbar control.
	const documentToolsButton = page.getByRole('button', { name: 'Document Tools', exact: true })
	await implementationButton.click()
	await expect(implementationButton)
		.toBeFocused()
	await expect(page.getByRole('tab', { name: 'Implementation', exact: true }))
		.toHaveAttribute('aria-selected', 'true')
	await expect(dialog)
		.toBeVisible()
	await page.keyboard.press('Tab')
	await expect(documentToolsButton)
		.toBeFocused()
	await page.keyboard.press('Shift+Tab')
	await expect(implementationButton)
		.toBeFocused()
	await expect(dialog)
		.toBeVisible()

	// A genuine pointer click at the Preview search control's position hits the modal backdrop; the
	// background field remains unchanged and unfocused. Its focus is never inferred from a parent BODY.
	const search = preview.getByLabel('Search', { exact: true })
	const searchBox = await search.boundingBox()
	expect(searchBox).not.toBeNull()
	await page.mouse.click(searchBox!.x + searchBox!.width / 2, searchBox!.y + searchBox!.height / 2)
	await expect(search)
		.toHaveValue('')
	await expect(search).not.toBeFocused()
	// A backdrop may obscure pointer hits without making the background inert. Native showModal()
	// must also reject programmatic focus of an enabled Preview background input.
	const searchCanReceiveProgrammaticFocus = await search.evaluate((element) => {
		(element as HTMLElement).focus()
		return document.activeElement === element
	})
	expect(searchCanReceiveProgrammaticFocus)
		.toBe(false)
	await expect(dialog)
		.toBeVisible()

	// Escape cancels: no mutation, dialog closes, focus returns to the button that opened it.
	await preview.getByLabel('New stage')
		.press('Escape')
	await expect(dialog)
		.toBeHidden()
	await expect(changeStageButton)
		.toBeFocused()
	await expect(dealRow(preview, 'Aurora Systems')
		.locator('td')
		.nth(3))
		.toHaveText('lead')

	// Reopen, change the stage, and cancel through the semantic form. Cancel still leaves Runtime data intact.
	await changeStageButton.click()
	await preview.getByLabel('New stage')
		.selectOption('won')
	await preview.getByRole('button', { name: 'Cancel', exact: true })
		.click()
	await expect(dialog)
		.toBeHidden()
	await expect(dealRow(preview, 'Aurora Systems')
		.locator('td')
		.nth(3))
		.toHaveText('lead')

	// Save through the semantic Method flow and verify dependent read models recompute.
	const weightedValueBefore = await metricValue(preview, 'Weighted value')
		// eslint-disable-next-line unicorn/prefer-dom-node-text-content -- Playwright's `Locator.innerText()`, not the DOM node API this rule assumes.
		.innerText()
	const wonCountBefore = (await stageChartCounts(preview)).won

	await changeStageButton.click()
	await preview.getByLabel('New stage')
		.selectOption('won')
	await preview.getByRole('button', { name: 'Save' })
		.click()

	await expect(dialog)
		.toBeHidden()
	await expect(dealRow(preview, 'Aurora Systems')
		.locator('td')
		.nth(3))
		.toHaveText('won')
	await expect(dealRow(preview, 'Aurora Systems'))
		.toHaveAttribute('aria-current', 'true')

	// KPI/chart recompute through the same DealQuery/BarChart read models — never a renderer-local total.
	await expect(metricValue(preview, 'Weighted value')).not.toHaveText(weightedValueBefore)
	await expect.poll(async () => (await stageChartCounts(preview)).won).not.toBe(wonCountBefore)
})
