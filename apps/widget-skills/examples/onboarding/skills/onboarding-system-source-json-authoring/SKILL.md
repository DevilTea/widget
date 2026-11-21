---
name: onboarding-system-source-json-authoring
description: "Write or repair the JSON source of a onboardingSystem widget document: node grammar, per-type config, slots, the flat node-list schema for structured output, and how to validate and repair with Blueprint diagnostics."
---

# Authoring onboardingSystem documents

## Node grammar

A document is one root widget. A widget is a JSON object with these keys and no others:

- `id` (string): unique within the document.
- `type` (string): one of the types below.
- `config` (object): the type's raw config. Required unless the type's reference says it may be left out.
- `slots` (object): slot name to an array of child widgets, in order. Only the slots the type declares.
- `meta`: reserved for tools; do not write it, and keep it unchanged when editing a document that has it.

A complete document that compiles without diagnostics:

```json
{
  "id": "onboarding",
  "type": "Onboarding",
  "config": {
    "title": {
      "en": "Welcome to Tidepool Makers",
      "zh-TW": "歡迎加入潮池工坊"
    }
  },
  "slots": {
    "steps": [
      {
        "id": "account",
        "type": "AccountStep",
        "config": {
          "title": {
            "en": "Your details",
            "zh-TW": "你的資料"
          }
        }
      },
      {
        "id": "interests",
        "type": "InterestsStep",
        "config": {
          "title": {
            "en": "What do you want to make?",
            "zh-TW": "你想做什麼？"
          },
          "options": [
            {
              "id": "woodwork",
              "label": {
                "en": "Woodworking",
                "zh-TW": "木工"
              }
            },
            {
              "id": "printing",
              "label": {
                "en": "3D printing",
                "zh-TW": "3D 列印"
              }
            },
            {
              "id": "textiles",
              "label": {
                "en": "Textiles and sewing",
                "zh-TW": "布料與縫紉"
              }
            },
            {
              "id": "electronics",
              "label": {
                "en": "Electronics",
                "zh-TW": "電子"
              }
            },
            {
              "id": "ceramics",
              "label": {
                "en": "Ceramics",
                "zh-TW": "陶藝"
              }
            }
          ],
          "minimum": 1
        }
      },
      {
        "id": "safety",
        "type": "SafetyStep",
        "config": {
          "title": {
            "en": "Safety briefing",
            "zh-TW": "安全說明"
          },
          "rules": [
            {
              "id": "shoes",
              "text": {
                "en": "I wear closed shoes whenever I am in the workshop.",
                "zh-TW": "進入工作區時，我一定穿包鞋。"
              }
            },
            {
              "id": "machines",
              "text": {
                "en": "I ask a steward before I use a machine for the first time.",
                "zh-TW": "第一次使用機台前，我會先請管理員確認。"
              }
            },
            {
              "id": "exits",
              "text": {
                "en": "I know where the fire exit and the first-aid kit are.",
                "zh-TW": "我知道逃生出口和急救箱在哪裡。"
              }
            }
          ]
        }
      },
      {
        "id": "induction",
        "type": "InductionStep",
        "config": {
          "title": {
            "en": "Book your induction",
            "zh-TW": "預約新手導覽"
          },
          "days": [
            "2026-12-05",
            "2026-12-12",
            "2026-12-19"
          ],
          "times": [
            "10:00",
            "14:00",
            "17:00"
          ]
        }
      }
    ]
  }
}
```

## Types

