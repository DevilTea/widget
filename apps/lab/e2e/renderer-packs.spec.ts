import type { Locator, Page } from '@playwright/test'
import { chooseTutorialMenuItem, expect, expectDocumentStatus, expectPreviewStatus, expectShowcase, loadPreset, previewFrame, selectShowcase, setLocale, setTheme, test } from './fixtures'

/**
 * "One document, two renderer packs" acceptance contract (issue #230): the workspace settings page
 * (`showcases/renderer-packs/presets.ts`, preset `packs-default`) in the Examples menu after the legacy document repair.
 *
 * Covers selecting it (menu and `?showcase=`); typing in a field in one pack and finding the same value in the other, both ways,
 * and side by side; the Appearance (density and colour mode) reaching both packs through the fields' own reads; a confirmed
 * DangerAction in each pack leaving a notification and a `confirmed` Event in the Lab's Events tab; a modal that is local to the
 * Preview (the Lab's header stays operable while it is open, focus stays inside it); `dark` on the Nuxt UI pack's root only; no
 * off-origin request (icons and styles are bundled); the located diagnostics of the invalid preset; accessibility minimums, the
 * guided tour and zh-TW.
 *
 * Nothing here retries an action or waits a fixed time: every wait is for a state the page reaches.
 */

async function openPacks(page: Page, query = ''): Promise<void> {
	await page.goto(`/?showcase=renderer-packs${query}`)
	await expect(previewFrame(page)
		.getByRole('heading', { name: query.includes('zh-TW') ? '一份文件，兩組 renderer pack' : 'One document, two renderer packs', level: 1 }))
		.toBeVisible()
	await expect(previewFrame(page)
		.getByTestId('hand-page'))
		.toBeVisible()
}

type Pack = 'hand' | 'nui' | 'both'

/** Chooses the pack in the page's own chooser and waits for what it shows (the Nuxt UI pack is a lazy chunk). */
async function choosePack(page: Page, pack: Pack): Promise<void> {
	const preview = previewFrame(page)
	await preview.getByTestId(`packs-choice-${pack}`)
		.check()
	if (pack !== 'nui') {
		await expect(preview.getByTestId('hand-page'))
			.toBeVisible()
	}
	else {
		await expect(preview.getByTestId('hand-page'))
			.toHaveCount(0)
	}
	if (pack !== 'hand') {
		await expect(preview.getByTestId('nui-page'))
			.toBeVisible({ timeout: 15_000 })
	}
	else {
		await expect(preview.getByTestId('nui-page'))
			.toHaveCount(0)
	}
}

/** The Events tab: its accessible name gains ", N new" while entries arrived since it was last visible. */
async function openEvents(page: Page): Promise<Locator> {
	await page.getByRole('tab', { name: /^Events(, \d+ new)?$/ })
		.click()
	await expect(page.getByTestId('events-listening'))
		.toBeVisible()
	return page.getByTestId('events-panel')
}

const eventEntries = (page: Page): Locator => page.getByTestId('event-entry')

/** The elements of the frame document that carry the `dark` class, by test id (or tag). */
async function darkElements(page: Page): Promise<string[]> {
	return previewFrame(page)
		.locator('body')
		.evaluate(() => [...document.querySelectorAll('.dark')].map(element => element.getAttribute('data-testid') ?? element.tagName))
}

test.describe('selecting the showcase', () => {
	test('is listed in the Examples menu after the legacy document repair, and selecting it shows the page in the hand-written pack', async ({ page }) => {
		await page.goto('/')
		await expectShowcase(page, 'survey')
		await page.getByTestId('examples-menu')
			.click()
		await expect(page.getByRole('menuitemcheckbox', { name: 'One document, two renderer packs' }))
			.toBeVisible()
		await page.keyboard.press('Escape')

		await selectShowcase(page, 'renderer-packs')
		await expectShowcase(page, 'renderer-packs')
		const preview = previewFrame(page)
		await expect(preview.getByRole('heading', { name: 'One document, two renderer packs', level: 1 }))
			.toBeVisible()
		await expect(page.getByTestId('examples-menu'))
			.toHaveAttribute('data-preset-id', 'packs-default')
		await expectDocumentStatus(page, { valid: true })
		await expectPreviewStatus(page, 'current')
		await expect(preview.getByTestId('hand-page'))
			.toBeVisible()
		await expect(preview.getByTestId('packs-choice-hand'))
			.toBeChecked()
		await expect(preview.getByTestId('packs-pane-nui'))
			.toHaveCount(0)
	})

	test('?showcase=renderer-packs opens it directly and a reload restores it', async ({ page }) => {
		await openPacks(page)
		await expectShowcase(page, 'renderer-packs')
		await page.reload()
		await expect(previewFrame(page)
			.getByTestId('hand-page'))
			.toBeVisible()
		await expectShowcase(page, 'renderer-packs')
	})
})

