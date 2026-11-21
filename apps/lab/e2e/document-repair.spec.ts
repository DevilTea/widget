import type { Page } from '@playwright/test'
import { chooseTutorialMenuItem, expect, expectDocumentStatus, expectPreviewStatus, expectShowcase, loadPreset, previewFrame, selectShowcase, setLocale, setTheme, test } from './fixtures'

/**
 * Legacy document repair acceptance contract (issue #230): the repair desk (`showcases/document-repair/presets.ts`, preset
 * `repair-default`) in the Examples menu after the onboarding wizard.
 *
 * Covers selecting it (menu and `?showcase=`); opening the 1.x draft on a copy, applying every step of the application's plan
 * until the document is valid and previewing the repaired board; the stale revision when another editor saves
 * (`document-revision-conflict`) and the re-plan that continues; the draft the application has no rule for, which never
 * gets a preview; the desk's own located diagnostics; theme, accessibility minimums, the guided tour and zh-TW.
 *
 * Nothing here retries an action or waits a fixed time: every wait is for a state the page reaches.
 */

async function openRepair(page: Page, query = ''): Promise<void> {
	await page.goto(`/?showcase=document-repair${query}`)
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Notice board: drafts from older versions', level: 1 }))
		.toBeVisible()
}

/** Opens the 1.x draft in the app. */
async function openV1(page: Page): Promise<void> {
	await previewFrame(page)
		.getByTestId('repair-open-draft-v1')
		.click()
	await expect(previewFrame(page)
		.getByTestId('repair-revision-draft-v1'))
		.toHaveText('0')
}

async function applyNext(page: Page): Promise<void> {
	await previewFrame(page)
		.getByTestId('repair-apply-draft-v1')
		.click()
}

test.describe('selecting the showcase', () => {
	test('is listed in the Examples menu after the onboarding wizard, and selecting it shows the repair desk', async ({ page }) => {
		await page.goto('/')
		await expectShowcase(page, 'survey')

		await page.getByTestId('examples-menu')
			.click()
		await expect(page.getByRole('menuitemcheckbox', { name: 'Legacy document repair' }))
			.toBeVisible()
		await page.keyboard.press('Escape')

		await selectShowcase(page, 'document-repair')
		await expectShowcase(page, 'document-repair')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Notice board: drafts from older versions', level: 1 }))
			.toBeVisible()
		await expect(page.getByTestId('examples-menu'))
			.toHaveAttribute('data-preset-id', 'repair-default')
		await expectDocumentStatus(page, { valid: true })
		await expectPreviewStatus(page, 'current')
		for (const id of ['draft-v1', 'draft-v2', 'draft-v3', 'draft-poll']) {
			await expect(previewFrame(page)
				.getByTestId(`repair-draft-${id}`))
				.toBeVisible()
		}
	})

	test('?showcase=document-repair opens it directly and a reload restores it', async ({ page }) => {
		await openRepair(page)
		await expectShowcase(page, 'document-repair')
		await page.reload()
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Notice board: drafts from older versions', level: 1 }))
			.toBeVisible()
		await expectShowcase(page, 'document-repair')
	})

	test('says whose policy the repair is: Core migrates, versions, repairs and quarantines nothing, and nothing is saved', async ({ page }) => {
		await openRepair(page)
		const intro = previewFrame(page)
			.locator('.repair-intro')
		await expect(intro)
			.toContainText('Core does not migrate, version, repair or quarantine anything')
		await expect(intro)
			.toContainText('nothing is saved anywhere')
	})
})

test.describe('the stored draft, as Core sees it', () => {
	test('lists the 1.x draft\'s diagnostics with their source paths and the raw-slot placement, before it is opened', async ({ page }) => {
		await openRepair(page)
		const draft = previewFrame(page)
			.getByTestId('repair-draft-draft-v1')
		await draft.getByText('The stored draft, as Core sees it')
			.click()
		await expect(draft.locator('[data-testid="repair-diagnostic"][data-code="undeclared-widget-slot"]'))
			.toBeVisible()
		await expect(draft.locator('[data-testid="repair-diagnostic"][data-code="unexpected-widget-field"] [data-testid="repair-diagnostic-path"]'))
			.toHaveText('at /slots/items/0')
		await expect(draft.locator('[data-testid="repair-diagnostic"][data-code="invalid-widget-id"] [data-testid="repair-diagnostic-path"]'))
			.toHaveText('at /slots/items/3')
		await expect(draft.locator('[data-placement="raw-slot"]'))
			.toHaveText('raw-slot items (4)')
		await expect(draft.getByTestId('repair-stored-plan-draft-v1')
			.locator('[data-testid="repair-plan-step"]'))
			.toHaveCount(6)
	})
})

