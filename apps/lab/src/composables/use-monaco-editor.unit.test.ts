// @vitest-environment happy-dom

/**
 * The editor's commit action (Cmd/Ctrl+Enter; it was Apply until Lab UX phase 3) is registered under a name in the Lab
 * language (issue #230 PR 3b, carried over from PR 3a), and re-registered, not duplicated, when the language changes. The
 * editor reports focus and blur, so the JSON view can commit on blur and group a focus session's commits into one Undo
 * entry, and it reports a blur when it goes away while focused. `modern-monaco` is replaced by a recording fake: this pins
 * the Lab's integration contract, not Monaco.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import MonacoJsonEditor from '../components/editor/MonacoJsonEditor.vue'
import { translatePresentationMessage } from '../i18n/presentation-messages'
import { LabI18nKey } from './use-lab-i18n'
import { LabThemeKey } from './use-lab-theme'

interface RecordedAction {
	readonly id: string
	readonly label: string
	readonly keybindings: readonly number[]
	disposed: boolean
	readonly run: () => void
}

const actions: RecordedAction[] = []
const focusListeners: (() => void)[] = []
const blurListeners: (() => void)[] = []
const widgetFocus = { value: false }

vi.mock('modern-monaco/core', () => {
	const model = {
		updateOptions: () => {},
		getValue: () => '',
		setValue: () => {},
		getPositionAt: () => ({ lineNumber: 1, column: 1 }),
		dispose: () => {},
	}
	const editor = {
		onDidChangeModelContent: () => ({ dispose: () => {} }),
		onDidFocusEditorWidget: (listener: () => void) => {
			focusListeners.push(listener)
			return { dispose: () => {} }
		},
		onDidBlurEditorWidget: (listener: () => void) => {
			blurListeners.push(listener)
			return { dispose: () => {} }
		},
		hasWidgetFocus: () => widgetFocus.value,
		createDecorationsCollection: () => ({ set: () => {} }),
		addAction: (descriptor: { id: string, label: string, keybindings: number[], run: () => void }) => {
			const recorded: RecordedAction = { ...descriptor, disposed: false }
			actions.push(recorded)
			return { dispose: () => void (recorded.disposed = true) }
		},
		setSelection: () => {},
		revealRangeInCenterIfOutsideViewport: () => {},
		focus: () => {},
		dispose: () => {},
	}
	return {
		init: async () => ({
			editor: { setTheme: () => {}, createModel: () => model, create: () => editor },
			KeyMod: { CtrlCmd: 2048 },
			KeyCode: { Enter: 3 },
		}),
	}
})

function mountEditor(initial: 'en' | 'zh-TW') {
	actions.length = 0
	focusListeners.length = 0
	blurListeners.length = 0
	widgetFocus.value = false
	const locale = shallowRef<'en' | 'zh-TW'>(initial)
	const committed = vi.fn()
	const focused = vi.fn()
	const blurred = vi.fn()
	const wrapper = mount(MonacoJsonEditor, {
		props: { modelValue: '{}', onCommit: committed, onFocus: focused, onBlur: blurred },
		global: {
			provide: {
				[LabI18nKey as symbol]: {
					locale,
					locales: ['en', 'zh-TW'],
					setLocale: (next: 'en' | 'zh-TW') => void (locale.value = next),
					t: (source: string) => translatePresentationMessage(locale.value, source),
				},
				[LabThemeKey as symbol]: { theme: shallowRef('light'), themes: ['light', 'dark'], setTheme: () => {} },
			},
		},
	})
	return { wrapper, locale, committed, focused, blurred }
}

describe('monaco commit action', () => {
	it('is named in the Lab language, bound to Cmd/Ctrl+Enter, and commits', async () => {
		const { committed } = mountEditor('zh-TW')
		await flushPromises()

		expect(actions)
			.toHaveLength(1)
		expect(actions[0]!.label)
			.toBe('立即套用 JSON')
		expect(actions[0]!.keybindings)
			.toEqual([2048 | 3])
		actions[0]!.run()
		expect(committed)
			.toHaveBeenCalledTimes(1)
	})

	it('keeps English in an English Lab', async () => {
		mountEditor('en')
		await flushPromises()

		expect(actions.map(action => action.label))
			.toEqual(['Apply the JSON now'])
	})

	it('is re-registered under the new name when the language changes, releasing the old one', async () => {
		const { locale } = mountEditor('en')
		await flushPromises()
		expect(actions.map(action => action.label))
			.toEqual(['Apply the JSON now'])

		locale.value = 'zh-TW'
		await flushPromises()

		expect(actions.map(action => [action.label, action.disposed]))
			.toEqual([['Apply the JSON now', true], ['立即套用 JSON', false]])
	})

	it('releases the action when the editor goes away', async () => {
		const { wrapper } = mountEditor('en')
		await flushPromises()
		wrapper.unmount()

		expect(actions.every(action => action.disposed))
			.toBe(true)
	})
})

describe('monaco focus and blur (Lab UX phase 3)', () => {
	it('reports focus and blur of the editor widget', async () => {
		const { focused, blurred } = mountEditor('en')
		await flushPromises()

		focusListeners.forEach(listener => listener())
		blurListeners.forEach(listener => listener())
		expect(focused)
			.toHaveBeenCalledTimes(1)
		expect(blurred)
			.toHaveBeenCalledTimes(1)
	})

	// Phase 3A review: the window or tab losing focus blurs the editor too, but the user did not leave it (alt-tab and back).
	it('ignores the blur of the window or tab losing focus', async () => {
		const { blurred } = mountEditor('en')
		await flushPromises()
		const hasFocus = vi.spyOn(document, 'hasFocus')
			.mockReturnValue(false)
		blurListeners.forEach(listener => listener())
		expect(blurred).not.toHaveBeenCalled()
		hasFocus.mockReturnValue(true)
		blurListeners.forEach(listener => listener())
		expect(blurred)
			.toHaveBeenCalledTimes(1)
		hasFocus.mockRestore()
	})

	it('reports a blur when it goes away while focused, and none when it was not focused', async () => {
		const first = mountEditor('en')
		await flushPromises()
		widgetFocus.value = true
		first.wrapper.unmount()
		expect(first.blurred)
			.toHaveBeenCalledTimes(1)

		const second = mountEditor('en')
		await flushPromises()
		second.wrapper.unmount()
		expect(second.blurred).not.toHaveBeenCalled()
	})
})
