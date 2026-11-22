import type { FrameLocator, Locator, Page } from '@playwright/test'
import { test as base, expect } from '@playwright/test'
import { sandboxPresets } from '../src/sandbox/presets'
import { repairPresets } from '../src/showcases/document-repair/presets'
import { onboardingPresets } from '../src/showcases/onboarding/presets'
import { quotePresets } from '../src/showcases/quote-rules/presets'
import { packsPresets } from '../src/showcases/renderer-packs/presets'
import { surveyPresets } from '../src/showcases/survey/presets'
import { tripBudgetPresets } from '../src/showcases/trip-budget/presets'

/**
 * Shared request boundary for the browser suite. Built-app tests default to the exact origin in
 * `baseURL` (the `vite preview` server on :4173), so same-host requests to Vite's source server on
 * :4174 cannot satisfy a built asset request. The DevTools source-fixture spec opts into its own
 * exact :4174 origin below; that allowance does not apply to built-app tests.
 *
 * `blob:`, `data:`, and `about:` URLs are browser-local resources rather than network origins and
 * remain available. Every other off-origin request is recorded and aborted at the Playwright layer,
 * which keeps the suite offline and makes a wrong-origin asset request deterministic.
 */

/**
 * Issue #25 P1: `App.vue` now shows a first-entry Welcome card whenever
 * `tutorial/session-flags.ts`'s `welcome-dismissed` sessionStorage flag is unset — which every fresh
 * Playwright context always is. Left alone, that would insert an extra modal in front of every one of
 * the pre-existing specs, none of which expect it (issue #28's browser-contract suite predates the
 * tutorial). `context.addInitScript()` pre-sets that exact flag before any page script runs, for EVERY
 * test using this fixture — the same key `session-flags.ts` reads (`isWelcomeDismissed()`), so this is
 * not a parallel/duplicated mechanism, just seeding the real flag the app itself already checks.
 *
 * `e2e/tutorial.spec.ts` is the one spec that must see the real first-entry welcome card (that is
 * exactly what part of it tests) — it opts out via the `welcomeDismissed: false` fixture option below
 * rather than a second fixture file, keeping "which specs see the welcome card" declared in one place.
 */
export const test = base.extend<{
	additionalRequestOrigin: string | null
	blockedRequestUrls: string[]
	expectedRequestOrigin: string | null
	offOriginRequestUrls: string[]
	welcomeDismissed: boolean
}>({
	welcomeDismissed: [true, { option: true }],
	additionalRequestOrigin: [null, { option: true }],
	expectedRequestOrigin: [null, { option: true }],

	// Populated by the `page` fixture below as requests are blocked; a plain array captured by
	// reference so both fixtures share the same instance for a given test. No other fixture
	// dependency needed, but Playwright statically parses this signature for its dependency list, so
	// the empty object-destructure pattern (rather than a plain unused parameter) is required here.
	// eslint-disable-next-line no-empty-pattern
	blockedRequestUrls: async ({}, use) => {
		await use([])
	},
	// eslint-disable-next-line no-empty-pattern
	offOriginRequestUrls: async ({}, use) => {
		await use([])
	},

	page: async ({
		additionalRequestOrigin,
		baseURL,
		blockedRequestUrls,
		context,
		expectedRequestOrigin,
		offOriginRequestUrls,
		page,
	}, use) => {
		const expectedOrigin = new URL(expectedRequestOrigin ?? baseURL ?? 'http://localhost:4173').origin
		const additionalOrigin = additionalRequestOrigin === null
			? null
			: new URL(additionalRequestOrigin).origin
		await context.route('**/*', async (route) => {
			const url = route.request()
				.url()
			const parsedUrl = new URL(url)
			if (
				parsedUrl.protocol === 'blob:'
				|| parsedUrl.protocol === 'data:'
				|| parsedUrl.protocol === 'about:'
				|| parsedUrl.origin === expectedOrigin
				|| parsedUrl.origin === additionalOrigin
			) {
				await route.continue()
				return
			}
			offOriginRequestUrls.push(url)
			blockedRequestUrls.push(url)
			await route.abort('blockedbyclient')
		})
		await use(page)
	},

	context: async ({ context, welcomeDismissed }, use) => {
		if (welcomeDismissed) {
			await context.addInitScript(() => {
				sessionStorage.setItem('widget-lab:tutorial:welcome-dismissed', '1')
			})
		}
		await use(context)
	},
})

export { expect }

/** The isolated Preview execution document introduced by issue #10 / Phase B2. */
export function previewFrame(page: Page): FrameLocator {
	return page.frameLocator('[data-testid=\"preview-frame\"]')
}