test.describe('repairing the 1.x draft', () => {
	test('opens it on a copy, applies every step of the plan until it is valid, then previews and exports the repaired board', async ({ page }) => {
		await openRepair(page)
		const preview = previewFrame(page)
		await openV1(page)
		// Opening replaced the button that was pressed: the focus is on the session heading, not on body.
		await expect(preview.getByTestId('repair-session-heading-draft-v1'))
			.toBeFocused()
		await expect(preview.getByTestId('repair-doc-status-draft-v1'))
			.toHaveAttribute('data-state', 'invalid')
		await expect(preview.getByTestId('repair-plan-draft-v1')
			.locator('[data-testid="repair-plan-step"]'))
			.toHaveCount(6)
		await expect(preview.getByTestId('repair-preview-draft-v1'))
			.toHaveCount(0)

		const expected = ['rename-slot', 'rename-type', 'rename-config-text', 'move-style', 'fix-duplicate-ids', 'rewrite-no-id']
		for (const [index, id] of expected.entries()) {
			await expect(preview.getByTestId('repair-plan-draft-v1')
				.locator('[data-testid="repair-plan-step"]')
				.first())
				.toHaveAttribute('data-step-id', id)
			await applyNext(page)
			await expect(preview.getByTestId('repair-revision-draft-v1'))
				.toHaveText(String(index + 1))
		}
		await expect(preview.getByTestId('repair-result-draft-v1'))
			.toHaveText('applyPatch returned { ok: true, changed: true }: revision 5 to 6.')
		// The last step disabled the button that was pressed: the focus moved to the preview button.
		await expect(preview.getByTestId('repair-preview-draft-v1'))
			.toBeFocused()
		await expect(preview.getByTestId('repair-doc-status-draft-v1'))
			.toHaveAttribute('data-state', 'valid')
		await expect(preview.getByTestId('repair-apply-draft-v1'))
			.toBeDisabled()
		await expect(preview.getByTestId('repair-log-draft-v1')
			.locator('[data-testid="repair-log-entry"]'))
			.toHaveCount(6)

		await preview.getByTestId('repair-preview-draft-v1')
			.click()
		const board = preview.getByTestId('repair-board-draft-v1')
		await expect(board.getByRole('heading', { name: 'Maker space notices' }))
			.toBeVisible()
		await expect(board.locator('[data-testid^="repair-notice-"]'))
			.toHaveCount(4)
		await expect(board.getByTestId('repair-notice-notice-1'))
			.toContainText('A grey scarf is waiting at the desk.')

		await preview.getByTestId('repair-preview-close-draft-v1')
			.click()
		await expect(preview.getByTestId('repair-preview-draft-v1'))
			.toBeFocused()
		await expect(board)
			.toHaveCount(0)
		await preview.getByTestId('repair-preview-draft-v1')
			.click()
		await preview.getByTestId('repair-export-draft-v1')
			.click()
		const exported = preview.getByTestId('repair-export-text-draft-v1')
		await expect(exported)
			.toContainText('"notices"')
		await expect(exported)
			.not
			.toContainText('"items"')
		await expect(exported)
			.toContainText('"id": "closure-2"')
	})

	test('the Lab\'s Runtime panel shows the draft State that mirrors the session', async ({ page }) => {
		await openRepair(page)
		await openV1(page)
		await applyNext(page)
		await page.getByRole('tab', { name: 'Blueprint', exact: true })
			.click()
		await page.getByRole('button', { name: /draft-v1/ })
			.first()
			.click()
		await page.getByRole('tab', { name: 'Runtime', exact: true })
			.click()
		const row = page.locator('[data-testid="runtime-value-row"][data-member="revision"]')
			.filter({ visible: true })
		await expect(row)
			.toContainText('1')
	})
})

