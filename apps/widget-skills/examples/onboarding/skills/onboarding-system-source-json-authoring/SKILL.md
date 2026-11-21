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
- `meta`: reserved for tools; do not write it.

```json
{
  "id": "root",
  "type": "Onboarding",
  "config": {},
  "slots": {
    "steps": []
  }
}
```

## Types

- `Onboarding`: The root of the onboarding wizard. State: `current` (the index of the current step) and `finished`. Properties: `title`, `steps` (each step's title, `complete` and `missing`), `progress` and `answers`. Methods: `canEnter(index)` (read-only), `next()`, `back()`, `goTo(index)` (each writes `current` and emits `stepChanged`) and `finish()` (emits `completed`). A refused move is a Method diagnostic and changes nothing. See `references/onboarding.md`.
- `AccountStep`: Step 1 of the onboarding wizard: the visitor's name and e-mail address (State `name` and `email`, filled in as they type). Properties: `title`, `missing` (`name` and/or `email` while they are empty or not an address), `complete` and `answers`. See `references/account-step.md`.
- `InterestsStep`: Step 2 of the onboarding wizard: the interests the new member picks from the configured options (State `selected`: the picked ids). Properties: `title`, `options`, `missing` (`interests:<n>` while `n` more must be picked to reach `minimum`), `complete` and `answers` (the picked ids). See `references/interests-step.md`.
- `SafetyStep`: Step 3 of the onboarding wizard: the safety briefing. The visitor acknowledges each configured rule (State `acknowledged`: the ids acknowledged so far). Properties: `title`, `rules`, `missing` (one `rule:<id>` per rule not yet acknowledged), `complete` and `answers` (the acknowledged ids). See `references/safety-step.md`.
- `InductionStep`: Step 4 of the onboarding wizard: booking an induction slot, with the work kept at the host. Methods: `requestSlot(date, time)` (validated against the config; writes the request into State and emits `slotRequested` with a ticket), `settleBooking(ticket, outcome)` (the host's answer; applied only if the ticket is still the newest, otherwise ignored) and `cancelBooking()` (emits `slotCancelled`); `requestSlot` and `cancelBooking` are refused once the wizard is finished. Events: `slotRequested`, `slotConfirmed`, `slotDeclined`, `slotCancelled`. State: `status`, `ticket`, `slot`, `reference`, `reason`. See `references/induction-step.md`.


## References between widgets

A config value that names another widget holds that widget's `id` (documented with `@widgetRef` in the type's
reference). The id must exist in the same document and be of a listed type.

## Structured output: the flat node list

When the output must follow a JSON Schema (tool input, structured output), use
`references/document.llm.schema.json` instead of the tree:

- `{ "nodes": [{ "id", "type", "parent", "slot", "config" }] }`; exactly one node has no `parent` and no
  `slot` (the root).
- Children of one slot keep the order they have in `nodes`; list parents before children.
- Leave an optional key out; do not write `null` for it. Leave `config` out when the type takes none.
- `slots` (a list of slot names) is only needed to declare a slot that has no children.
- The schema is meant for non-strict structured output: it gets the structure roughly right, no more.
- A dictionary (for example text per language) is a list of `{ "key", "value" }` entries.
- Limits (ranges, lengths, formats) are in the descriptions, not in schema keywords: read them.

`flatToTree` from `@deviltea/widget-skills` converts the list back to the tree deterministically (`treeToFlat`
is the inverse). `references/document.schema.json` is the full schema of the tree form.

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