// ---------------------------------------------------------------------------------------------------------
// Header menu helpers. The header's showcase/preset/theme/language/developer controls are Nuxt UI menus, so
// specs go through these instead of ad-hoc menu clicks; when the header changes again only this block does.

export type ShowcaseId = 'survey' | 'trip-budget' | 'quote-rules' | 'onboarding' | 'document-repair' | 'renderer-packs' | 'sandbox'
export type LabLocaleId = 'en' | 'zh-TW'

const SHOWCASE_LABELS: Readonly<Record<ShowcaseId, string>> = { 'survey': 'Interactive Survey', 'trip-budget': 'Trip budget splitter', 'quote-rules': 'Quote rules shared by browser and backend', 'onboarding': 'Onboarding wizard with an Events log', 'document-repair': 'Legacy document repair', 'renderer-packs': 'One document, two renderer packs', 'sandbox': 'Sandbox' }
const PRESET_LABELS = new Map([...surveyPresets, ...tripBudgetPresets, ...quotePresets, ...onboardingPresets, ...repairPresets, ...packsPresets, ...sandboxPresets].map(preset => [preset.id, preset.label] as const))
// The survey, trip, quote, onboarding, repair and renderer packs examples are translated in the zh-TW Lab (the sandbox ones are a hidden fixture and are not).
const PRESET_LABELS_ZH_TW: ReadonlyMap<string, string> = new Map([
	['survey-default', '預設——開放日報名'],
	['survey-ai-draft', 'AI 草稿——五個錯誤'],
	['survey-cycle', '循環——同行人數 ↔ 親子區'],
	['trip-default', '預設——里斯本週末'],
	['trip-invalid', '有錯誤的草稿——四個問題'],
	['trip-unsupported-currency', '執行時失敗——沒有匯率的幣別'],
	['quote-default', '預設——轉角印刷的印製報價'],
	['quote-invalid', '無效的設定——schema 函式庫的診斷'],
	['quote-buggy-rule', '有問題的規則——被隔離的例外'],
	['onboarding-default', '預設——潮池工坊新成員引導'],
	['onboarding-ready-to-book', '準備預約——只剩新手導覽'],
	['onboarding-deep-link', '深層連結——直接開在第 4 步，什麼都還沒填'],
	['onboarding-invalid', '有錯誤的草稿——四個問題'],
	['repair-default', '預設——四份來自舊版本的草稿'],
	['repair-invalid', '有錯誤的草稿——四個問題'],
	['packs-default', '預設——兩組 renderer pack 的工作區設定'],
	['packs-invalid', '有錯誤的草稿——四個問題'],
])

// Menu item names follow the page locale; the language names themselves never translate.
const OVERFLOW_LABELS: Readonly<Record<LabLocaleId, { theme: string, language: string, developer: string, light: string, dark: string, implementation: string, documentTools: string }>> = {
	'en': { theme: 'Theme', language: 'Lab language', developer: 'Developer', light: 'Light', dark: 'Dark', implementation: 'Implementation', documentTools: 'Document Tools' },
	'zh-TW': { theme: '主題', language: 'Lab 介面語言', developer: '開發者', light: '亮色', dark: '深色', implementation: '實作', documentTools: 'Document 工具' },
}
const LANGUAGE_NAMES: Readonly<Record<LabLocaleId, string>> = { 'en': 'English', 'zh-TW': '繁體中文' }

async function pageLocale(page: Page): Promise<LabLocaleId> {
	const lang = await page.evaluate(() => document.documentElement.lang)
	return lang === 'zh-TW' ? 'zh-TW' : 'en'
}

/**
 * Opens a header menu by its trigger and clicks one path of items (`[submenu, leaf]` or `[item]`), once: a menu
 * that closes by itself must fail the spec, not be retried into passing (an earlier retrying version hid a focus
 * bug that closed the menus under the user). A menu that was just closed can linger in the DOM for its exit
 * animation, so "open" is read from the trigger's `aria-expanded`, never from the number of `menu` roles.
 */
async function chooseFromMenu(page: Page, triggerTestId: string, path: readonly (() => Locator)[]): Promise<void> {
	const trigger = page.getByTestId(triggerTestId)
	await trigger.click()
	await expect(trigger)
		.toHaveAttribute('aria-expanded', 'true')
	for (const item of path) {
		await item()
			.click()
	}
}

/**
 * Answers the confirmation that a showcase switch or preset load raises over JSON text that does not parse (or a switch over
 * committed edits): `discard` continues (and drops what it names), `keep` cancels. Resolves once the dialog is gone.
 */
export async function answerDraftGuard(page: Page, answer: 'discard' | 'keep'): Promise<void> {
	const dialog = page.getByTestId('draft-guard-dialog')
	await expect(dialog)
		.toBeVisible()
	await page.getByTestId(answer === 'discard' ? 'draft-guard-discard' : 'draft-guard-keep')
		.click()
	await expect(dialog)
		.toBeHidden()
}