test.describe('another editor saves first', () => {
	test('the app\'s next step is refused with document-revision-conflict, the page explains it, and a re-plan continues', async ({ page }) => {
		await openRepair(page)
		const preview = previewFrame(page)
		await openV1(page)
		await applyNext(page)
		await expect(preview.getByTestId('repair-revision-draft-v1'))
			.toHaveText('1')

		await preview.getByTestId('repair-other-draft-v1')
			.click()
		await expect(preview.getByTestId('repair-revision-draft-v1'))
			.toHaveText('2')
		await expect(preview.getByTestId('repair-app-revision-draft-v1'))
			.toHaveText('1')
		await expect(preview.getByTestId('repair-stale-draft-v1'))
			.toBeVisible()
		await expect(preview.getByTestId('repair-log-draft-v1')
			.locator('[data-by="other-editor"]'))
			.toHaveCount(1)

		await applyNext(page)
		const alert = preview.getByRole('alert')
		await expect(alert)
			.toHaveCount(1)
		await expect(alert)
			.toHaveAttribute('data-code', 'document-revision-conflict')
		await expect(alert)
			.toContainText('planned this step at revision 1, but the document is at revision 2')
		await expect(preview.getByTestId('repair-result-detail-draft-v1'))
			.toContainText('expected revision 1, actual revision 2')
		await expect(preview.getByTestId('repair-revision-draft-v1'))
			.toHaveText('2')

		await preview.getByTestId('repair-reread-draft-v1')
			.click()
		await expect(alert)
			.toHaveCount(0)
		await expect(preview.getByTestId('repair-stale-draft-v1'))
			.toHaveCount(0)
		await applyNext(page)
		await expect(preview.getByTestId('repair-revision-draft-v1'))
			.toHaveText('3')
		await expect(preview.getByTestId('repair-log-draft-v1')
			.locator('[data-testid="repair-log-entry"]'))
			.toHaveCount(3)
	})
})

test.describe('the draft the app has no rule for', () => {
	test('never gets a preview: after its one step it is still invalid and Core creates no Runtime for it', async ({ page }) => {
		await openRepair(page)
		const preview = previewFrame(page)
		await preview.getByTestId('repair-open-draft-poll')
			.click()
		await expect(preview.getByTestId('repair-preview-draft-poll'))
			.toHaveCount(0)
		await preview.getByTestId('repair-apply-draft-poll')
			.click()
		await expect(preview.getByTestId('repair-revision-draft-poll'))
			.toHaveText('1')
		await expect(preview.getByTestId('repair-doc-status-draft-poll'))
			.toHaveAttribute('data-state', 'invalid')
		await expect(preview.getByTestId('repair-apply-draft-poll'))
			.toBeDisabled()
		await expect(preview.getByTestId('repair-no-preview-draft-poll'))
			.toContainText('Core creates no Runtime for an invalid document')
		await expect(preview.getByTestId('repair-draft-draft-poll')
			.locator('[data-testid="repair-diagnostic"]'))
			.toHaveCount(1)
		await expect(preview.getByTestId('repair-preview-draft-poll'))
			.toHaveCount(0)
		await expect(preview.getByTestId('repair-board-draft-poll'))
			.toHaveCount(0)
	})
})

test.describe('config diagnostics', () => {
	test('the invalid preset has four located problems in the desk\'s own document, and the preview keeps the last working desk', async ({ page }) => {
		await openRepair(page)
		await loadPreset(page, 'repair-invalid')
		await expectDocumentStatus(page, { problems: 4 })
		await expectPreviewStatus(page, 'stale')
		await expect(previewFrame(page)
			.getByRole('heading', { name: 'Notice board: drafts from older versions', level: 1 }))
			.toBeVisible()
		const problems = page.getByTestId('author-problems')
		await expect(problems)
			.toHaveAttribute('data-problem-count', '4')
		await expect(problems)
			.toContainText('config.source is required.')
		await expect(problems)
			.toContainText('config.savedWith must be one of "1.x", "2.x", "3.x"')
		await expect(problems)
			.toContainText('config.title is required.')
		await expect(problems)
			.toContainText('config.appVersion must be a version such as "3.0"')
	})
})

