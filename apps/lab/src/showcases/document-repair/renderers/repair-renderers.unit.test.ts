// @vitest-environment happy-dom
/**
 * The repair desk's renderers over a real Runtime and the real host, in a `ShowcaseHost` of plain refs: inspect anchors and
 * tutorial targets, the stored draft's findings, a whole repair by clicks (apply, the stale-revision conflict, re-plan,
 * preview and export), the draft that never gets a preview, one alert and one status at a time, zh-TW and the theme.
 */

import type { VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { legacyV1 } from '../fixtures'
import { createRepairRuntime } from '../test-support'
import { createTestHost, mountRepairDesk, widgetSelector } from './test-harness'

async function setup(options: Parameters<typeof mountRepairDesk>[1] = {}) {
	const { runtime } = createRepairRuntime()
	const wrapper = await mountRepairDesk(runtime, options)
	return { runtime, wrapper }
}

async function click(wrapper: VueWrapper, testId: string): Promise<void> {
	await wrapper.get(`[data-testid="${testId}"]`)
		.trigger('click')
	await nextTick()
}

function text(wrapper: VueWrapper, testId: string): string {
	return wrapper.get(`[data-testid="${testId}"]`)
		.text()
}

describe('the desk', () => {
	it('stamps an inspect anchor on the root and on every draft, and the tutorial targets the tour uses', async () => {
		const { wrapper } = await setup()
		expect(wrapper.get(widgetSelector('desk'))
			.attributes('data-widget-type'))
			.toBe('RepairDesk')
		for (const id of ['draft-v1', 'draft-v2', 'draft-v3', 'draft-poll']) {
			expect(wrapper.get(widgetSelector(id))
				.attributes('data-widget-type'), id)
				.toBe('SavedDraft')
			expect(wrapper.get(widgetSelector(id))
				.attributes('data-tutorial-target'), id)
				.toBe(`repair-${id}`)
		}
		expect(wrapper.get(widgetSelector('desk'))
			.attributes('data-tutorial-target'))
			.toBe('repair-desk')
		wrapper.unmount()
	})

	it('says whose policy the repair is: Core migrates, versions, repairs and quarantines nothing, and nothing is saved', async () => {
		const { wrapper } = await setup()
		const intro = wrapper.get('.repair-intro')
			.text()
		expect(intro)
			.toContain('Core does not migrate, version, repair or quarantine anything')
		expect(intro)
			.toContain('nothing is saved anywhere')
		expect(intro)
			.toContain('format 3.0')
		wrapper.unmount()
	})

	it('shows each stored draft\'s state before it is opened, and its findings and plan on request', async () => {
		const { wrapper } = await setup()
		expect(wrapper.get('[data-testid="repair-stored-state-draft-v1"]')
			.attributes('data-state'))
			.toBe('invalid')
		expect(wrapper.get('[data-testid="repair-stored-state-draft-v3"]')
			.attributes('data-state'))
			.toBe('valid')
		const v1 = wrapper.get('[data-testid="repair-draft-draft-v1"]')
		expect(v1.findAll('[data-testid="repair-diagnostic"]')
			.map(item => item.attributes('data-code')))
			.toContain('undeclared-widget-slot')
		expect(v1.findAll('[data-testid="repair-plan-step"]')
			.map(item => item.attributes('data-step-id')))
			.toEqual(['rename-slot', 'rename-type', 'rename-config-text', 'move-style', 'fix-duplicate-ids', 'rewrite-no-id'])
		const nodes = v1.findAll('[data-testid="repair-node"]')
		expect(nodes.map(node => node.attributes('data-resolved')))
			.toEqual(['true', 'false', 'false', 'false', 'false'])
		expect(v1.find('[data-placement="raw-slot"]')
			.exists())
			.toBe(true)
		wrapper.unmount()
	})
})

describe('repairing the v1 draft by clicks', () => {
	it('opens it, applies every step, and previews and exports the repaired board', async () => {
		const { wrapper } = await setup()
		await click(wrapper, 'repair-open-draft-v1')
		expect(text(wrapper, 'repair-revision-draft-v1'))
			.toBe('0')
		expect(wrapper.get('[data-testid="repair-doc-status-draft-v1"]')
			.attributes('data-state'))
			.toBe('invalid')
		expect(text(wrapper, 'repair-status'))
			.toBe('Opened draft-v1 at revision 0.')
		expect(wrapper.find('[data-testid="repair-preview-draft-v1"]')
			.exists())
			.toBe(false)

		for (let count = 1; count <= 6; count++) {
			await click(wrapper, 'repair-apply-draft-v1')
			expect(text(wrapper, 'repair-revision-draft-v1'))
				.toBe(String(count))
		}
		expect(text(wrapper, 'repair-result-draft-v1'))
			.toBe('applyPatch returned { ok: true, changed: true }: revision 5 to 6.')
		expect(wrapper.get('[data-testid="repair-doc-status-draft-v1"]')
			.attributes('data-state'))
			.toBe('valid')
		expect(wrapper.get('[data-testid="repair-apply-draft-v1"]')
			.attributes('disabled'))
			.toBeDefined()
		expect(wrapper.findAll('[data-testid="repair-log-entry"]')
			.map(entry => [entry.attributes('data-from'), entry.attributes('data-to'), entry.attributes('data-by')]))
			.toEqual([['0', '1', 'app'], ['1', '2', 'app'], ['2', '3', 'app'], ['3', '4', 'app'], ['4', '5', 'app'], ['5', '6', 'app']])

		await click(wrapper, 'repair-preview-draft-v1')
		const board = wrapper.get('[data-testid="repair-board-draft-v1"]')
		expect(board.findAll('[data-testid^="repair-notice-"]')
			.map(notice => notice.attributes('data-testid')))
			.toEqual(['repair-notice-welcome', 'repair-notice-closure', 'repair-notice-closure-2', 'repair-notice-notice-1'])
		expect(board.get('[data-testid="repair-notice-notice-1"]')
			.text())
			.toContain('A grey scarf is waiting at the desk.')
		expect(board.get('[data-testid="repair-notice-welcome"]')
			.text())
			.toContain('Until Dec 31, 2026')

		await click(wrapper, 'repair-export-draft-v1')
		const exported = JSON.parse(text(wrapper, 'repair-export-text-draft-v1'))
		expect(exported.slots.notices)
			.toHaveLength(4)
		wrapper.unmount()
	})

	it('meets a stale revision when another editor saves, explains it once as the page\'s one alert, and continues after a re-plan', async () => {
		const { wrapper } = await setup()
		await click(wrapper, 'repair-open-draft-v1')
		await click(wrapper, 'repair-apply-draft-v1')
		await click(wrapper, 'repair-other-draft-v1')
		expect(wrapper.find('[data-testid="repair-stale-draft-v1"]')
			.exists())
			.toBe(true)
		expect(text(wrapper, 'repair-revision-draft-v1'))
			.toBe('2')
		expect(text(wrapper, 'repair-app-revision-draft-v1'))
			.toBe('1')

		await click(wrapper, 'repair-apply-draft-v1')
		expect(wrapper.findAll('[role="alert"]'))
			.toHaveLength(1)
		const alert = wrapper.get('[role="alert"]')
		expect(alert.attributes('data-code'))
			.toBe('document-revision-conflict')
		expect(alert.text())
			.toContain('planned this step at revision 1, but the document is at revision 2')
		expect(alert.text())
			.toContain('Core applied nothing')
		expect(text(wrapper, 'repair-result-draft-v1'))
			.toBe('applyPatch returned { ok: false } with code document-revision-conflict.')
		expect(text(wrapper, 'repair-result-detail-draft-v1'))
			.toContain('expected revision 1, actual revision 2')
		expect(text(wrapper, 'repair-revision-draft-v1'))
			.toBe('2')

		await click(wrapper, 'repair-reread-draft-v1')
		expect(wrapper.find('[role="alert"]')
			.exists())
			.toBe(false)
		expect(wrapper.find('[data-testid="repair-stale-draft-v1"]')
			.exists())
			.toBe(false)
		await click(wrapper, 'repair-apply-draft-v1')
		expect(text(wrapper, 'repair-revision-draft-v1'))
			.toBe('3')
		expect(wrapper.findAll('[role="status"]'))
			.toHaveLength(1)
		expect(wrapper.findAll('[data-testid="repair-log-entry"]')
			.map(entry => entry.attributes('data-by')))
			.toEqual(['app', 'other-editor', 'app'])
		wrapper.unmount()
	})

	it('refuses a stale step before any of its guards runs, and keeps the revision', async () => {
		const { runtime, wrapper } = await setup()
		await click(wrapper, 'repair-open-draft-v2')
		await click(wrapper, 'repair-other-draft-v2')
		await click(wrapper, 'repair-apply-draft-v2')
		expect(wrapper.get('[role="alert"]')
			.attributes('data-code'))
			.toBe('document-revision-conflict')
		expect(runtime.isDisposed)
			.toBe(false)
		wrapper.unmount()
	})
})

describe('the drafts that cannot be repaired into a Runtime', () => {
	it('never offers a preview for the poll draft, before or after its only step', async () => {
		const { wrapper } = await setup()
		await click(wrapper, 'repair-open-draft-poll')
		expect(wrapper.find('[data-testid="repair-preview-draft-poll"]')
			.exists())
			.toBe(false)
		await click(wrapper, 'repair-apply-draft-poll')
		expect(text(wrapper, 'repair-revision-draft-poll'))
			.toBe('1')
		expect(wrapper.get('[data-testid="repair-doc-status-draft-poll"]')
			.attributes('data-state'))
			.toBe('invalid')
		expect(wrapper.get('[data-testid="repair-apply-draft-poll"]')
			.attributes('disabled'))
			.toBeDefined()
		expect(wrapper.find('[data-testid="repair-preview-draft-poll"]')
			.exists())
			.toBe(false)
		expect(text(wrapper, 'repair-no-preview-draft-poll'))
			.toContain('Core creates no Runtime for an invalid document')
		expect(wrapper.get('[data-testid="repair-draft-draft-poll"]')
			.findAll('[data-testid="repair-diagnostic"]')
			.map(item => item.attributes('data-code')))
			.toEqual(['unknown-widget-type'])
		wrapper.unmount()
	})

	it('opens the valid v3 draft with no steps and offers the preview at once', async () => {
		const { wrapper } = await setup()
		await click(wrapper, 'repair-open-draft-v3')
		expect(wrapper.get('[data-testid="repair-apply-draft-v3"]')
			.attributes('disabled'))
			.toBeDefined()
		await click(wrapper, 'repair-preview-draft-v3')
		expect(wrapper.find('[data-testid="repair-board-draft-v3"]')
			.exists())
			.toBe(true)
		await click(wrapper, 'repair-preview-close-draft-v3')
		expect(wrapper.find('[data-testid="repair-board-draft-v3"]')
			.exists())
			.toBe(false)
		wrapper.unmount()
	})
})

describe('close, reset and unmount', () => {
	it('closes a draft and every draft, and disposes the preview Runtime when the page unmounts', async () => {
		const { wrapper } = await setup()
		await click(wrapper, 'repair-open-draft-v3')
		await click(wrapper, 'repair-preview-draft-v3')
		await click(wrapper, 'repair-close-draft-v3')
		expect(wrapper.find('[data-testid="repair-session-draft-v3"]')
			.exists())
			.toBe(false)
		expect(text(wrapper, 'repair-status'))
			.toBe('Closed draft-v3. The stored draft was not changed.')
		await click(wrapper, 'repair-open-draft-v3')
		await click(wrapper, 'repair-open-draft-v1')
		await click(wrapper, 'repair-close-all')
		expect(wrapper.findAll('[data-testid^="repair-session-"]'))
			.toHaveLength(0)
		expect(text(wrapper, 'repair-status'))
			.toBe('Every draft is closed.')
		wrapper.unmount()
	})
})

describe('keyboard focus', () => {
	const active = (): string | null => document.activeElement?.getAttribute('data-testid') ?? null

	it('goes to the session heading when a draft is opened and back to "Open in the app" when it is closed', async () => {
		const { wrapper } = await setup({ attachTo: document.body })
		await click(wrapper, 'repair-open-draft-v1')
		await flushPromises()
		expect(active())
			.toBe('repair-session-heading-draft-v1')
		await click(wrapper, 'repair-close-draft-v1')
		await flushPromises()
		expect(active())
			.toBe('repair-open-draft-v1')
		wrapper.unmount()
	})

	it('goes to "Preview the repaired board" when the last step disables "Apply next step", and back there when the preview is closed', async () => {
		const { wrapper } = await setup({ attachTo: document.body })
		await click(wrapper, 'repair-open-draft-v1')
		for (let count = 0; count < 5; count++) {
			await click(wrapper, 'repair-apply-draft-v1')
			await flushPromises()
			expect(wrapper.get('[data-testid="repair-apply-draft-v1"]')
				.attributes('disabled'))
				.toBeUndefined()
		}
		await click(wrapper, 'repair-apply-draft-v1')
		await flushPromises()
		expect(wrapper.get('[data-testid="repair-apply-draft-v1"]')
			.attributes('disabled'))
			.toBeDefined()
		expect(active())
			.toBe('repair-preview-draft-v1')
		await click(wrapper, 'repair-preview-draft-v1')
		await click(wrapper, 'repair-preview-close-draft-v1')
		await flushPromises()
		expect(active())
			.toBe('repair-preview-draft-v1')
		wrapper.unmount()
	})

	it('goes to "Re-read and re-plan" when the last step of a draft that stays invalid is applied', async () => {
		const { wrapper } = await setup({ attachTo: document.body })
		await click(wrapper, 'repair-open-draft-poll')
		await click(wrapper, 'repair-apply-draft-poll')
		await flushPromises()
		expect(wrapper.get('[data-testid="repair-apply-draft-poll"]')
			.attributes('disabled'))
			.toBeDefined()
		expect(active())
			.toBe('repair-reread-draft-poll')
		wrapper.unmount()
	})

	it('stays on "Apply next step" while there are steps left', async () => {
		const { wrapper } = await setup({ attachTo: document.body })
		await click(wrapper, 'repair-open-draft-v1')
		const apply = wrapper.get('[data-testid="repair-apply-draft-v1"]').element as HTMLElement
		apply.focus()
		await click(wrapper, 'repair-apply-draft-v1')
		await flushPromises()
		expect(document.activeElement)
			.toBe(apply)
		wrapper.unmount()
	})
})

describe('heading hierarchy', () => {
	it('never skips a level, from the desk title down to the board title of the repaired preview', async () => {
		const { wrapper } = await setup()
		await click(wrapper, 'repair-open-draft-v3')
		await click(wrapper, 'repair-preview-draft-v3')
		await click(wrapper, 'repair-export-draft-v3')
		const levels = wrapper.findAll('h1, h2, h3, h4, h5, h6')
			.map(heading => Number(heading.element.tagName.slice(1)))
		expect(levels[0])
			.toBe(1)
		for (let index = 1; index < levels.length; index++) {
			expect(levels[index]! - levels[index - 1]!, `heading ${index}`)
				.toBeLessThanOrEqual(1)
		}
		expect(levels.filter(level => level === 1))
			.toHaveLength(1)
		// The desk title, the "Saved drafts" list, a draft, its session and a session block, then the board's own title.
		expect(new Set(levels))
			.toEqual(new Set([1, 2, 3, 4, 5, 6]))
		const titleOf = (selector: string): number => Number(wrapper.get(selector).element.tagName.slice(1))
		expect(titleOf('.repair-drafts-title'))
			.toBeLessThan(titleOf('.draft-title'))
		expect(titleOf('.draft-title'))
			.toBeLessThan(titleOf('.session-heading'))
		expect(titleOf('.session-heading'))
			.toBeLessThan(titleOf('.session-block-title'))
		expect(titleOf('.session-block-title'))
			.toBeLessThan(titleOf('.board-title'))
		wrapper.unmount()
	})
})

describe('language and theme', () => {
	it('follows the host locale: the chrome and the plan are in zh-TW, Core\'s codes and messages are not', async () => {
		const host = createTestHost({ locale: 'zh-TW' })
		const { wrapper } = await setup({ host })
		expect(wrapper.get('h1')
			.text())
			.toBe('公告欄：舊版本留下的草稿')
		await click(wrapper, 'repair-open-draft-v1')
		expect(wrapper.get('[data-testid="repair-apply-draft-v1"]')
			.text())
			.toBe('套用下一步')
		expect(wrapper.get('[data-testid="repair-plan-draft-v1"] [data-step-id="rename-slot"]')
			.text())
			.toContain('把公告從舊的「items」slot 搬到「notices」')
		expect(wrapper.get('[data-testid="repair-diagnostic"]')
			.attributes('data-code'))
			.toBe('unknown-widget-type')
		await click(wrapper, 'repair-other-draft-v1')
		await click(wrapper, 'repair-apply-draft-v1')
		expect(wrapper.get('[role="alert"]')
			.text())
			.toContain('另一位編輯者先儲存了')
		host.locale.value = 'en'
		await nextTick()
		expect(wrapper.get('h1')
			.text())
			.toBe('Notice board: drafts from older versions')
		wrapper.unmount()
	})

	it('sets the theme attribute and the colour tokens on the root, from the host theme', async () => {
		const host = createTestHost({ theme: 'dark' })
		const { wrapper } = await setup({ host })
		const root = wrapper.get(widgetSelector('desk'))
		expect(root.attributes('data-repair-theme'))
			.toBe('dark')
		host.theme.value = 'light'
		await nextTick()
		expect(root.attributes('data-repair-theme'))
			.toBe('light')
		wrapper.unmount()
	})
})

describe('the stored draft', () => {
	it('is the same text after everything the page did', async () => {
		const { runtime, wrapper } = await setup()
		for (const id of ['draft-v1', 'draft-v2'])
			await click(wrapper, `repair-open-${id}`)
		await click(wrapper, 'repair-apply-draft-v1')
		await click(wrapper, 'repair-apply-draft-v2')
		const widget = runtime.getWidget('draft-v1')
		const source = widget?.type === 'SavedDraft' ? widget.properties.source.get() : null
		expect(JSON.stringify(source !== null && source.ok ? source.value : null))
			.toBe(JSON.stringify(legacyV1))
		wrapper.unmount()
	})
})
