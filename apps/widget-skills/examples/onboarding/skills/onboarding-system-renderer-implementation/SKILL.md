---
name: onboarding-system-renderer-implementation
description: "Implement Vue renderers for the onboardingSystem widget types with @deviltea/widget-vue: the useWidget() surface, and each type's State, Properties, Methods, Events and slots."
---

# Implementing onboardingSystem renderers

A renderer is a Vue component registered for one widget type. In its `setup()` it calls
`useWidget(Plugin)` from `@deviltea/widget-vue` with the exact plugin object (it is the type witness and a
runtime identity check; calling it outside a registered renderer throws `WidgetVueIntegrationError`).

## The `useWidget()` surface

Only the accessors of the capabilities the plugin declares are present.

| Accessor | Present when | What it gives |
| --- | --- | --- |
| `config` | config | The resolved config, deeply read-only (never the raw one). |
| `useState()` | state | One writable ref per State member. Writing runs the member's `validate`; a rejected write is a diagnostic, not a throw. |
| `useProperties()` | properties | One read-only ref per Property. Lazy: a Property is computed when first read. |
| `useMethods()` | methods | One function per Method. It returns an execution result (`{ ok: true, value }` or `{ ok: false, ... }`); a refused call writes nothing and emits nothing. |
| `emit` | events | The typed Event emitter. Prefer letting Methods emit. |
| `widgetId`, `widgetType` | always | The identity of the widget being rendered. |
| `useStateDiagnostics()`, `usePropertyDiagnostics()`, `useMethodDiagnostics()` | the capability | One diagnostics ref per member: show why a write or call was refused. |
| `useDiagnostics()` | always | The widget's own diagnostics. |
| `WidgetSlot` | slots | The component that renders a slot's children with their registered renderers. |

The accessor names above are read from `UseWidgetResult` in `packages/vue/src/types.ts`; check that file for the
exact member types (refs, execution results, the `WidgetSlot` scope: `Child`, `id`, `type`, `index`).

## Rules

- A renderer displays State and Properties and calls Methods. It does not keep a second copy of widget state.
- `authorWritable` State is meant to be set by an author or editor; other State is changed through Methods.
- Methods are synchronous. Async work belongs to the host: listen to the Event, wait, then call a Method.
- Never stamp DOM attributes for the Inspector by hand.

## Types

- `Onboarding`: `references/onboarding.md`
- `AccountStep`: `references/account-step.md`
- `InterestsStep`: `references/interests-step.md`
- `SafetyStep`: `references/safety-step.md`
- `InductionStep`: `references/induction-step.md`
