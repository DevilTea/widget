/**
 * One document, two renderer packs: preset source texts. Each is plain JSON source text that goes through the same Apply
 * pipeline as manual editing; only Core's recognized widget keys appear.
 *
 * - `packs-default`: valid. A small workspace settings page: an Appearance and a Notifier (the capability widgets, in `providers`),
 *   and three Sections of fields (two text fields and a choice, two switches, two dangerous actions). Every field and action
 *   names the widgets it reads or reports to by id (`appearance`, `notifier`).
 * - `packs-invalid`: the default with four located diagnostics: a DangerAction whose `notifier` names no widget, a field whose
 *   `appearance` names no widget, a field whose `appearance` names a Notifier, and a text field whose `maxLength` is not a number
 *   of at least 1.
 */

export interface PacksPreset {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly sourceText: string
}

interface WidgetSource {
	readonly id: string
	readonly type: string
	readonly config?: Record<string, unknown>
	readonly slots?: Record<string, readonly WidgetSource[]>
}

function text(en: string, zhTW: string): { readonly 'en': string, 'zh-TW': string } {
	return { 'en': en, 'zh-TW': zhTW }
}

function settings(overrides: { readonly workspace?: Record<string, unknown>, readonly tagline?: Record<string, unknown>, readonly beta?: Record<string, unknown>, readonly archive?: Record<string, unknown> } = {}): WidgetSource {
	return {
		id: 'settings',
		type: 'SettingsPage',
		config: { title: text('Workspace settings', '工作區設定') },
		slots: {
			providers: [
				{ id: 'appearance', type: 'Appearance', config: { density: 'comfortable', mode: 'auto' } },
				{ id: 'notifier', type: 'Notifier', config: { limit: 4 } },
			],
			sections: [
				{
					id: 'profile',
					type: 'Section',
					config: { title: text('Profile', '基本資料'), description: text('How the workspace introduces itself.', '工作區如何介紹自己。') },
					slots: {
						fields: [
							{
								id: 'workspace-name',
								type: 'TextField',
								config: { label: text('Workspace name', '工作區名稱'), placeholder: text('For example, Harbour Studio', '例如：港灣工作室'), maxLength: 24, appearance: 'appearance', value: 'Harbour Studio', ...overrides.workspace },
							},
							{
								id: 'tagline',
								type: 'TextField',
								config: { label: text('Tagline', '標語'), placeholder: text('One short sentence', '一句簡短的話'), maxLength: 40, appearance: 'appearance', ...overrides.tagline },
							},
							{
								id: 'week-start',
								type: 'Choice',
								config: {
									label: text('Week starts on', '每週從哪天開始'),
									appearance: 'appearance',
									options: [
										{ value: 'monday', label: text('Monday', '星期一') },
										{ value: 'sunday', label: text('Sunday', '星期日') },
										{ value: 'saturday', label: text('Saturday', '星期六') },
									],
									value: 'monday',
								},
							},
						],
					},
				},
				{
					id: 'preferences',
					type: 'Section',
					config: { title: text('Preferences', '偏好設定') },
					slots: {
						fields: [
							{ id: 'digest', type: 'Toggle', config: { label: text('Send a weekly digest', '每週寄送摘要'), appearance: 'appearance', on: true } },
							{ id: 'beta', type: 'Toggle', config: { label: text('Try early-access features', '試用搶先體驗功能'), appearance: 'appearance', ...overrides.beta } },
						],
					},
				},
				{
					id: 'danger',
					type: 'Section',
					config: { title: text('Danger zone', '危險區域'), description: text('These actions only leave a notification; the demo changes nothing else.', '這些動作只會留下一則通知，示範不會更動其他東西。') },
					slots: {
						fields: [
							{
								id: 'clear-cache',
								type: 'DangerAction',
								config: {
									label: text('Clear local cache', '清除本機快取'),
									confirmText: text('Clear the local cache of this workspace?', '要清除這個工作區的本機快取嗎？'),
									message: text('Local cache cleared.', '已清除本機快取。'),
									tone: 'success',
									notifier: 'notifier',
									appearance: 'appearance',
								},
							},
							{
								id: 'archive-workspace',
								type: 'DangerAction',
								config: {
									label: text('Archive workspace', '封存工作區'),
									confirmText: text('Archive this workspace? Members lose access until it is restored.', '要封存這個工作區嗎？在還原之前，成員都無法存取。'),
									message: text('Workspace archived.', '工作區已封存。'),
									tone: 'danger',
									notifier: 'notifier',
									appearance: 'appearance',
									...overrides.archive,
								},
							},
						],
					},
				},
			],
		},
	}
}

const DEFAULT_SOURCE = JSON.stringify(settings(), null, 2)

const INVALID_SOURCE = JSON.stringify(settings({
	// `workspace-name`: a limit that is not a number of at least 1 -> invalid-widget-config at ['maxLength'].
	workspace: { maxLength: 0 },
	// `tagline`: names an Appearance that is not in the document -> invalid-widget-structure `unknown-appearance`.
	tagline: { appearance: 'look-and-feel' },
	// `beta`: names a widget that is a Notifier, not an Appearance -> `not-an-appearance`.
	beta: { appearance: 'notifier' },
	// `archive-workspace`: reports to a Notifier that is not in the document -> `unknown-notifier`.
	archive: { notifier: 'notification-center' },
}), null, 2)

export const packsPresets: readonly PacksPreset[] = [
	{
		id: 'packs-default',
		label: 'Default — workspace settings in two renderer packs',
		description: 'A valid workspace settings page: an Appearance and a Notifier as capability widgets, and fields that name them by id. The preview draws it with hand-written controls or with Nuxt UI, one at a time or side by side, from the same Runtime.',
		sourceText: DEFAULT_SOURCE,
	},
	{
		id: 'packs-invalid',
		label: 'Draft with mistakes — four problems',
		description: 'The settings document is invalid: a text field with a limit of 0, a field that reads an Appearance that does not exist, a field that names a Notifier as its Appearance, and a dangerous action that reports to a Notifier that does not exist. Each is a located diagnostic.',
		sourceText: INVALID_SOURCE,
	},
]

export const defaultPacksPreset: PacksPreset = packsPresets[0]!
