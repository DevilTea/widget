# Widget API conventions

This document records the cross-cutting conventions shared by the published
`@deviltea/widget-core`, `@deviltea/widget-vue` and `@deviltea/widget-inspector`
APIs. Cross-package behavior is defined here; each package's own guide defines
the details of its surface.

## Diagnostics

Every framework diagnostic has the stable top-level shape:

```ts
{
	code: string
	location: Location
	message: string
}
```

`code` is a lowercase kebab-case discriminator. `location` identifies the
owned Blueprint node, Runtime primitive, or Runtime boundary. Variant-specific
facts are direct fields on the diagnostic. `DiagnosticBase` intentionally
contains only `code`, `location`, and `message`; `path` and `related` belong to
the concrete variants that define their meaning and cardinality. Neither is
hidden in a generic `source` or `details` object. Plugin-authored callback
diagnostics retain the framework code family and may carry the plugin's opaque
`reason` string; plugins do not define arbitrary top-level codes.

Blueprint and node diagnostics are immutable snapshots exposed through
`.diagnostics`. A valid Blueprint has an empty diagnostic snapshot: a Blueprint
is `'valid'` only when compilation produced no diagnostic of any kind. Runtime
primitive, widget, and root diagnostic channels are live: use
`getDiagnostics()` for the latest completed immutable snapshot and
`subscribeDiagnostics(listener)` for future changes. The root Runtime channel
is the aggregate over the whole Runtime: Runtime-boundary diagnostics first,
followed by widget-owned diagnostics in Blueprint semantic order. It contains
only the diagnostics of operations that have completed, so a Property that has
never been evaluated contributes nothing. A widget aggregate never absorbs
Runtime-boundary diagnostics merely because a widget id is mentioned.

The Blueprint aggregate has its own deterministic order (a post-order walk of
the source tree, followed by the duplicate-id, JSON-domain, structure and
dependency phases), which is different from the Runtime aggregate's semantic
pre-order.

Diagnostic callbacks are an ordinary semantic result channel. Observer
exceptions are isolated from the operation that caused a notification: a
throwing State, Property, diagnostic, Event, inspection or `WidgetDocument`
listener never reaches the writer and never stops the other listeners, and Core
reports it asynchronously. The one exception is a runaway Event loop: the emit
re-entrancy guard's `WidgetSystemRuntimeReentrancyError`, and an engine stack
overflow raised inside an Event listener, pass through Event listener isolation
so they reach the operation that started the loop instead of being retried at
every nesting level. Plugin or framework implementation exceptions remain thrown
conditions; they are not converted into diagnostics.

Blueprint `status` and `sourceJsonCompatible` are snapshot facts, not Result
success flags: a semantically invalid but JSON-safe Blueprint remains an
inspectable snapshot, while failed JSON proof prevents Runtime creation.
Machine-readable codes are versioned public API; changing a code's meaning or
spelling is a breaking change even when diagnostic message wording changes.

### Two meanings of `reason`

`reason` appears on diagnostics and failures with two different meanings, and
consumers must not conflate them:

- On a diagnostic a **plugin** reported through `addDiagnostic` (for example
  `invalid-widget-config`, `invalid-widget-structure`, `invalid-state-value`,
  `invalid-property-result`, `invalid-method-result`), `reason` is an **opaque
  string chosen by the plugin author**. The framework carries it verbatim and
  never interprets it.
- On a diagnostic or failure the **framework** creates
  (`json-incompatible-value`, the separated-source diagnostics), `reason` is a
  **closed enum** defined by the package, with documented members.

## Results

Execution-facing Runtime operations use the discriminated result envelope:

```ts
type ExecutionResult<T, D>
	= | { ok: true, value: T }
		| { ok: false, failure: { diagnostics: readonly [D, ...D[]] } }
```

Consumers narrow on `result.ok`, then read `result.value` or
`result.failure.diagnostics`. The envelope's failure half is exported as
`ExecutionFailure<D>`; there is no public generic `Result` type. A success value
is typed exactly as the operation declares it: Property and Method values are
`T`, never `T | null`. Only `RuntimeState.get()` and the reads of optional
dependency targets can produce `null`.

Two other result shapes are deliberately separate from `ExecutionResult`:

