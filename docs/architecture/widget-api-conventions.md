# Widget API conventions

This document records the cross-cutting conventions shared by the non-MCP
`@deviltea/widget-core` and `@deviltea/widget-vue` APIs.

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
`.diagnostics`. A valid Blueprint has an empty diagnostic snapshot. Runtime
primitive, widget, and root diagnostic channels are live: use
`getDiagnostics()` for the latest completed immutable snapshot and
`subscribeDiagnostics(listener)` for future changes. The root Runtime channel
is the complete aggregate: Runtime-boundary diagnostics first, followed by
widget-owned diagnostics in Blueprint semantic order. A widget aggregate never
absorbs Runtime-boundary diagnostics merely because a widget id is mentioned.

Diagnostic callbacks are an ordinary semantic result channel. Observer
exceptions are isolated from the operation that caused a notification. Plugin
or framework implementation exceptions remain thrown `Error` conditions; they
are not converted into diagnostics.

Blueprint `status` and `sourceJsonCompatible` are snapshot facts, not Result
success flags: a semantically invalid but JSON-safe Blueprint remains an
inspectable snapshot, while failed JSON proof prevents Runtime creation.
Machine-readable codes are versioned public API; changing a code's meaning or
spelling is a breaking change even when diagnostic message wording changes.

## Results

Execution-facing operations use the discriminated result envelope:

```ts
type ExecutionResult<T, D>
	= | { ok: true, value: T }
		| { ok: false, failure: { diagnostics: readonly [D, ...D[]] } }
```

Consumers narrow on `result.ok`, then read `result.value` or
`result.failure.diagnostics`. There are no public success/failure aliases and
no public generic `Result` type. Exceptional conditions such as a disposed
Runtime or a plugin callback throwing continue to use `Error` subclasses.

## Vue projections

`useWidget(Plugin)` keeps the core vocabulary: `useStateDiagnostics`,
`usePropertyDiagnostics`, `useMethodDiagnostics`, and `useDiagnostics` expose
readonly reactive projections of the corresponding Runtime diagnostic channels.
Value projections map semantic result failures to `null`; they do not hide or
replace the diagnostic channel.