test.describe('one Runtime, two packs', () => {
	test('what is typed in the hand-written pack is in the Nuxt UI pack, and the other way round; the Runtime is the same (the notification stays)', async ({ page }) => {
		await openPacks(page)
		const preview = previewFrame(page)
		await preview.getByTestId('hand-input-workspace-name')
			.fill('Typed by hand')
		await preview.getByTestId('hand-switch-beta')
			.check()
		await preview.getByTestId('hand-select-week-start')
			.selectOption('sunday')
		await preview.getByTestId('hand-ask-clear-cache')
			.click()
		await preview.getByTestId('hand-confirm-clear-cache')
			.click()
		await expect(preview.getByTestId('hand-status'))
			.toContainText('Local cache cleared.')

		await choosePack(page, 'nui')
		await expect(preview.getByTestId('nui-input-workspace-name'))
			.toHaveValue('Typed by hand')
		await expect(preview.getByRole('switch', { name: 'Try early-access features' }))
			.toBeChecked()
		await expect(preview.getByTestId('nui-select-week-start'))
			.toContainText('Sunday')
		await expect(preview.getByTestId('nui-status'))
			.toContainText('Local cache cleared.')

		await preview.getByTestId('nui-input-workspace-name')
			.fill('Typed in Nuxt UI')
		await preview.getByRole('switch', { name: 'Try early-access features' })
			.click()
		await choosePack(page, 'hand')
		await expect(preview.getByTestId('hand-input-workspace-name'))
			.toHaveValue('Typed in Nuxt UI')
		await expect(preview.getByTestId('hand-switch-beta'))
			.not
			.toBeChecked()
		await expect(preview.getByTestId('hand-status'))
			.toContainText('Local cache cleared.')
		await expectPreviewStatus(page, 'current')
	})

	test('side by side, both panes follow each other and the plugin\'s validation message shows in both', async ({ page }) => {
		await openPacks(page)
		await choosePack(page, 'both')
		const preview = previewFrame(page)
		await preview.getByTestId('hand-input-tagline')
			.fill('Typed on the left')
		await expect(preview.getByTestId('nui-input-tagline'))
			.toHaveValue('Typed on the left')
		await preview.getByTestId('nui-input-tagline')
			.fill('x'.repeat(45))
		await expect(preview.getByTestId('hand-input-tagline'))
			.toHaveValue('x'.repeat(45))
		await expect(preview.getByTestId('hand-message-tagline'))
			.toHaveText('Too long: 45 of 40 characters allowed.')
		await expect(preview.getByTestId('packs-pane-nui')
			.getByText('Too long: 45 of 40 characters allowed.'))
			.toBeVisible()
		await preview.getByRole('switch', { name: 'Send a weekly digest' })
			.first()
			.uncheck()
		await expect(preview.getByRole('switch', { name: 'Send a weekly digest' })
			.last())
			.not
			.toBeChecked()
	})

	test('the pack is the host\'s choice, not State: the Runtime panel lists no pack and the Preview does not restart', async ({ page }) => {
		await openPacks(page)
		await choosePack(page, 'nui')
		await expectPreviewStatus(page, 'current')
		await page.getByRole('tab', { name: 'Runtime', exact: true })
			.click()
		await expect(page.getByRole('tabpanel', { name: 'Runtime' }))
			.not
			.toContainText(/renderer pack|packs-choice/i)
	})
})