/** Switches showcase through the Examples menu. Pass `discardDraft` when the switch asks first (JSON with a syntax error, committed edits). */
export async function selectShowcase(page: Page, id: ShowcaseId, options: { discardDraft?: boolean } = {}): Promise<void> {
	await chooseFromMenu(page, 'examples-menu', [() => page.getByRole('menuitemcheckbox', { name: SHOWCASE_LABELS[id] })])
	if (options.discardDraft === true)
		await answerDraftGuard(page, 'discard')
}

/** Loads a preset of the current showcase through the Examples menu. Pass `discardDraft` when the JSON text has a syntax error. */
export async function loadPreset(page: Page, id: string, options: { discardDraft?: boolean } = {}): Promise<void> {
	const english = PRESET_LABELS.get(id)
	if (english === undefined)
		throw new Error(`Unknown preset id: ${id}`)
	const label = (await pageLocale(page)) === 'zh-TW' ? PRESET_LABELS_ZH_TW.get(id) ?? english : english
	await chooseFromMenu(page, 'examples-menu', [() => page.getByRole('menuitemcheckbox', { name: label })])
	if (options.discardDraft === true)
		await answerDraftGuard(page, 'discard')
}

/** Asserts which showcase the Examples menu says is open (locale-free: reads the machine-readable id) and the URL follows it. */
export async function expectShowcase(page: Page, id: ShowcaseId): Promise<void> {
	await expect(page.getByTestId('examples-menu'))
		.toHaveAttribute('data-showcase-id', id)
	await expect(page)
		.toHaveURL(new RegExp(`[?&]showcase=${id}(&|$)`))
}

/** The header's one status chip (Lab UX phase 3). `data-state` is what it says (`LabStatus.chip.kind`). */
export function labStatus(page: Page): Locator {
	return page.getByTestId('lab-status')
}

export type LabStatusState = 'up-to-date' | 'restarted' | 'updating' | 'problems' | 'json-not-applied' | 'preview-unavailable' | 'stale'

/** What the status chip says. "Preview restarted" is the brief state after a commit that replaced the Runtime; pass both when either may show. */
export async function expectLabStatus(page: Page, expected: LabStatusState | readonly LabStatusState[]): Promise<void> {
	const states = typeof expected === 'string' ? [expected] : expected
	await expect(labStatus(page))
		.toHaveAttribute('data-state', new RegExp(`^(?:${states.join('|')})$`))
}

/**
 * Whether the committed Document is valid, or has `n` problems (the chip's `data-validity` and `data-problem-count`; with problems
 * the chip says "N problems · …"). A JSON syntax error is not a Document problem since Lab UX phase 3: see `expectLabStatus`.
 */
export async function expectDocumentStatus(page: Page, expected: { valid: true } | { problems: number }): Promise<void> {
	const chip = labStatus(page)
	if ('valid' in expected) {
		await expect(chip)
			.toHaveAttribute('data-validity', 'valid')
		return
	}
	await expect(chip)
		.toHaveAttribute('data-validity', 'problems')
	await expect(chip)
		.toHaveAttribute('data-problem-count', String(expected.problems))
}

/** What the Preview shows (the chip's `data-preview`): the Document (`current`), the last valid version (`stale`), none, or a failed frame. */
export async function expectPreviewStatus(page: Page, expected: 'current' | 'stale' | 'unavailable' | 'failed'): Promise<void> {
	await expect(labStatus(page))
		.toHaveAttribute('data-preview', expected)
}

interface LabTestSeamWindow {
	__WIDGET_LAB_TEST__?: { editJson: (text: string) => void, typeJson: (text: string) => void, getDocumentSourceText: () => string }
}

/** Waits for the `?lab-test` seam (the page must be opened with `lab-test` in its query). */
export async function waitForLabTestSeam(page: Page): Promise<void> {
	await page.waitForFunction(() => typeof (window as unknown as LabTestSeamWindow).__WIDGET_LAB_TEST__?.editJson === 'function')
}

/**
 * Types `text` into the JSON view and leaves it, through the `?lab-test` seam: committed at once when it parses (as on blur);
 * text that does not parse stays the JSON view's text with its syntax error.
 */
export async function editJson(page: Page, text: string): Promise<void> {
	await page.evaluate(source => (window as unknown as LabTestSeamWindow).__WIDGET_LAB_TEST__!.editJson(source), text)
}

/** Types `text` into the JSON view and stays there: committed after the typing pause when it parses. */
export async function typeJson(page: Page, text: string): Promise<void> {
	await page.evaluate(source => (window as unknown as LabTestSeamWindow).__WIDGET_LAB_TEST__!.typeJson(source), text)
}

