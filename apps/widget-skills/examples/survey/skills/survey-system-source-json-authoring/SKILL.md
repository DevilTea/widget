---
name: survey-system-source-json-authoring
description: "Write or repair the JSON source of a surveySystem widget document: node grammar, per-type config, slots, the flat node-list schema for structured output, and how to validate and repair with Blueprint diagnostics."
---

# Authoring surveySystem documents

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
  "id": "survey",
  "type": "Survey",
  "config": {
    "title": {
      "en": "How was the workshop?",
      "zh-TW": "工作坊體驗如何？"
    },
    "maxQuestions": 5
  },
  "slots": {
    "header": [
      {
        "id": "intro",
        "type": "Note",
        "config": {
          "text": {
            "en": "Two questions, one minute."
          }
        }
      }
    ],
    "questions": [
      {
        "id": "overall",
        "type": "Rating",
        "config": {
          "question": {
            "en": "Overall, how was it?"
          },
          "scale": 5
        }
      },
      {
        "id": "topics",
        "type": "Choice",
        "config": {
          "question": {
            "en": "Which topics helped?"
          },
          "options": [
            {
              "id": "plugins",
              "label": {
                "en": "Writing plugins"
              }
            },
            {
              "id": "renderers",
              "label": {
                "en": "Renderers"
              }
            }
          ],
          "multiple": true,
          "followUp": "overall"
        }
      }
    ],
    "footer": [
      {
        "id": "thanks",
        "type": "Note"
      }
    ]
  }
}
```

## Types

- `Survey`: A survey: a header, the questions in order, and a footer note. See `references/survey.md`.
- `Rating`: A rating question: pick a number on a scale. See `references/rating.md`.
- `Choice`: A choice question: pick one or more options. See `references/choice.md`.
- `Note`: A short text. See `references/note.md`.

Each slot names the types it expects (each type's reference lists its slots). The expectation is the plugin's
intent: the compiler enforces only what the plugin's structure validators check, so follow it anyway. Types no slot names as a child (root candidates): `Survey`.

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
   `unexpected-widget-field`, `duplicate-widget-id`), a `message`, a location naming the widget, for config
   problems a `path` into the config, and, when the plugin reported one, a machine-readable `reason` with its
   `details`. Each type's reference lists its reasons and the shape of their `details`.
4. Fix exactly what each diagnostic names, keep everything else, and compile again. Repeat until `valid`.
   Do not rewrite the document from scratch: an invalid document still compiles to an inspectable Blueprint, so
   the diagnostics are complete, not just the first error.