test.describe('Appearance, read by the fields', () => {
	test('density and colour mode change both packs; `dark` is a class of the Nuxt UI pack\'s root only, never of the frame document', async ({ page }) => {
		await openPacks(page)
		await choosePack(page, 'both')
		const preview = previewFrame(page)
		const handPage = preview.getByTestId('hand-page')
		const nuiPage = preview.getByTestId('nui-page')
		await expect(handPage)
			.toHaveAttribute('data-packs-density', 'comfortable')
		expect(await darkElements(page))
			.toEqual([])

		const heightOf = (testId: string): Promise<number> => preview.getByTestId(testId)
			.evaluate(element => element.getBoundingClientRect().height)
		const comfortable = await heightOf('nui-input-workspace-name')
		await preview.getByTestId('hand-density-compact')
			.check()
		await expect(handPage)
			.toHaveAttribute('data-packs-density', 'compact')
		await expect(nuiPage)
			.toHaveAttribute('data-packs-density', 'compact')
		await expect(preview.getByTestId('packs-pane-hand')
			.locator('[data-widget-id="workspace-name"]'))
			.toHaveAttribute('data-packs-density', 'compact')
		await expect.poll(() => heightOf('nui-input-workspace-name'))
			.toBeLessThan(comfortable)

		await preview.getByTestId('hand-mode-dark')
			.check()
		await expect(handPage)
			.toHaveAttribute('data-packs-theme', 'dark')
		await expect(nuiPage)
			.toHaveClass(/\bdark\b/)
		expect(await darkElements(page))
			.toEqual(['nui-page'])
		expect(await preview.locator('body')
			.evaluate(() => document.documentElement.className))
			.toBe('')
		const background = (): Promise<string> => nuiPage.evaluate(element => getComputedStyle(element).backgroundColor)
		expect(await background())
			.toBe('rgb(20, 22, 26)')

		await preview.getByTestId('hand-mode-light')
			.check()
		await expect(nuiPage)
			.not
			.toHaveClass(/\bdark\b/)
		expect(await background())
			.toBe('rgb(255, 255, 255)')
		expect(await darkElements(page))
			.toEqual([])
	})

	test('"auto" follows the Lab theme, and an explicit mode ignores it', async ({ page }) => {
		await page.goto('/?showcase=renderer-packs')
		const preview = previewFrame(page)
		await choosePack(page, 'both')
		await setTheme(page, 'dark')
		await expect(preview.getByTestId('hand-page'))
			.toHaveAttribute('data-packs-theme', 'dark')
		await expect(preview.getByTestId('nui-page'))
			.toHaveClass(/\bdark\b/)
		await preview.getByTestId('hand-mode-light')
			.check()
		await expect(preview.getByTestId('hand-page'))
			.toHaveAttribute('data-packs-theme', 'light')
		await expect(preview.getByTestId('nui-page'))
			.not
			.toHaveClass(/\bdark\b/)
	})
})

