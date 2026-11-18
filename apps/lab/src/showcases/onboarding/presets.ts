/**
 * Onboarding ("Tidepool Makers" new-member onboarding) preset source texts.
 *
 * Each preset is plain JSON source text that goes through the exact same Apply pipeline as manual editing
 * (`LabSession.applyPreset`): no bypass of `JSON.parse` or `WidgetSystem.createBlueprint`. Only Core's recognized
 * widget keys (`id`, `type`, `config`, `slots`) appear.
 *
 * - `onboarding-default`: valid. A fresh wizard: account details, interests, a three-rule safety briefing and an
 *   induction slot (Saturdays in December, three start times). The simulated booking office is fully booked at 17:00.
 * - `onboarding-ready-to-book`: valid. The first three steps are already complete and the wizard opens on the
 *   induction, so a slot can be requested, declined (17:00), cancelled and finished within a few clicks.
 * - `onboarding-deep-link`: valid, but the wizard opens on the induction step (`startStep: 3`) with nothing filled in,
 *   as a link from an e-mail would. Jumping forward, Next and Finish are refused by the Methods; going back works.
 * - `onboarding-invalid`: the default with four mistakes in four widgets: `minimum` above the number of options, a
 *   safety rule acknowledged at the start that does not exist, an induction day that is not a real date and a
 *   `startStep` beyond the last step. Each is a located diagnostic.
 */

export interface OnboardingPreset {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly sourceText: string
}

const DEFAULT_SOURCE = `{
  "id": "onboarding",
  "type": "Onboarding",
  "config": { "title": { "en": "Welcome to Tidepool Makers", "zh-TW": "歡迎加入潮池工坊" } },
  "slots": {
    "steps": [
      {
        "id": "account",
        "type": "AccountStep",
        "config": { "title": { "en": "Your details", "zh-TW": "你的資料" } }
      },
      {
        "id": "interests",
        "type": "InterestsStep",
        "config": {
          "title": { "en": "What do you want to make?", "zh-TW": "你想做什麼？" },
          "options": [
            { "id": "woodwork", "label": { "en": "Woodworking", "zh-TW": "木工" } },
            { "id": "printing", "label": { "en": "3D printing", "zh-TW": "3D 列印" } },
            { "id": "textiles", "label": { "en": "Textiles and sewing", "zh-TW": "布料與縫紉" } },
            { "id": "electronics", "label": { "en": "Electronics", "zh-TW": "電子" } },
            { "id": "ceramics", "label": { "en": "Ceramics", "zh-TW": "陶藝" } }
          ],
          "minimum": 1
        }
      },
      {
        "id": "safety",
        "type": "SafetyStep",
        "config": {
          "title": { "en": "Safety briefing", "zh-TW": "安全說明" },
          "rules": [
            { "id": "shoes", "text": { "en": "I wear closed shoes whenever I am in the workshop.", "zh-TW": "進入工作區時，我一定穿包鞋。" } },
            { "id": "machines", "text": { "en": "I ask a steward before I use a machine for the first time.", "zh-TW": "第一次使用機台前，我會先請管理員確認。" } },
            { "id": "exits", "text": { "en": "I know where the fire exit and the first-aid kit are.", "zh-TW": "我知道逃生出口和急救箱在哪裡。" } }
          ]
        }
      },
      {
        "id": "induction",
        "type": "InductionStep",
        "config": {
          "title": { "en": "Book your induction", "zh-TW": "預約新手導覽" },
          "days": ["2026-12-05", "2026-12-12", "2026-12-19"],
          "times": ["10:00", "14:00", "17:00"]
        }
      }
    ]
  }
}`

/** Replaces `search` with `replacement`, which must occur exactly once so a preset edit cannot silently miss. */
function replaceOnce(source: string, search: string, replacement: string): string {
	const index = source.indexOf(search)
	if (index === -1 || source.includes(search, index + search.length))
		throw new Error(`Expected exactly one occurrence of ${JSON.stringify(search)} in the preset source.`)
	return source.slice(0, index) + replacement + source.slice(index + search.length)
}

