# Interfaces of surveySystem

Read from the types. The descriptions are written in each plugin's builder (`plugin.docs`), not here.

## Survey (`SurveyInterfaces`)

```text
config: { raw: SurveyRawConfig, resolved: { title: I18nText; maxQuestions: number; submitUrl: string | null; } }
slots: { header: WidgetChild, questions: WidgetContract<{ properties: { answered: boolean } }, 'Rating' | 'Choice'>, footer: 'Note' }
state.submitted: boolean
properties.progress: number
methods.submit(): boolean
events.submitted: [summary: SubmitSummary]
reasons['empty-title']: void
reasons['too-many-questions']: { max: number; count: number; }
```

## Rating (`RatingInterfaces`)

```text
config: { raw: { question: I18nText; scale?: number | undefined; }, resolved: { question: I18nText; scale: number; } }
state.value: number | null
properties.answered: boolean
methods.rate(value: number): number
events.rated: [value: number]
reasons['out-of-range']: { min: number; max: number; received: number; }
```

## Choice (`ChoiceInterfaces`)

```text
config: { raw: { question: I18nText; options: ChoiceOption[]; multiple?: boolean | undefined; followUp?: WidgetRef<"Rating" | "Choice"> | undefined; }, resolved: { question: I18nText; options: readonly ChoiceOption[]; multiple: boolean; followUp: string | null; } }
state.selected: readonly string[]
properties.answered: boolean
methods.select(id: string): readonly string[]
events.changed: [selected: readonly string[]]
reasons['unknown-option']: { id: string; }
```

## Note (`NoteInterfaces`)

```text
config: { raw: { text: I18nText; } | null, resolved: { text: I18nText; } }
```
