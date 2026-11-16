/**
 * Survey-form ("Maker Space open day sign-up") preset source texts.
 *
 * Each preset is plain JSON source text that goes through the exact same Apply pipeline as manual
 * editing (`LabSession.applyPreset`): no bypass of `JSON.parse` or `WidgetSystem.createBlueprint`.
 * Only Core's recognized widget keys (`id`, `type`, `config`, `slots`) appear, so no preset trips
 * `unexpected-widget-field`, `duplicate-widget-id` or a JSON-domain violation.
 *
 * - `survey-default`: valid, with every feature (plain and conditional visibility and requiredness,
 *   option `enabledWhen` and `visibleWhen`, one custom rule, two languages, all four question types).
 *   Declared cross-question edges: `guests.visible -> mode.value`; `sessions.options -> mode.value,
 *   guests.value`; `sessions.errors -> sessions.value, guests.value`; `phone.required -> mode.value`.
 *   Nothing reads `mode`'s members except the root, so the default is acyclic.
 * - `survey-ai-draft`: "an AI draft" with one mistake per widget, so the five diagnostics do not hide
 *   one another (a widget whose config fails compiles through `resolve(null)` and is skipped by other
 *   widgets' option checks, see `plugins/check-question.ts`).
 * - `survey-cycle`: the default with `guests` shown only to people who picked the kids' corner, while
 *   the kids' corner is shown only to people who bring guests. Declared dependencies make the circle
 *   (`guests.visible -> sessions.value -> sessions.options -> guests.value -> guests.visible`) a
 *   `property-evaluation-cycle` when the Blueprint is compiled.
 */

export interface SurveyPreset {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly sourceText: string
}

const DEFAULT_SOURCE = `{
  "id": "open-day",
  "type": "Survey",
  "config": {
    "title": { "en": "Maker Space open day: sign-up", "zh-TW": "創客空間開放日報名" },
    "languages": ["en", "zh-TW"]
  },
  "slots": {
    "questions": [
      {
        "id": "mode",
        "type": "SingleChoice",
        "config": {
          "label": { "en": "How will you join?", "zh-TW": "您會如何參加？" },
          "required": true,
          "options": [
            { "value": "onsite", "label": { "en": "On site", "zh-TW": "現場參加" } },
            { "value": "online", "label": { "en": "Online", "zh-TW": "線上參加" } }
          ]
        }
      },
      {
        "id": "guests",
        "type": "Numeric",
        "config": {
          "label": { "en": "Guests coming with you", "zh-TW": "同行人數" },
          "visibleWhen": { "question": "mode", "op": "equals", "value": "onsite" },
          "required": true,
          "min": 0,
          "max": 3,
          "integer": true
        }
      },
      {
        "id": "sessions",
        "type": "MultipleChoice",
        "config": {
          "label": { "en": "Sessions you want to join", "zh-TW": "想參加的場次" },
          "help": { "en": "Pick one or two.", "zh-TW": "請選一到兩個。" },
          "required": true,
          "minSelected": 1,
          "maxSelected": 2,
          "options": [
            { "value": "printing", "label": { "en": "3D printing basics", "zh-TW": "3D 列印入門" } },
            {
              "value": "laser",
              "label": { "en": "Laser cutting", "zh-TW": "雷射切割" },
              "enabledWhen": { "question": "mode", "op": "equals", "value": "onsite" }
            },
            {
              "value": "kids",
              "label": { "en": "Kids' corner", "zh-TW": "親子區" },
              "visibleWhen": { "question": "guests", "op": "greaterThan", "value": 0 }
            }
          ],
          "rules": [
            {
              "when": {
                "all": [
                  { "question": "sessions", "op": "includes", "value": "laser" },
                  { "question": "guests", "op": "greaterThan", "value": 2 }
                ]
              },
              "message": { "en": "Laser cutting has room for at most 2 guests.", "zh-TW": "雷射切割最多只能帶 2 位同行者。" }
            }
          ]
        }
      },
      {
        "id": "phone",
        "type": "ShortAnswer",
        "config": {
          "label": { "en": "Phone number", "zh-TW": "聯絡電話" },
          "help": { "en": "Needed for on-site visitors.", "zh-TW": "現場參加者必填。" },
          "required": { "question": "mode", "op": "equals", "value": "onsite" },
          "maxLength": 20
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

const GUESTS_VISIBLE_WHEN = '"visibleWhen": { "question": "mode", "op": "equals", "value": "onsite" },'

const AI_DRAFT_SOURCE = [
	// `mode`: an empty option list -> invalid-widget-config at ['options'].
	(source: string) => replaceOnce(source, `"options": [
            { "value": "onsite", "label": { "en": "On site", "zh-TW": "現場參加" } },
            { "value": "online", "label": { "en": "Online", "zh-TW": "線上參加" } }
          ]`, '"options": []'),
	// `guests`: a condition naming a question that does not exist -> missing-dependency-target.
	(source: string) => replaceOnce(source, GUESTS_VISIBLE_WHEN, '"visibleWhen": { "question": "mod", "op": "equals", "value": "onsite" },'),
	// `phone`: greaterThan on a SingleChoice -> invalid-widget-structure (condition-type-mismatch).
	(source: string) => replaceOnce(source, '"required": { "question": "mode", "op": "equals", "value": "onsite" },', '"required": { "question": "mode", "op": "greaterThan", "value": 1 },'),
	// `sessions`: an option label without zh-TW -> invalid-widget-structure (missing-translation).
	(source: string) => replaceOnce(source, '"label": { "en": "Kids\' corner", "zh-TW": "親子區" }', '"label": { "en": "Kids\' corner" }'),
	// A fifth question of a type that is not registered -> unknown-widget-type.
	(source: string) => replaceOnce(source, `"maxLength": 20
        }
      }
    ]`, `"maxLength": 20
        }
      },
      {
        "id": "rating",
        "type": "StarRating",
        "config": { "label": { "en": "How would you rate the open day?", "zh-TW": "您如何評價這次開放日？" }, "stars": 5 }
      }
    ]`),
].reduce((source, edit) => edit(source), DEFAULT_SOURCE)

// `guests` shown only to people who picked the kids' corner, while the kids' corner needs guests.
const CYCLE_SOURCE = replaceOnce(DEFAULT_SOURCE, GUESTS_VISIBLE_WHEN, '"visibleWhen": { "question": "sessions", "op": "includes", "value": "kids" },')

export const surveyPresets: readonly SurveyPreset[] = [
	{
		id: 'survey-default',
		label: 'Default — open day sign-up',
		description: 'A valid Maker Space open day sign-up: plain and conditional visibility and requiredness, option conditions, one custom rule, two languages, all four question types.',
		sourceText: DEFAULT_SOURCE,
	},
	{
		id: 'survey-ai-draft',
		label: 'AI draft — five mistakes',
		description: 'The default with five deliberate mistakes, one per widget: an empty option list, a condition on a question that does not exist, an operator that does not fit its target, a missing translation and an unknown question type. Each is a located diagnostic.',
		sourceText: AI_DRAFT_SOURCE,
	},
	{
		id: 'survey-cycle',
		label: 'Cycle — Guests ↔ Kids\' corner',
		description: 'The default where Guests is shown only to people who picked the kids\' corner, while the kids\' corner is shown only to people who bring guests. The conditions form a loop, so the Blueprint is invalid with four property-evaluation-cycle diagnostics.',
		sourceText: CYCLE_SOURCE,
	},
]

export const defaultSurveyPreset: SurveyPreset = surveyPresets[0]!