- **Document result channel.** `WidgetDocument.applyPatch` returns
  `{ ok: true, changed }` on success and `{ ok: false, failure }` on failure,
  where `failure` is a **single** coded value (`ApplyPatchFailure`: a patch
  operation failure, `reentrant-apply`, or `document-revision-conflict`), not an
  array of diagnostics. The failure has a `code` and a `message`, plus the fields
  its code defines (for example `operationIndex`).
- **Tooling returns.** The separated-source functions return plain records:
  `separateWidgetSource` returns `{ separated, diagnostics }` and
  `normalizeSeparatedWidgetSource` returns `{ source, diagnostics }`. They never
  throw for malformed input, and their `diagnostics` are representation facts,
  separate from Blueprint diagnostics.

## Errors

Core reports a problem through exactly one of four channels, and the channel says
who is responsible.

| Channel | Meaning |
|---|---|
| Diagnostic | a fact about authored data or a runtime value, returned or exposed as data; never thrown |
| Result envelope | the outcome of one operation (`ExecutionResult`, the Document result, a tooling return) |
| Coded `Error` class | a boundary was used wrongly by the caller; thrown |
| Uncoded `TypeError` (or other native error) | a plugin or callback broke its contract, or the host did; an implementation bug, not a Diagnostic |

The coded `Error` classes, one per boundary. Consumers discriminate by **class
and `code`**, never by `message`; reusing a code string across classes is
intentional.

| Class | Boundary | Codes |
|---|---|---|
| `WidgetSystemConfigurationError` | `createWidgetSystem` | `invalid-options`, `foreign-plugin`, `duplicate-plugin-type` |
| `WidgetSystemRuntimeDisposedError` | any live Runtime operation after `dispose()` | `runtime-disposed` |
| `WidgetSystemRuntimeReentrancyError` (a `RangeError`) | an `emit` nested more than 128 levels deep in one Runtime (a runaway Event loop) | `emit-depth-exceeded` |
| `WidgetInspectionError` (`@deviltea/widget-core/inspection`) | `inspectPlugin`, `inspectBlueprint`, `inspectRuntime` | `foreign-plugin`, `foreign-blueprint`, `foreign-runtime` |
| `WidgetIntegrationError` (`@deviltea/widget-core/integration`) | `getWidgetEventEmitter`, `assertCoreRuntime` | `foreign-runtime`, `runtime-widget-mismatch` |
| `WidgetVueIntegrationError` (`@deviltea/widget-vue`) | the Vue integration | `invalid-renderer-registry`, `runtime-system-mismatch`, `outside-widget-renderer`, `widget-plugin-mismatch`, `readonly-projection-write` |

The Inspector reports a failed request over the wire as an `ok: false` response
carrying an `InspectorProtocolError` whose `code` is part of the versioned
protocol, rather than as a thrown error.

Uncoded `TypeError`s signal callback contract violations: a malformed plugin
declaration, a returned Promise or thenable, a diagnostic collector used after its
callback returned, a dependency or `emit` callable used outside its own running
callback (including from a listener or a `validate`-style callback running inside
it), and a structure validator that reports a location that does not exist.
They are thrown at plugin build, compile, or call time and are never converted
into Diagnostics.

Plugin exceptions propagate unchanged: an exception thrown by a `compute`,
`execute` or other callback reaches the caller that triggered the evaluation
as-is (the exception to this is listener isolation, above). `JSON.parse`'s
`SyntaxError` from `createBlueprintFromJson` and a `RangeError` from runaway
recursion are likewise passed through. A runaway Event loop is cut off by a
non-semantic guard that throws `WidgetSystemRuntimeReentrancyError` instead of
waiting for the stack to run out.

## Vue projections

`useWidget(Plugin)` keeps the core vocabulary: `useStateDiagnostics`,
`usePropertyDiagnostics`, `useMethodDiagnostics`, and `useDiagnostics` expose
readonly reactive projections of the corresponding Runtime diagnostic channels.
Value projections map semantic result failures to `null`; they do not hide or
replace the diagnostic channel.

## Inspector

`@deviltea/widget-inspector` is read-only. It carries Core facts across a
JSON-safe protocol and never mutates, invokes, or evaluates host state. It
inherits the Diagnostic and error vocabulary above and adds the
`InspectorProtocolError` codes for transport-level failures.
