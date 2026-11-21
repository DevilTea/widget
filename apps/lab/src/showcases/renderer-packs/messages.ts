/**
 * The renderer packs' own presentation text, selected by the host's locale (`showcase-host`). It is the wording of the page's
 * frame and controls, in BOTH packs, not of the document: labels, titles, options and notifications are the document's own
 * `{ en, zh-TW }` texts, and a validation message is the plugin's (`textProblem`). The packs pick them with `localize()`.
 *
 * `{name}` marks a value the renderer fills in with `fill()`.
 */

import { defineShowcaseMessages } from '../../showcase-host'

export const packsMessages = defineShowcaseMessages({
	'en': {
		title: 'One document, two renderer packs',
		intro: 'One Document and one Runtime, drawn by two renderer packs: hand-written controls and a component library (Nuxt UI). Switching the pack replaces the controls and keeps the Runtime, so every value stays.',
		packsLabel: 'Renderer pack',
		packHand: 'Hand-written',
		packNui: 'Nuxt UI',
		packBoth: 'Side by side',
		paneHand: 'Hand-written controls',
		paneNui: 'Nuxt UI components',
		paneLoading: 'Loading the Nuxt UI pack…',
		paneNote: 'The pack is a host choice, not widget State: the Runtime panel will not show it.',
		appearanceHeading: 'Appearance',
		densityLabel: 'Density',
		densityComfortable: 'Comfortable',
		densityCompact: 'Compact',
		modeLabel: 'Colour mode',
		modeAuto: 'Follow the host theme',
		modeLight: 'Light',
		modeDark: 'Dark',
		notifierHeading: 'Notifications',
		notifierEmpty: 'Nothing has been reported yet.',
		dismiss: 'Dismiss',
		dismissNamed: 'Dismiss: {text}',
		toneInfo: 'Info',
		toneSuccess: 'Done',
		toneDanger: 'Warning',
		confirmTitle: 'Please confirm',
		confirm: 'Confirm',
		cancel: 'Cancel',
		confirmingElsewhere: 'The confirmation is open in the other pane.',
		characters: '{count} / {max} characters',
		selectPlaceholder: 'Choose…',
	},
	'zh-TW': {
		title: '一份文件，兩組 renderer pack',
		intro: '同一份文件、同一個 Runtime，由兩組 renderer pack 繪製：手寫的控制項，以及元件庫（Nuxt UI）。切換 pack 只會換掉控制項，Runtime 仍然留著，所以每個值都不會變。',
		packsLabel: 'Renderer pack 選擇',
		packHand: '手寫',
		packNui: 'Nuxt UI 元件庫',
		packBoth: '並排',
		paneHand: '手寫控制項',
		paneNui: 'Nuxt UI 元件',
		paneLoading: '正在載入 Nuxt UI pack⋯⋯',
		paneNote: 'pack 是宿主的選擇，不是 widget 的 State，所以 Runtime 面板不會顯示它。',
		appearanceHeading: '外觀',
		densityLabel: '密度',
		densityComfortable: '寬鬆',
		densityCompact: '緊湊',
		modeLabel: '色彩模式',
		modeAuto: '跟隨宿主主題',
		modeLight: '亮色',
		modeDark: '深色',
		notifierHeading: '通知',
		notifierEmpty: '目前還沒有通知。',
		dismiss: '關閉',
		dismissNamed: '關閉：{text}',
		toneInfo: '資訊',
		toneSuccess: '完成',
		toneDanger: '警告',
		confirmTitle: '請確認',
		confirm: '確認',
		cancel: '取消',
		confirmingElsewhere: '確認視窗開在另一個窗格。',
		characters: '{count} / {max} 個字元',
		selectPlaceholder: '請選擇⋯⋯',
	},
})

export type PacksMessageKey = keyof typeof packsMessages['en']

export const TONE_MESSAGE_KEYS = { info: 'toneInfo', success: 'toneSuccess', danger: 'toneDanger' } as const satisfies Record<string, PacksMessageKey>
export const DENSITY_MESSAGE_KEYS = { comfortable: 'densityComfortable', compact: 'densityCompact' } as const satisfies Record<string, PacksMessageKey>
export const MODE_MESSAGE_KEYS = { auto: 'modeAuto', light: 'modeLight', dark: 'modeDark' } as const satisfies Record<string, PacksMessageKey>