const READY_TO_BOOK_SOURCE = [
	(source: string) => replaceOnce(source, '"config": { "title": { "en": "Your details", "zh-TW": "你的資料" } }', '"config": { "title": { "en": "Your details", "zh-TW": "你的資料" }, "prefill": { "name": "Sam Rivera", "email": "sam@example.org" } }'),
	(source: string) => replaceOnce(source, '"minimum": 1', '"minimum": 1,\n          "preselected": ["woodwork", "ceramics"]'),
	(source: string) => replaceOnce(source, '\n        }\n      },\n      {\n        "id": "induction"', ',\n          "acknowledged": ["shoes", "machines", "exits"]\n        }\n      },\n      {\n        "id": "induction"'),
	(source: string) => replaceOnce(source, '"config": { "title": { "en": "Welcome to Tidepool Makers", "zh-TW": "歡迎加入潮池工坊" } }', '"config": { "title": { "en": "Welcome to Tidepool Makers", "zh-TW": "歡迎加入潮池工坊" }, "startStep": 3 }'),
].reduce((source, edit) => edit(source), DEFAULT_SOURCE)

const DEEP_LINK_SOURCE = replaceOnce(DEFAULT_SOURCE, '"config": { "title": { "en": "Welcome to Tidepool Makers", "zh-TW": "歡迎加入潮池工坊" } }', '"config": { "title": { "en": "Welcome to Tidepool Makers", "zh-TW": "歡迎加入潮池工坊" }, "startStep": 3 }')

const INVALID_SOURCE = [
	// `interests`: a minimum of 9 with five options -> invalid-widget-config at ['minimum'].
	(source: string) => replaceOnce(source, '"minimum": 1', '"minimum": 9'),
	// `safety`: a rule acknowledged at the start that does not exist -> invalid-widget-config at ['acknowledged', 0].
	(source: string) => replaceOnce(source, '\n        }\n      },\n      {\n        "id": "induction"', ',\n          "acknowledged": ["helmet"]\n        }\n      },\n      {\n        "id": "induction"'),
	// `induction`: a day that is not on the calendar -> invalid-widget-config at ['days', 1].
	(source: string) => replaceOnce(source, '"2026-12-12"', '"2026-02-30"'),
	// `onboarding`: opens on a step that does not exist -> invalid-widget-structure (start-step-out-of-range).
	(source: string) => replaceOnce(source, '"config": { "title": { "en": "Welcome to Tidepool Makers", "zh-TW": "歡迎加入潮池工坊" } }', '"config": { "title": { "en": "Welcome to Tidepool Makers", "zh-TW": "歡迎加入潮池工坊" }, "startStep": 7 }'),
].reduce((source, edit) => edit(source), DEFAULT_SOURCE)

export const onboardingPresets: readonly OnboardingPreset[] = [
	{
		id: 'onboarding-default',
		label: 'Default — Tidepool Makers onboarding',
		description: 'A valid wizard: your details, interests, a three-rule safety briefing and an induction slot to book. Booking is asked of a simulated office that the page, not the widget, waits for.',
		sourceText: DEFAULT_SOURCE,
	},
	{
		id: 'onboarding-ready-to-book',
		label: 'Ready to book — only the induction left',
		description: 'The first three steps are complete and the wizard opens on the induction: request a slot, see the office decline 17:00, cancel, and finish.',
		sourceText: READY_TO_BOOK_SOURCE,
	},
	{
		id: 'onboarding-deep-link',
		label: 'Deep link — opens on step 4, nothing filled in',
		description: 'A valid wizard that opens on the induction step with nothing filled in. Going forward is refused by the Methods (a Method failure, nothing changes); going back works.',
		sourceText: DEEP_LINK_SOURCE,
	},
	{
		id: 'onboarding-invalid',
		label: 'Draft with mistakes — four problems',
		description: 'The default with four deliberate mistakes in four widgets: a minimum above the number of options, an acknowledged rule that does not exist, an induction day that is not a real date and a start step beyond the last. Each is a located diagnostic.',
		sourceText: INVALID_SOURCE,
	},
]

export const defaultOnboardingPreset: OnboardingPreset = onboardingPresets[0]!
