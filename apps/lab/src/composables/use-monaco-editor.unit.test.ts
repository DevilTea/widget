// @vitest-environment happy-dom

/**
 * The editor's Apply action (Cmd/Ctrl+Enter) is registered under a name in the Lab language (issue #230 PR 3b,
 * carried over from PR 3a), and re-registered, not duplicated, when the language changes. `modern-monaco` is
 * replaced by a recording fake: this pins the Lab's integration contract, not Monaco.
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
	const locale = shallowRef<'en' | 'zh-TW'>(initial)
	const applied = vi.fn()
	const wrapper = mount(MonacoJsonEditor, {
		props: { modelValue: '{}', onApply: applied },
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
	return { wrapper, locale, applied }
}

describe('monaco Apply action label', () => {
	it('is named in the Lab language, bound to Cmd/Ctrl+Enter, and runs Apply', async () => {
		actions.length = 0
		const { applied } = mountEditor('zh-TW')
		await flushPromises()

		expect(actions)
			.toHaveLength(1)
		expect(actions[0]!.label)
			.toBe('套用')
		expect(actions[0]!.keybindings)
			.toEqual([2048 | 3])
		actions[0]!.run()
		expect(applied)
			.toHaveBeenCalledTimes(1)
	})

	it('keeps English in an English Lab', async () => {
		actions.length = 0
		mountEditor('en')
		await flushPromises()

		expect(actions.map(action => action.label))
			.toEqual(['Apply'])
	})

	it('is re-registered under the new name when the language changes, releasing the old one', async () => {
		actions.length = 0
		const { locale } = mountEditor('en')
		await flushPromises()
		expect(actions.map(action => action.label))
			.toEqual(['Apply'])

		locale.value = 'zh-TW'
		await flushPromises()

		expect(actions.map(action => [action.label, action.disposed]))
			.toEqual([['Apply', true], ['套用', false]])
	})

	it('releases the action when the editor goes away', async () => {
		actions.length = 0
		const { wrapper } = mountEditor('en')
		await flushPromises()
		wrapper.unmount()

		expect(actions.every(action => action.disposed))
			.toBe(true)
	})
})
