---
name: survey-system-renderer-implementation
description: "Implement Vue renderers for the surveySystem widget types with @deviltea/widget-vue: the registration chain, and each type's config, State, Properties, Methods, Events, slots and diagnostic reasons. The widget-vue-renderer skill explains the API."
---

# Implementing surveySystem renderers

This skill lists what is specific to surveySystem. The API it uses (`createWidgetVueRenderer`, the root renderer,
`useWidget()`, `WidgetSlot`, `@deviltea/widget-vue/testing`, the integration errors) is explained by the
`widget-vue-renderer` skill, which ships with `@deviltea/widget-vue` in `skills/widget-vue-renderer/`
(`npx skills experimental_sync` links it from `node_modules`). Read that skill first.

## Registration

One Vue component per widget type, registered once for the System:

```text
import { createWidgetVueRenderer } from '@deviltea/widget-vue'

export const SystemRenderer = createWidgetVueRenderer(system, renderers => renderers
	.Survey(SurveyRenderer)
	.Rating(RatingRenderer)
	.Choice(ChoiceRenderer)
	.Note(NoteRenderer))
```

The chain names every plugin type of the System exactly once. Each renderer calls `useWidget(Plugin)` with the
plugin of its type.

## Types

Each reference lists the type's resolved config, State (with `authorWritable`), Properties, Methods, Events, slots
and diagnostic reasons, with their descriptions.

- `Survey`: `references/survey.md`
- `Rating`: `references/rating.md`
- `Choice`: `references/choice.md`
- `Note`: `references/note.md`