test.describe('the dangerous action and the Notifier', () => {
	test('in the hand-written pack: ask opens a native modal dialog, Confirm leaves one alert and a `confirmed` and a `notified` Event in the Events tab', async ({ page }) => {
		await openPacks(page)
		await openEvents(page)
		const preview = previewFrame(page)
		await preview.getByTestId('hand-ask-archive-workspace')
			.click()
		const dialog = preview.getByRole('dialog', { name: 'Please confirm' })
		await expect(dialog)
			.toBeVisible()
		await expect(dialog)
			.toContainText('Archive this workspace?')
		await preview.getByTestId('hand-confirm-archive-workspace')
			.click()
		await expect(dialog)
			.toBeHidden()
		await expect(preview.getByRole('alert'))
			.toContainText('Workspace archived.')

		await expect(eventEntries(page)
			.getByTestId('event-name'))
			.toHaveText(['confirmed', 'notified'])
		const confirmed = eventEntries(page)
			.first()
		await expect(confirmed.getByTestId('event-widget'))
			.toHaveText('archive-workspace : DangerAction')
		await confirmed.getByTestId('event-expand')
			.click()
		await expect(confirmed.getByTestId('event-payload'))
			.toContainText('danger')
		await expect(eventEntries(page)
			.last()
			.getByTestId('event-widget'))
			.toHaveText('notifier : Notifier')

		await preview.getByTestId('hand-alert-dismiss')
			.click()
		await expect(preview.getByRole('alert'))
			.toHaveCount(0)
	})

	test('in the Nuxt UI pack: ask opens a UModal inside the pack\'s root, Confirm leaves the same notification and Events', async ({ page, offOriginRequestUrls }) => {
		await openPacks(page)
		await choosePack(page, 'nui')
		await openEvents(page)
		const preview = previewFrame(page)
		await preview.getByTestId('nui-ask-archive-workspace')
			.click()
		const dialog = preview.getByRole('dialog', { name: 'Please confirm' })
		await expect(dialog)
			.toBeVisible()
		// Teleported into the pack's own overlay container, not the frame's `<body>`.
		expect(await dialog.evaluate(element => element.closest('[data-packs-portal]') !== null))
			.toBe(true)
		expect(await preview.locator('body')
			.evaluate(() => [...document.body.children].filter(child => child.matches('[role="dialog"], [data-reka-popper-content-wrapper]')).length))
			.toBe(0)
		await preview.getByTestId('nui-confirm-archive-workspace')
			.click()
		await expect(dialog)
			.toBeHidden()
		await expect(preview.getByRole('alert'))
			.toContainText('Workspace archived.')
		await expect(eventEntries(page)
			.getByTestId('event-name'))
			.toHaveText(['confirmed', 'notified'])

		// The alert's icon is an inline svg with real path data (bundled at build time), and nothing was fetched off-origin.
		await expect(preview.getByTestId('nui-alert')
			.locator('svg path')
			.first())
			.toHaveAttribute('d', /.+/)
		expect(offOriginRequestUrls)
			.toEqual([])
	})

	test('a success notification is the one status, a danger one the one alert, and a second danger one replaces the first as the alert', async ({ page }) => {
		await openPacks(page)
		const preview = previewFrame(page)
		await preview.getByTestId('hand-ask-clear-cache')
			.click()
		await preview.getByTestId('hand-confirm-clear-cache')
			.click()
		await expect(preview.getByRole('status'))
			.toContainText('Local cache cleared.')
		await expect(preview.getByRole('alert'))
			.toHaveCount(0)
		await preview.getByTestId('hand-ask-archive-workspace')
			.click()
		await preview.getByTestId('hand-confirm-archive-workspace')
			.click()
		await expect(preview.getByRole('alert'))
			.toHaveCount(1)
		await expect(preview.getByRole('status'))
			.toContainText('Local cache cleared.')
		await preview.getByTestId('hand-ask-archive-workspace')
			.click()
		await preview.getByTestId('hand-confirm-archive-workspace')
			.click()
		await expect(preview.getByRole('alert'))
			.toHaveCount(1)
	})

	test('side by side, one pane asks and only that pane draws the confirmation; the page keeps one alert and one status', async ({ page }) => {
		await openPacks(page)
		await choosePack(page, 'both')
		const preview = previewFrame(page)
		await preview.getByTestId('nui-ask-clear-cache')
			.click()
		await expect(preview.getByRole('dialog'))
			.toHaveCount(1)
		await expect(preview.getByTestId('packs-pane-hand')
			.getByText('The confirmation is open in the other pane.'))
			.toBeVisible()
		await expect(preview.getByTestId('hand-dialog-clear-cache'))
			.toBeHidden()
		await preview.getByTestId('nui-confirm-clear-cache')
			.click()
		await expect(preview.getByRole('dialog'))
			.toHaveCount(0)

		await preview.getByTestId('hand-ask-archive-workspace')
			.click()
		await expect(preview.getByRole('dialog'))
			.toHaveCount(1)
		await expect(preview.getByTestId('hand-dialog-archive-workspace'))
			.toBeVisible()
		await preview.getByTestId('hand-confirm-archive-workspace')
			.click()
		await expect(preview.getByRole('alert'))
			.toHaveCount(1)
		await expect(preview.getByRole('status'))
			.toHaveCount(1)
		// Both panes show the notifications, though only the first carries the live regions.
		await expect(preview.getByTestId('hand-alert'))
			.toContainText('Workspace archived.')
		await expect(preview.getByTestId('nui-alert'))
			.toContainText('Workspace archived.')
	})
})