test.describe('theme', () => {
	test('paints from its own tokens and follows the Lab theme, light and dark', async ({ page }) => {
		await openRepair(page)
		const root = previewFrame(page)
			.locator('.repair')
		const background = (): Promise<string> => root.evaluate(element => getComputedStyle(element).backgroundColor)

		await setTheme(page, 'light')
		await expect(root)
			.toHaveAttribute('data-repair-theme', 'light')
		expect(await background())
			.toBe('rgb(246, 247, 249)')

		await setTheme(page, 'dark')
		await expect(root)
			.toHaveAttribute('data-repair-theme', 'dark')
		expect(await background())
			.toBe('rgb(20, 22, 26)')
	})
})

test.describe('accessibility minimums', () => {
	test('every control is labelled and at least 24px, text is at least 11px, one main landmark, one alert and one status, focus is visible', async ({ page }) => {
		await openRepair(page)
		const preview = previewFrame(page)

		// Keyboard first: a focused control shows a focus ring (checked before any pointer use, so :focus-visible applies).
		const open = preview.getByTestId('repair-open-draft-v1')
		await open.focus()
		const outline = await open.evaluate(element => getComputedStyle(element).outlineStyle)
		expect(outline)
			.not
			.toBe('none')

		await openV1(page)
		await applyNext(page)
		const apply = preview.getByTestId('repair-apply-draft-v1')

		// A refusal from a stale revision is the one alert; another refusal never leaves two.
		await preview.getByTestId('repair-other-draft-v1')
			.click()
		await apply.click()
		await expect(preview.getByRole('alert'))
			.toHaveCount(1)
		await apply.click()
		await expect(preview.getByRole('alert'))
			.toHaveCount(1)
		await expect(preview.getByRole('status'))
			.toHaveCount(1)
		await expect(preview.locator('[aria-live]'))
			.toHaveCount(0)

		const controls = preview.locator('button, summary')
		expect(await controls.count())
			.toBeGreaterThan(8)
		const problems = await controls.evaluateAll(elements => elements.flatMap((element) => {
			const box = element.getBoundingClientRect()
			const issues: string[] = []
			if ((element.textContent ?? '').trim() === '')
				issues.push('unlabelled')
			if (box.height < 24 || box.width < 24)
				issues.push(`target ${Math.round(box.width)}x${Math.round(box.height)}`)
			return issues.length === 0 ? [] : [`${element.outerHTML.slice(0, 80)}: ${issues.join(', ')}`]
		}))
		expect(problems)
			.toEqual([])

		const font = await preview.locator('.repair')
			.evaluateAll((roots) => {
				const sizes = new Set<number>()
				for (const element of roots[0]!.querySelectorAll('*')) {
					if ((element.textContent ?? '').trim() !== '' && element.children.length === 0)
						sizes.add(Number.parseFloat(getComputedStyle(element).fontSize))
				}
				return Math.min(...sizes)
			})
		expect(font)
			.toBeGreaterThanOrEqual(11)

		await expect(preview.getByRole('main'))
			.toHaveCount(1)
		await expect(preview.getByRole('heading', { level: 1 }))
			.toHaveCount(1)
	})
})