- `Onboarding`: The root of the onboarding wizard. State: `current` (the index of the current step) and `finished`. Properties: `title`, `steps` (each step's title, `complete` and `missing`), `progress` and `answers`. Methods: `canEnter(index)` (read-only), `next()`, `back()`, `goTo(index)` (each writes `current` and emits `stepChanged`) and `finish()` (emits `completed`). A refused move is a Method diagnostic and changes nothing. See `references/onboarding.md`.
- `AccountStep`: Step 1 of the onboarding wizard: the visitor's name and e-mail address (State `name` and `email`, filled in as they type). Properties: `title`, `missing` (`name` and/or `email` while they are empty or not an address), `complete` and `answers`. See `references/account-step.md`.
- `InterestsStep`: Step 2 of the onboarding wizard: the interests the new member picks from the configured options (State `selected`: the picked ids). Properties: `title`, `options`, `missing` (`interests:<n>` while `n` more must be picked to reach `minimum`), `complete` and `answers` (the picked ids). See `references/interests-step.md`.
- `SafetyStep`: Step 3 of the onboarding wizard: the safety briefing. The visitor acknowledges each configured rule (State `acknowledged`: the ids acknowledged so far). Properties: `title`, `rules`, `missing` (one `rule:<id>` per rule not yet acknowledged), `complete` and `answers` (the acknowledged ids). See `references/safety-step.md`.
- `InductionStep`: Step 4 of the onboarding wizard: booking an induction slot, with the work kept at the host. Methods: `requestSlot(date, time)` (validated against the config; writes the request into State and emits `slotRequested` with a ticket), `settleBooking(ticket, outcome)` (the host's answer; applied only if the ticket is still the newest, otherwise ignored) and `cancelBooking()` (emits `slotCancelled`); `requestSlot` and `cancelBooking` are refused once the wizard is finished. Events: `slotRequested`, `slotConfirmed`, `slotDeclined`, `slotCancelled`. State: `status`, `ticket`, `slot`, `reference`, `reason`. See `references/induction-step.md`.

Which types a slot accepts, and which type may be the root, is stated in each slot's description and enforced by the compiler, not by the schemas.

## References between widgets

A config value that names another widget holds that widget's `id` (documented with `@widgetRef` in the type's
reference). The id must exist in the same document and be of a listed type.

## Structured output: the flat node list

When the output must follow a JSON Schema (tool input, structured output), use
`references/document.llm.schema.json` instead of the tree. It is sized for non-strict structured output and
only gets the structure roughly right.

- `{ "nodes": [{ "id", "type", "parent", "slot", "config" }] }`; exactly one node has no `parent` and no
  `slot` (the root).
- Children of one slot keep the order they have in `nodes`; list parents before children.
- Leave an optional key out; do not write `null` for it. Leave `config` out when the type takes none.
- `slots` (a list of slot names) is only needed to declare a slot that has no children.
- A dictionary (for example text per language) is a list of `{ "key", "value" }` entries.
- Limits (ranges, lengths, formats) are in the descriptions, not in schema keywords: read them.

### Converting the flat list to the tree

The conversion is mechanical. Do it in code, or by hand, exactly like this:

1. For every node create a widget `{ "id", "type" }`. Copy `config` if the node has the key, after rewriting it
   (step 4). Copy `meta` unchanged if present.
2. The one node without `parent` is the root. Zero or several such nodes, a `parent` that is not a node's id, a
   repeated id, or a node that cannot be reached from the root is an error: fix the list, do not guess.
3. For every other node, in list order, append its widget to `slots[slot]` of its parent's widget. If a node
   lists `slots`, create those slot arrays first, in that order, so a slot without children still exists.
4. In a config, wherever the type's reference shows a dictionary type, turn the entry list
   `[{ "key": "en", "value": "Hello" }]` into the object `{ "en": "Hello" }`. Leave everything else as it is.

The inverse (tree to flat) walks the tree depth-first, slot by slot, and applies step 4 in reverse.
`references/document.schema.json` is the full schema of the tree form.

## Validate and repair

The schemas only get the structure roughly right. The arbiter is the compiler:

1. `const blueprint = system.createBlueprint(tree)` (or `createBlueprintFromJson(text)`).
2. `blueprint.status` is `'valid'` or `'invalid'`; `blueprint.diagnostics` lists every problem.
3. Each diagnostic has a `code` (for example `invalid-widget-config`, `invalid-widget-structure`,
   `unexpected-widget-field`, `duplicate-widget-id`), a `message`, a location naming the widget, and for config
   problems a `path` into the config and a machine-readable `reason`.
4. Fix exactly what each diagnostic names, keep everything else, and compile again. Repeat until `valid`.
   Do not rewrite the document from scratch: an invalid document still compiles to an inspectable Blueprint, so
   the diagnostics are complete, not just the first error.