/** The committed Document source, through the `?lab-test` seam. */
export async function documentSourceText(page: Page): Promise<string> {
	return page.evaluate(() => (window as unknown as LabTestSeamWindow).__WIDGET_LAB_TEST__!.getDocumentSourceText())
}

export async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
	const labels = OVERFLOW_LABELS[await pageLocale(page)]
	await chooseFromMenu(page, 'overflow-menu', [
		() => page.getByRole('menuitem', { name: labels.theme }),
		() => page.getByRole('menuitemcheckbox', { name: theme === 'light' ? labels.light : labels.dark }),
	])
}

export async function setLocale(page: Page, locale: LabLocaleId): Promise<void> {
	const labels = OVERFLOW_LABELS[await pageLocale(page)]
	await chooseFromMenu(page, 'overflow-menu', [
		() => page.getByRole('menuitem', { name: labels.language }),
		() => page.getByRole('menuitemcheckbox', { name: LANGUAGE_NAMES[locale] }),
	])
}

/** Opens the Implementation explorer or Document Tools from the overflow menu's Developer submenu. */
export async function openDeveloperTool(page: Page, tool: 'implementation' | 'document-tools'): Promise<void> {
	const labels = OVERFLOW_LABELS[await pageLocale(page)]
	await chooseFromMenu(page, 'overflow-menu', [
		() => page.getByRole('menuitem', { name: labels.developer }),
		() => page.getByRole('menuitem', { name: tool === 'implementation' ? labels.implementation : labels.documentTools }),
	])
	// The panel is added and activated asynchronously and takes focus: wait for that before the next menu is opened.
	// The tab is named like the menu item, in the page's language.
	await expect(page.getByRole('tab', { name: tool === 'implementation' ? labels.implementation : labels.documentTools, exact: true }))
		.toHaveAttribute('aria-selected', 'true')
}

/**
 * Opens Author > JSON and waits for Monaco. Author opens on Structure since Lab UX phase 1, and Monaco is only mounted
 * (and loaded) once the JSON view is open. Works in either Lab language.
 */
export async function openAuthorJson(page: Page): Promise<void> {
	await page.getByRole('tab', { name: /^(?:Author|編寫)$/ })
		.click()
	await page.getByRole('tablist', { name: /^(?:Author views|編寫檢視)$/ })
		.getByRole('tab', { name: 'JSON', exact: true })
		.click()
	await expect(page.getByTestId('json-editor')
		.locator('.monaco-editor'))
		.toBeVisible()
}

/** The tutorial entry of the overflow menu (its label follows the tutorial state: Tutorial, Pause, Resume, Restart). */
export async function chooseTutorialMenuItem(page: Page, name = 'Tutorial'): Promise<void> {
	await chooseFromMenu(page, 'overflow-menu', [() => page.getByRole('menuitem', { name, exact: true })])
}

/** Opens Dependencies and switches it to the Graph view (Relations is the default view, issue #230 PR 3b). */
export async function openDependenciesGraph(page: Page): Promise<void> {
	await page.getByRole('tab', { name: 'Dependencies', exact: true })
		.click()
	await page.getByRole('tablist', { name: 'Dependencies views' })
		.getByRole('tab', { name: 'Graph' })
		.click()
}

/** The Graph card of the widget `#widgetId` (its Vue Flow node), collapsed or expanded. */
export function graphWidgetCard(page: Page, widgetId: string): Locator {
	return page.locator('.vue-flow__node-cluster')
		.filter({ has: page.locator('.graph-cluster-id', { hasText: new RegExp(`^#${widgetId}$`) }) })
}

/**
 * Expands the widget `#widgetId` in the Graph with its card's Expand button and waits until the new layout shows it expanded.
 * One widget is expanded at a time (issue #254): this collapses the widget that was expanded before.
 */
export async function expandGraphWidget(page: Page, widgetId: string): Promise<void> {
	await graphWidgetCard(page, widgetId)
		.getByRole('button', { name: 'Expand', exact: true })
		.click()
	await expect(graphWidgetCard(page, widgetId)
		.getByRole('button', { name: 'Collapse', exact: true }))
		.toBeVisible({ timeout: 15_000 })
}

/**
 * Opens the header's "Document and preview details" popover and returns its content. The popover holds the
 * developer-vocabulary status (revisions, Linked/Diverged, JSON draft, Blueprint status, recovery topology);
 * its content only exists while it is open.
 */
export async function openStatusDetails(page: Page): Promise<Locator> {
	const trigger = page.getByTestId('status-details')
	if ((await trigger.getAttribute('aria-expanded')) !== 'true')
		await trigger.click()
	const panel = page.getByTestId('status-details-panel')
	await expect(panel)
		.toBeVisible()
	return panel
}