test.describe('the modal is local to the Preview', () => {
	for (const pack of ['hand', 'nui'] as const) {
		test(`the Lab header stays operable while the ${pack === 'hand' ? 'native dialog' : 'Nuxt UI modal'} is open, and focus stays inside the modal`, async ({ page }) => {
			await openPacks(page)
			if (pack === 'nui')
				await choosePack(page, 'nui')
			const preview = previewFrame(page)
			await preview.getByTestId(`${pack}-ask-archive-workspace`)
				.click()
			const dialog = preview.getByRole('dialog', { name: 'Please confirm' })
			await expect(dialog)
				.toBeVisible()

			// The Lab shell is another document: its header opens a menu although the Preview's modal is open.
			await page.getByTestId('examples-menu')
				.click()
			await expect(page.getByTestId('examples-menu'))
				.toHaveAttribute('aria-expanded', 'true')
			await expect(page.getByRole('menuitemcheckbox', { name: 'Legacy document repair' }))
				.toBeVisible()
			await page.keyboard.press('Escape')
			await expect(page.getByTestId('examples-menu'))
				.toHaveAttribute('aria-expanded', 'false')
			// Nothing in the Lab was made inert for the iframe's sake, and the modal is still open.
			expect(await page.evaluate(() => document.querySelectorAll('[inert]').length))
				.toBe(0)
			await expect(dialog)
				.toBeVisible()

			// Keyboard focus is trapped in the modal: every Tab (and Shift+Tab) lands inside it.
			await preview.getByTestId(`${pack}-cancel-archive-workspace`)
				.focus()
			for (let step = 0; step < 6; step++) {
				await page.keyboard.press(step % 2 === 0 ? 'Tab' : 'Shift+Tab')
				expect(await preview.locator('body')
					.evaluate(() => document.activeElement?.closest('dialog, [role="dialog"]') !== null), `step ${step}`)
					.toBe(true)
			}

			// Esc is Cancel: State says the question is over and nothing was notified.
			await preview.getByTestId(`${pack}-cancel-archive-workspace`)
				.focus()
			await page.keyboard.press('Escape')
			await expect(dialog)
				.toBeHidden()
			await expect(preview.getByRole('alert'))
				.toHaveCount(0)
		})
	}
})

test.describe('offline', () => {
	test('both packs, every overlay and the icons are same-origin: nothing is requested off-origin', async ({ page, offOriginRequestUrls }) => {
		await openPacks(page)
		await choosePack(page, 'both')
		const preview = previewFrame(page)
		await preview.getByTestId('nui-select-week-start')
			.click()
		await expect(preview.getByRole('option', { name: 'Saturday' }))
			.toBeVisible()
		// The select's menu is teleported into the pack's own container.
		expect(await preview.getByRole('listbox')
			.evaluate(element => element.closest('[data-packs-portal]') !== null))
			.toBe(true)
		await preview.getByRole('option', { name: 'Saturday' })
			.click()
		await expect(preview.getByTestId('hand-select-week-start'))
			.toHaveValue('saturday')
		await preview.getByTestId('nui-ask-archive-workspace')
			.click()
		await preview.getByTestId('nui-confirm-archive-workspace')
			.click()
		await expect(preview.getByTestId('nui-alert')
			.locator('svg path')
			.first())
			.toHaveAttribute('d', /.+/)
		expect(offOriginRequestUrls)
			.toEqual([])
	})
})

test.describe('diagnostics', () => {
	test('the invalid preset has four located problems and the preview keeps the last working page', async ({ page }) => {
		await openPacks(page)
		await loadPreset(page, 'packs-invalid')
		await expectDocumentStatus(page, { problems: 4 })
		await expectPreviewStatus(page, 'stale')
		await expect(previewFrame(page)
			.getByTestId('hand-page'))
			.toBeVisible()
		const problems = page.getByTestId('author-problems')
		await expect(problems)
			.toHaveAttribute('data-problem-count', '4')
		await expect(problems)
			.toContainText('config.maxLength must be a whole number of at least 1')
		await expect(problems)
			.toContainText('config.appearance is "look-and-feel", but the document has no widget with that id.')
		await expect(problems)
			.toContainText('config.appearance is "notifier", a Notifier, not an Appearance.')
		await expect(problems)
			.toContainText('config.notifier is "notification-center", but the document has no widget with that id.')
	})
})