test.describe('tutorial', () => {
	const RAIL = 'Tutorial'

	test('walks the findings, the copy, the plan, a stale revision and the re-plan with real interactions', async ({ page }) => {
		await openRepair(page)
		await chooseTutorialMenuItem(page)
		const rail = page.getByRole('complementary', { name: RAIL })
		await expect(rail)
			.toBeVisible()
		const next = page.getByRole('button', { name: 'Next', exact: true })
		const preview = previewFrame(page)

		await expect(rail.getByText('This is a notice-board app at format v3', { exact: false }))
			.toBeVisible()
		await expect(next)
			.toBeEnabled()
		await next.click()

		// findings
		await expect(rail.getByText('The findings Property compiles the stored source', { exact: false }))
			.toBeVisible()
		await expect(preview.locator('[data-tutorial-target="repair-draft-v1"]'))
			.toHaveClass(/tutorial-spotlight/)
		await next.click()

		// open the draft: gated on the State the host mirrors
		await expect(next)
			.toBeDisabled()
		await openV1(page)
		await expect(rail.getByText('The app called createWidgetDocument with a structuredClone', { exact: false }))
			.toBeVisible()
		await expect(next)
			.toBeEnabled()
		await next.click()

		// plan (narrated)
		await expect(preview.locator('[data-tutorial-target="repair-plan"]'))
			.toHaveClass(/tutorial-spotlight/)
		await next.click()

		// first step
		await expect(next)
			.toBeDisabled()
		await applyNext(page)
		await expect(rail.getByText('The app called applyPatch(step.patch, { expectedRevision: 0 })', { exact: false }))
			.toBeVisible()
		await next.click()

		// another editor saves: gated on the app being behind
		await expect(next)
			.toBeDisabled()
		await preview.getByTestId('repair-other-draft-v1')
			.click()
		await expect(rail.getByText('A second writer applied a small valid edit', { exact: false }))
			.toBeVisible()
		await next.click()

		// the conflict (narrated), then the re-plan (gated)
		await applyNext(page)
		await expect(preview.getByRole('alert'))
			.toHaveAttribute('data-code', 'document-revision-conflict')
		await next.click()
		await expect(next)
			.toBeDisabled()
		await preview.getByTestId('repair-reread-draft-v1')
			.click()
		await expect(rail.getByText('The app read the current snapshot', { exact: false }))
			.toBeVisible()
		await expect(next)
			.toBeEnabled()
		await next.click()

		// finish the repair: gated on the document being valid
		await expect(next)
			.toBeDisabled()
		for (let count = 0; count < 5; count++)
			await applyNext(page)
		await expect(rail.getByText('Only a valid Blueprint has createRuntime', { exact: false }))
			.toBeVisible()
		await expect(next)
			.toBeEnabled()
	})
})

test.describe('zh-TW', () => {
	test('translates the Examples menu entries, the tutorial and the Preview, while Core\'s codes stay as they are', async ({ page }) => {
		await page.goto('/?showcase=document-repair&lang=zh-TW')
		const preview = previewFrame(page)
		await expect(preview.getByRole('heading', { name: '公告欄：舊版本留下的草稿', level: 1 }))
			.toBeVisible()
		await expect(page.getByTestId('examples-showcase'))
			.toHaveText('舊版文件修復')
		await preview.getByTestId('repair-open-draft-v1')
			.click()
		await expect(preview.getByTestId('repair-doc-status-draft-v1'))
			.toHaveText('無效')
		await expect(preview.getByTestId('repair-plan-draft-v1')
			.locator('[data-step-id="rename-slot"]'))
			.toContainText('把公告從舊的「items」slot 搬到「notices」')
		await preview.getByTestId('repair-other-draft-v1')
			.click()
		await preview.getByTestId('repair-apply-draft-v1')
			.click()
		await expect(preview.getByRole('alert'))
			.toContainText('另一位編輯者先儲存了')
		// The Core code is not translated.
		await expect(preview.getByTestId('repair-result-detail-draft-v1'))
			.toContainText('document-revision-conflict')

		await page.getByTestId('examples-menu')
			.click()
		for (const name of ['預設——四份來自舊版本的草稿', '有錯誤的草稿——四個問題']) {
			await expect(page.getByRole('menuitemcheckbox', { name }))
				.toBeVisible()
		}
		await page.keyboard.press('Escape')

		await chooseTutorialMenuItem(page, '教學')
		const rail = page.getByRole('complementary', { name: '教學' })
		await expect(rail.getByText('這是一個格式為 v3 的公告欄應用程式', { exact: false }))
			.toBeVisible()
		await page.getByRole('button', { name: '下一步', exact: true })
			.click()
		await expect(rail.getByText('findings Property 會用公告欄 System 編譯', { exact: false }))
			.toBeVisible()
		await setLocale(page, 'en')
		await expect(page.getByRole('complementary', { name: 'Tutorial' })
			.getByText('The findings Property compiles the stored source', { exact: false }))
			.toBeVisible()
		await expect(preview.getByRole('heading', { name: 'Notice board: drafts from older versions', level: 1 }))
			.toBeVisible()
	})
})
