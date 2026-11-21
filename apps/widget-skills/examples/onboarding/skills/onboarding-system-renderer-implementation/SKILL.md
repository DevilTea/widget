---
name: onboarding-system-renderer-implementation
description: "Implement Vue renderers for the onboardingSystem widget types with @deviltea/widget-vue: registration, the useWidget() surface, and each type's State, Properties, Methods, Events and slots."
---

# Implementing onboardingSystem renderers

Everything here comes from the public exports of `@deviltea/widget-vue`: `createWidgetVueRenderer`,
`useWidget`, `WidgetVueIntegrationError` and the `UseWidget*` / `WidgetSlot*` types.

## Registration

One Vue component per widget type, registered once for the System:

```text
import { createWidgetVueRenderer } from '@deviltea/widget-vue'

export const SystemRenderer = createWidgetVueRenderer(system, renderers => renderers
	.Onboarding(OnboardingRenderer)
	.AccountStep(AccountStepRenderer)
	.InterestsStep(InterestsStepRenderer)
	.SafetyStep(SafetyStepRenderer)
	.InductionStep(InductionStepRenderer))
```

- The registry is exhaustive: the chain names every plugin type of the System exactly once.
- The result is a component bound to that exact System. Mount it with the Runtime to show:
  `<SystemRenderer :runtime="runtime" />`. A Runtime of another System is a programming error, not a diagnostic.
- Giving it a different Runtime remounts the whole tree. It never disposes a Runtime: whoever created the
  Runtime (`blueprint.createRuntime()`) disposes it.

## The `useWidget()` surface

A renderer calls `useWidget(Plugin)` in its `setup()` with the exact plugin object: it is the type witness and a
runtime identity check. Calling it outside a registered renderer throws `WidgetVueIntegrationError`. Only the
accessors of the capabilities the plugin declares are present.

| Accessor | Present when | What it gives |
| --- | --- | --- |
| `config` | config | The resolved config, deeply read-only (never the raw one). |
| `useState()` | state | One writable `Ref<T \| null>` per State member. Assigning runs the member's `validate`; a rejected write is reported in `useStateDiagnostics()`. |
| `useProperties()` | properties | One read-only ref of `T \| null` per Property, computed lazily on first read. `null` means the Property failed; `usePropertyDiagnostics()` says why. |
| `useMethods()` | methods | One function per Method. It returns the Method's value on success and `null` on failure. It never returns a result object and does not throw for a refused call. |
| `emit` | events | The typed Event emitter. Prefer letting Methods emit. |
| `useStateDiagnostics()`, `usePropertyDiagnostics()`, `useMethodDiagnostics()` | the capability | One read-only ref of diagnostics per member. |
| `useDiagnostics()` | always | The widget's own diagnostics. |
| `WidgetSlot` | slots | The component that renders a slot's children. |
| `widgetId`, `widgetType` | always | The identity of the widget being rendered. |

## Rules

- Handle `null`: every State and Property ref may be `null`, and so may every Method call's return value.
- To learn why a Method call failed, read `useMethodDiagnostics().<method>.value` after the call: each
  diagnostic has a `code` (`invalid-method-arguments`, `invalid-method-result`), a `message` and, when the
  plugin gave one, a `reason`. A `null` return is the only signal on the call itself, so a Method whose
  successful value could be `null` must be told apart through its diagnostics.
- A failed Method call is not rolled back: State it wrote and Events it emitted before failing stay. Render
  from State and Properties after the call rather than assuming nothing changed.
- A renderer displays State and Properties and calls Methods. It does not keep a second copy of widget state.
- `authorWritable` State is meant to be set by an author or editor; other State is changed through Methods.
- Methods are synchronous. Async work belongs to the host: listen to the Event, wait, then call a Method.
- Render a slot with `<WidgetSlot name="slotName">`; its default scoped slot is called once per child with
  `{ Child, id, type, index }`. Render `<Child />` (it takes no props) inside whatever wrapper you need, or
  leave a child out.

## Types

- `Onboarding`: `references/onboarding.md`
- `AccountStep`: `references/account-step.md`
- `InterestsStep`: `references/interests-step.md`
- `SafetyStep`: `references/safety-step.md`
- `InductionStep`: `references/induction-step.md`
