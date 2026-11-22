import type { Page } from '@playwright/test'
import { defaultSurveyPreset, surveyPresets } from '../src/showcases/survey/presets'
import { expect, expectDocumentStatus, expectPreviewStatus, loadPreset, openDependenciesGraph, openDeveloperTool, previewFrame, test } from './fixtures'

/**
 * Interactive Survey acceptance contract: the Maker Space open-day sign-up survey
 * (`showcases/survey/presets.ts`, preset `survey-default`), as walked through in the talk's demo. Each
 * test is one numbered item of the acceptance checklist; the parts that need a person to read a panel
 * (Runtime panel values, the Relations view) are checked by hand and are not repeated here.
 *
 * The question renderers write `answer` on the native `input`/`change` event, so a plain `.fill()` or
 * `.check()` is enough: no blur is needed before asserting its effect.
 *
 * Editing steps go through the `?lab-test` draft seam (`src/lab-test-seam.ts`), which calls the exact
 * `LabStore.setDraftSourceText()` Monaco's change handler calls, so no test types into Monaco.
 */

interface LabTestWindow {
	__WIDGET_LAB_TEST__?: {
		setDraftSourceText: (text: string) => void
	}
}

const REQUIRED_MESSAGE = 'This question is required.'

async function openSurvey(page: Page): Promise<void> {
	await page.goto('/?lab-test')
	await page.waitForFunction(() => typeof (window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText === 'function')
	await expect(previewFrame(page)
		.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
		.toBeVisible()
}

async function setDraft(page: Page, text: string): Promise<void> {
	await page.evaluate((source) => {
		(window as unknown as LabTestWindow).__WIDGET_LAB_TEST__?.setDraftSourceText(source)
	}, text)
}

async function apply(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Apply', exact: true })
		.click()
}

/** The default preset's definition, parsed so a test can change one part and re-serialize it. */
function defaultDocument(): any {
	return JSON.parse(defaultSurveyPreset.sourceText)
}

function question(document: any, id: string): any {
	return document.slots.questions.find((candidate: { id: string }) => candidate.id === id)
}

async function openBlueprintDiagnostics(page: Page): Promise<void> {
	await page.getByRole('tab', { name: 'Blueprint' })
		.click()
	await page.getByRole('button', { name: /All diagnostics/ })
		.click()
}

/** The `[code, location]` text of every Blueprint diagnostic row, in list order. */
async function diagnosticRows(page: Page): Promise<{ code: string, location: string }[]> {
	const rows = page.locator('[data-testid^="blueprint-diagnostic-"]:not([data-testid*="navigate"]):not([data-testid*="location"])')
	return rows.evaluateAll(elements => elements.map(element => ({
		code: element.querySelector('span')?.textContent?.trim() ?? '',
		location: element.querySelector('[data-testid^="blueprint-diagnostic-location-"]')?.textContent?.replace(/\s+/g, ' ')
			.trim() ?? '',
	})))
}

test('1. JSON to UI: the default document renders as a form, Blueprint is valid, Graph shows five widgets', async ({ page }) => {
	await openSurvey(page)
	const preview = previewFrame(page)

	await expect(preview.getByText('How will you join?'))
		.toBeVisible()
	await expect(preview.getByText('Sessions you want to join'))
		.toBeVisible()
	await expect(preview.getByText('Phone number', { exact: true }))
		.toBeVisible()
	// Guests is hidden until "On site" is chosen.
	await expect(preview.getByText('Guests coming with you'))
		.toHaveCount(0)

	await page.getByRole('tab', { name: 'Author' })
		.click()
	await expect(page.locator('.view-lines'))
		.toContainText('Maker Space open day: sign-up')
	await expectDocumentStatus(page, { valid: true })

	await openDependenciesGraph(page)
	const clusters = page.locator('.vue-flow__node[data-id^="cluster:"]')
	await expect(clusters.first())
		.toBeVisible({ timeout: 15_000 })
	await expect(clusters)
		.toHaveCount(5)
})

test('2. reactive validation: On site, Guests, the laser rule, and Online', async ({ page }) => {
	await openSurvey(page)
	const preview = previewFrame(page)
	const guestsCard = preview.locator('[data-widget-id="guests"]')
	const sessionsCard = preview.locator('[data-widget-id="sessions"]')
	const laser = preview.getByLabel('Laser cutting')
	const kids = preview.getByLabel('Kids\' corner')

	// Before any answer: the mode question reports its required rule from load, Laser cutting is disabled.
	await expect(preview.locator('[data-widget-id="mode"] [data-error-code="required"]'))
		.toHaveText(new RegExp(REQUIRED_MESSAGE))
	await expect(laser)
		.toBeDisabled()
	await expect(preview.getByLabel('Phone number'))
		.not
		.toHaveAttribute('aria-required', 'true')

	// On site: Guests appears with its required error, Phone becomes required, Laser cutting is enabled.
	await preview.getByLabel('On site', { exact: true })
		.check()
	await expect(guestsCard)
		.toBeVisible()
	await expect(guestsCard.locator('[data-error-code="required"]'))
		.toHaveText(new RegExp(REQUIRED_MESSAGE))
	await expect(preview.getByLabel('Phone number'))
		.toHaveAttribute('aria-required', 'true')
	await expect(laser)
		.toBeEnabled()
	await expect(kids)
		.toHaveCount(0)

	// Guests 3: the kids' corner appears.
	await preview.getByLabel('Guests coming with you')
		.fill('3')
	await expect(guestsCard.locator('[data-error-code]'))
		.toHaveCount(0)
	await expect(kids)
		.toBeVisible()

	// Laser cutting with more than two guests breaks the custom rule.
	await laser.check()
	await expect(sessionsCard.locator('[data-error-code="rule"]'))
		.toHaveText(/Laser cutting has room for at most 2 guests\./)

	// Online: Guests and the kids' corner disappear, Laser cutting is disabled, the rule error goes, and
	// the stored laser selection is reported as the only error (an option that can no longer be chosen).
	await preview.getByLabel('Online', { exact: true })
		.check()
	await expect(guestsCard)
		.toHaveCount(0)
	await expect(kids)
		.toHaveCount(0)
	await expect(laser)
		.toBeDisabled()
	await expect(sessionsCard.locator('[data-error-code="rule"]'))
		.toHaveCount(0)
	await expect(sessionsCard.locator('[data-error-code]'))
		.toHaveAttribute('data-error-code', 'invalid-option')
	await expect(sessionsCard.locator('[data-error-code]'))
		.toHaveCount(1)
})

test('3. multi-language: the survey switches to 繁體中文 while the Lab chrome stays English', async ({ page }) => {
	await openSurvey(page)
	const preview = previewFrame(page)

	await preview.getByLabel('Language')
		.selectOption('zh-TW')
	await expect(preview.getByRole('heading', { name: '創客空間開放日報名' }))
		.toBeVisible()
	await expect(preview.getByText('您會如何參加？'))
		.toBeVisible()
	await expect(preview.getByLabel('現場參加'))
		.toBeVisible()
	await expect(preview.getByText('請選一到兩個。'))
		.toBeVisible()
	await expect(preview.getByRole('button', { name: '送出' }))
		.toBeVisible()
	// An answer error is in the survey language too.
	await expect(preview.locator('[data-widget-id="mode"] [data-error-code="required"]'))
		.not
		.toHaveText(new RegExp(REQUIRED_MESSAGE))

	// The Lab's own chrome is unaffected by the survey's language.
	await expect(page.getByRole('button', { name: 'Apply', exact: true }))
		.toBeVisible()
	await expectDocumentStatus(page, { valid: true })

	await preview.getByLabel('Language')
		.selectOption('en')
	await expect(preview.getByRole('heading', { name: 'Maker Space open day: sign-up' }))
		.toBeVisible()
})

test('4. editor: a fifth question without a zh-TW label is a located error until the text is added', async ({ page }) => {
	await openSurvey(page)
	const preview = previewFrame(page)

	const document = defaultDocument()
	document.slots.questions.push({ id: 'feedback', type: 'ShortAnswer', config: { label: { en: 'Anything else we should know?' } } })
	await setDraft(page, JSON.stringify(document, null, 2))
	await apply(page)

	await expectDocumentStatus(page, { problems: 1 })
	// The previous revision keeps running in Preview: the new question is not rendered.
	await expectPreviewStatus(page, 'stale')
	await expect(preview.getByText('Anything else we should know?'))
		.toHaveCount(0)

	await openBlueprintDiagnostics(page)
	const [row] = await diagnosticRows(page)
	expect(row!.code)
		.toBe('invalid-widget-structure')
	expect(row!.location)
		.toContain('feedback : ShortAnswer')
	const message = await page.getByTestId('blueprint-diagnostic-0')
		.textContent() ?? ''
	expect(message)
		.toContain('label')
	expect(message)
		.toContain('zh-TW')

	// Adding the missing text makes the Document valid and the question renders.
	document.slots.questions[4].config.label['zh-TW'] = '還有什麼想讓我們知道的嗎？'
	await setDraft(page, JSON.stringify(document, null, 2))
	await apply(page)
	await expectDocumentStatus(page, { valid: true })
	await expectPreviewStatus(page, 'current')
	await expect(preview.getByText('Anything else we should know?'))
		.toBeVisible()
})

test('5. located diagnostics: the AI draft preset lists five, and fixing "mod" removes exactly one', async ({ page }) => {
	await openSurvey(page)
	await loadPreset(page, 'survey-ai-draft')
	await expectDocumentStatus(page, { problems: 5 })

	await openBlueprintDiagnostics(page)
	const rows = await diagnosticRows(page)
	const summary = rows.map(({ code, location }) => `${code} | ${location}`)
	expect(summary)
		.toHaveLength(5)
	expect(summary.filter(entry => entry.startsWith('invalid-widget-config')))
		.toHaveLength(1)
	expect(summary.filter(entry => entry.startsWith('unknown-widget-type')))
		.toHaveLength(1)
	expect(summary.filter(entry => entry.startsWith('invalid-widget-structure')))
		.toHaveLength(2)
	expect(summary.filter(entry => entry.startsWith('missing-dependency-target')))
		.toHaveLength(1)
	expect(summary.find(entry => entry.startsWith('invalid-widget-config')))
		.toContain('mode : SingleChoice')
	expect(summary.find(entry => entry.startsWith('missing-dependency-target')))
		.toContain('widget "guests : Numeric" · property "visible"')
	expect(summary.filter(entry => entry.startsWith('invalid-widget-structure')
		&& (entry.includes('phone : ShortAnswer') || entry.includes('sessions : MultipleChoice'))))
		.toHaveLength(2)
	await expect(page.getByTestId('blueprint-diagnostic-0'))
		.toContainText('path: options')

	// "jump to node" selects the diagnostic's widget in the Blueprint tree.
	const dependencyRow = page.locator('[data-testid^="blueprint-diagnostic-"]')
		.filter({ hasText: 'missing-dependency-target' })
		.first()
	await expect(dependencyRow)
		.toContainText('widget("mod")')
	await dependencyRow.getByRole('button', { name: 'jump to node' })
		.click()
	await expect(page.getByRole('heading', { name: 'guests : Numeric' }))
		.toBeVisible()

	const fixed = surveyPresets.find(preset => preset.id === 'survey-ai-draft')!.sourceText.replace('"question": "mod"', '"question": "mode"')
	expect(fixed)
		.not
		.toBe(surveyPresets.find(preset => preset.id === 'survey-ai-draft')!.sourceText)
	await setDraft(page, fixed)
	await apply(page)
	await expectDocumentStatus(page, { problems: 4 })
	await openBlueprintDiagnostics(page)
	expect((await diagnosticRows(page)).map(row => row.code))
		.not
		.toContain('missing-dependency-target')
})

test('6. cycle: an edit that makes Guests and the kids\' corner depend on each other is reported by Core and marked in the Graph', async ({ page }) => {
	await openSurvey(page)

	// Edit the default document the way the demo does, then revert.
	const document = defaultDocument()
	question(document, 'guests').config.visibleWhen = { question: 'sessions', op: 'includes', value: 'kids' }
	await setDraft(page, JSON.stringify(document, null, 2))
	await apply(page)
	await expectDocumentStatus(page, { problems: 4 })

	await openBlueprintDiagnostics(page)
	const rows = await diagnosticRows(page)
	expect(rows.map(row => row.code))
		.toEqual(['property-evaluation-cycle', 'property-evaluation-cycle', 'property-evaluation-cycle', 'property-evaluation-cycle'])
	expect(rows.map(row => row.location)
		.sort())
		.toEqual([
			'location: widget "guests : Numeric" · property "value"',
			'location: widget "guests : Numeric" · property "visible"',
			'location: widget "sessions : MultipleChoice" · property "options"',
			'location: widget "sessions : MultipleChoice" · property "value"',
		])
	// A related chip names its widget, not just the member.
	const chipTitles = await page.getByTestId('blueprint-diagnostic-0')
		.locator('button[title]')
		.evaluateAll(chips => chips.map(chip => chip.getAttribute('title')))
	expect(chipTitles.some(title => /(?:guests : Numeric|sessions : MultipleChoice) · property "/.test(title ?? '')))
		.toBe(true)

	await openDependenciesGraph(page)
	const cycleBadges = page.locator('.graph-node--cluster [title="invalid cycle"]')
	await expect(cycleBadges.first())
		.toBeVisible({ timeout: 15_000 })
	const marked = page.locator('.graph-node--cluster')
		.filter({ has: page.locator('[title="invalid cycle"]') })
	await expect(marked)
		.toHaveCount(2)
	await expect(marked.filter({ hasText: '#guests' }))
		.toHaveCount(1)
	await expect(marked.filter({ hasText: '#sessions' }))
		.toHaveCount(1)

	// Reverting the edit makes the Document valid again.
	await setDraft(page, defaultSurveyPreset.sourceText)
	await apply(page)
	await expectDocumentStatus(page, { valid: true })
})

test('6b. the cycle preset is the same four evaluation cycles', async ({ page }) => {
	await openSurvey(page)
	await loadPreset(page, 'survey-cycle')
	await expectDocumentStatus(page, { problems: 4 })
	await openBlueprintDiagnostics(page)
	expect((await diagnosticRows(page)).map(row => row.code))
		.toEqual(['property-evaluation-cycle', 'property-evaluation-cycle', 'property-evaluation-cycle', 'property-evaluation-cycle'])
})

test('7. submission: a blocked Submit writes nothing; a valid one stores the response, and a later change is marked', async ({ page }) => {
	await openSurvey(page)
	const preview = previewFrame(page)
	const submitted = preview.getByTestId('survey-submitted')

	// With errors: the blocked message appears and nothing is stored.
	await preview.getByRole('button', { name: 'Submit', exact: true })
		.click()
	await expect(preview.getByTestId('survey-submit-diagnostic'))
		.toContainText('Some answers have errors')
	await expect(submitted)
		.toHaveCount(0)

	// A valid on-site answer set.
	await preview.getByLabel('On site', { exact: true })
		.check()
	await preview.getByLabel('Guests coming with you')
		.fill('2')
	await preview.getByLabel('3D printing basics')
		.check()
	await preview.getByLabel('Phone number')
		.fill('0912 345 678')
	// The blocked message is shown only while the survey cannot be submitted.
	await expect(preview.getByTestId('survey-submit-diagnostic'))
		.toHaveCount(0)
	await preview.getByRole('button', { name: 'Submit', exact: true })
		.click()

	await expect(submitted)
		.toBeVisible()
	await expect(submitted)
		.toContainText('onsite')
	await expect(submitted)
		.toContainText('printing')
	await expect(submitted)
		.toContainText('0912 345 678')
	await expect(preview.getByTestId('survey-changed-since-submit'))
		.toHaveCount(0)

	// The Runtime panel's Method row shows the compiler's facts for `submit()`.
	await page.getByRole('tab', { name: 'Runtime' })
		.click()
	const submitRow = page.getByRole('button', { name: /^submit\(\)/ })
	await expect(submitRow)
		.toContainText('writes')
	await expect(submitRow)
		.toContainText('emits')

	// Changing an answer after the Submit marks the submitted copy; reverting clears the mark.
	await preview.getByLabel('Guests coming with you')
		.fill('1')
	await expect(preview.getByTestId('survey-changed-since-submit'))
		.toBeVisible()
	await expect(submitted)
		.toContainText('onsite')
	await preview.getByLabel('Guests coming with you')
		.fill('2')
	await expect(preview.getByTestId('survey-changed-since-submit'))
		.toHaveCount(0)
})

test('8. backend view: the Response block shows what the form computed', async ({ page }) => {
	await openSurvey(page)
	const preview = previewFrame(page)
	const readResponse = async (): Promise<any> => JSON.parse(await preview.getByTestId('survey-response-json')
		.textContent() ?? 'null')

	await preview.getByTestId('survey-response')
		.locator('summary')
		.click()
	await expect(preview.getByTestId('survey-response-json'))
		.toBeVisible()

	let response = await readResponse()
	expect(Object.keys(response.answers))
		.toEqual(['mode', 'guests', 'sessions', 'phone'])
	expect(response.answers.guests)
		.toMatchObject({ visible: false, value: null, errors: [] })
	expect(response.answers.mode.errors[0].code)
		.toBe('required')

	await preview.getByLabel('On site', { exact: true })
		.check()
	await preview.getByLabel('Guests coming with you')
		.fill('2')
	await preview.getByLabel('Phone number')
		.fill('0912 345 678')
	await expect.poll(async () => (await readResponse()).answers.guests.value)
		.toBe(2)
	response = await readResponse()
	expect(response.answers.mode)
		.toMatchObject({ visible: true, required: true, value: 'onsite', errors: [] })
	expect(response.answers.guests)
		.toMatchObject({ visible: true, required: true, value: 2, errors: [] })
	expect(response.answers.phone)
		.toMatchObject({ visible: true, required: true, value: '0912 345 678', errors: [] })
	expect(Object.keys(response.answers.sessions)
		.sort())
		.toEqual(['errors', 'required', 'value', 'visible'])
})

test('9. AI context: Catalog shows the Numeric config schema and copies the catalog JSON', async ({ page }) => {
	await openSurvey(page)
	await page.getByRole('tab', { name: 'Author' })
		.click()
	await page.getByRole('tab', { name: 'Catalog' })
		.click()

	const numeric = page.getByTestId('author-catalog-Numeric')
	await expect(numeric)
		.toBeVisible()
	const schema = page.getByTestId('author-catalog-schema-Numeric')
	await schema.locator('summary')
		.click()
	await expect(schema)
		.toContainText('"$defs"')
	await expect(schema)
		.toContainText('"type_Condition"')

	await page.evaluate(() => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: async (text: string) => { (window as unknown as { copiedCatalog?: string }).copiedCatalog = text } },
		})
	})
	await page.getByTestId('author-catalog-copy')
		.click()
	await expect(page.getByTestId('author-catalog-copy'))
		.toHaveText('Copied')
	const copied = JSON.parse(await page.evaluate(() => (window as unknown as { copiedCatalog?: string }).copiedCatalog ?? 'null')) as {
		widgets: { type: string, config: { schema: { $defs?: Record<string, unknown> } | null } | null }[]
	}
	expect(copied.widgets.map(widget => widget.type))
		.toEqual(['Survey', 'SingleChoice', 'MultipleChoice', 'Numeric', 'ShortAnswer'])
	expect(Object.keys(copied.widgets.find(widget => widget.type === 'Numeric')!.config!.schema!.$defs!))
		.toContain('type_Condition')

	// Implementation for `Numeric` curates its plugin file.
	await openDeveloperTool(page, 'implementation')
	await page.getByRole('navigation', { name: 'Registered plugins' })
		.getByRole('button', { name: 'Numeric', exact: true })
		.click()
	await expect(page.getByTestId('implementation-code'))
		.toContainText('createWidgetPlugin(\'Numeric\')')
	await expect(page.getByRole('button', { name: 'numeric.ts', exact: true }))
		.toBeVisible()
})