test.describe('accessibility minimums', () => {
	test('every control is labelled and at least 24px, one alert and one status side by side, focus is visible, text is at least 11px', async ({ page }) => {
		await openPacks(page)
		await choosePack(page, 'both')
		const preview = previewFrame(page)

		// Keyboard first: a focused control shows a focus indicator (checked before any pointer use, so :focus-visible applies).
		const input = preview.getByTestId('hand-input-workspace-name')
		await input.focus()
		expect(await input.evaluate(element => getComputedStyle(element).outlineStyle))
			.not
			.toBe('none')

		await preview.getByTestId('hand-ask-clear-cache')
			.click()
		await preview.getByTestId('hand-confirm-clear-cache')
			.click()
		await preview.getByTestId('hand-ask-archive-workspace')
			.click()
		await preview.getByTestId('hand-confirm-archive-workspace')
			.click()
		await expect(preview.getByRole('alert'))
			.toHaveCount(1)
		await expect(preview.getByRole('status'))
			.toHaveCount(1)
		await expect(preview.locator('[aria-live]'))
			.toHaveCount(0)

		// Targets: a control is its own box, or the label that is for it (a radio, a check box or a switch is smaller than its label,
		// and a click on the label operates it). Labels: a name, or an associated `<label>`, which is looked up by id: a duplicate id
		// (two Vue apps in one document) would make it fail.
		const problems = await preview.locator('button, input, select, [role="switch"], [role="radio"]')
			.evaluateAll(elements => elements.flatMap((element) => {
				const box = element.getBoundingClientRect()
				if (box.width === 0 || box.height === 0)
					return []
				const control = element as HTMLInputElement
				const labels = [...control.labels ?? []].map(label => label.getBoundingClientRect())
				const issues: string[] = []
				const name = element.getAttribute('aria-label') ?? (element.textContent ?? '').trim()
				if (name === '' && element.getAttribute('aria-labelledby') === null && labels.length === 0)
					issues.push('unlabelled')
				if (![box, ...labels].some(candidate => candidate.height >= 24 && candidate.width >= 24))
					issues.push(`target ${Math.round(box.width)}x${Math.round(box.height)}`)
				return issues.length === 0 ? [] : [`${element.outerHTML.slice(0, 100)}: ${issues.join(', ')}`]
			}))
		expect(problems)
			.toEqual([])

		const font = await preview.locator('[data-testid="packs-root"]')
			.evaluate((root) => {
				const sizes = new Set<number>()
				for (const element of root.querySelectorAll('*')) {
					if ((element.textContent ?? '').trim() !== '' && element.children.length === 0 && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 1)
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

	test('walks the shared State, the pack switch, the named provider, the confirmation and the Method that calls a Method with real interactions', async ({ page }) => {
		await openPacks(page)
		await chooseTutorialMenuItem(page)
		const rail = page.getByRole('complementary', { name: RAIL })
		await expect(rail)
			.toBeVisible()
		const next = page.getByRole('button', { name: 'Next', exact: true })
		const preview = previewFrame(page)

		// orient
		await expect(rail.getByText('This is a workspace settings page, drawn from one Document and one Runtime.', { exact: false }))
			.toBeVisible()
		await expect(preview.locator('[data-tutorial-target="packs-settings"]'))
			.toHaveClass(/tutorial-spotlight/)
		await next.click()

		// type: gated on the State the box wrote
		await expect(preview.locator('[data-tutorial-target="packs-workspace-name"]'))
			.toHaveClass(/tutorial-spotlight/)
		await expect(next)
			.toBeDisabled()
		await preview.getByTestId('hand-input-workspace-name')
			.fill('Dockside')
		await expect(rail.getByText('The box wrote State value of the TextField.', { exact: false }))
			.toBeVisible()
		await expect(next)
			.toBeEnabled()
		await next.click()

		// switch pack (narrated: the choice is the host's)
		await expect(preview.locator('[data-tutorial-target="packs-chooser"]'))
			.toHaveClass(/tutorial-spotlight/)
		await choosePack(page, 'nui')
		await expect(preview.getByTestId('nui-input-workspace-name'))
			.toHaveValue('Dockside')
		await expect(next)
			.toBeEnabled()
		await next.click()

		// density: gated on the Appearance's State, whichever pack wrote it
		await expect(next)
			.toBeDisabled()
		await preview.getByRole('radio', { name: 'Compact' })
			.click()
		await expect(rail.getByText('Core has no nearest-ancestor or provider lookup', { exact: false }))
			.toBeVisible()
		await next.click()

		// mode
		await expect(next)
			.toBeDisabled()
		await preview.getByRole('radio', { name: 'Dark' })
			.click()
		await expect(next)
			.toBeEnabled()
		await next.click()

		// ask, then confirm
		await expect(next)
			.toBeDisabled()
		await preview.getByTestId('nui-ask-archive-workspace')
			.click()
		await expect(rail.getByText('The button called the Method ask', { exact: false }))
			.toBeVisible()
		await next.click()
		await expect(next)
			.toBeDisabled()
		await preview.getByTestId('nui-confirm-archive-workspace')
			.click()
		await expect(rail.getByText('confirm did three things', { exact: false }))
			.toBeVisible()
		await expect(next)
			.toBeEnabled()
	})
})

test.describe('zh-TW', () => {
	test('translates the Examples menu entries, the tutorial and both packs, while widget ids and codes stay as they are', async ({ page }) => {
		await openPacks(page, '&lang=zh-TW')
		const preview = previewFrame(page)
		await expect(page.getByTestId('examples-showcase'))
			.toHaveText('一份文件，兩組 renderer pack')
		await expect(preview.getByTestId('hand-page'))
			.toContainText('工作區設定')
		await expect(preview.getByTestId('hand-input-workspace-name'))
			.toHaveAccessibleName('工作區名稱')
		await expect(preview.getByTestId('packs-chooser'))
			.toContainText('手寫')

		await choosePack(page, 'nui')
		await expect(preview.getByTestId('nui-input-workspace-name'))
			.toHaveAccessibleName(/工作區名稱/)
		await expect(preview.getByTestId('nui-appearance'))
			.toContainText('外觀')
		await preview.getByTestId('nui-input-workspace-name')
			.fill('一個名字太長太長太長太長太長太長太長太長太長太長太長的工作區')
		await expect(preview.getByTestId('packs-pane-nui'))
			.toContainText('太長了：最多 24 個字元')
		await preview.getByTestId('nui-ask-archive-workspace')
			.click()
		await expect(preview.getByRole('dialog', { name: '請確認' }))
			.toBeVisible()
		await expect(preview.getByRole('dialog'))
			.toContainText('要封存這個工作區嗎？')
		await preview.getByTestId('nui-confirm-archive-workspace')
			.click()
		await expect(preview.getByRole('alert'))
			.toContainText('工作區已封存。')

		await page.getByTestId('examples-menu')
			.click()
		for (const name of ['預設——兩組 renderer pack 的工作區設定', '有錯誤的草稿——四個問題']) {
			await expect(page.getByRole('menuitemcheckbox', { name }))
				.toBeVisible()
		}
		await page.keyboard.press('Escape')

		await chooseTutorialMenuItem(page, '教學')
		const rail = page.getByRole('complementary', { name: '教學' })
		await expect(rail.getByText('這是一個工作區設定頁，由一份 Document 與一個 Runtime 繪製。', { exact: false }))
			.toBeVisible()
		await setLocale(page, 'en')
		await expect(page.getByRole('complementary', { name: 'Tutorial' })
			.getByText('This is a workspace settings page, drawn from one Document and one Runtime.', { exact: false }))
			.toBeVisible()
		await expect(preview.getByRole('heading', { name: 'One document, two renderer packs', level: 1 }))
			.toBeVisible()
	})
})
