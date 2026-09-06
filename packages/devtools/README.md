# @deviltea/widget-devtools

Private experimental DevTools boundary for DevilTea Widget. This workspace implements Phase A1 of `DevilTea/widget#6`; its package name is provisional and it is **not** a published API commitment.

```text
Inspector UI
    |
InspectorClient
    |
InspectorTransport   (in-process JSON round-trip in A1)
    |
InspectorAgent
    |
@deviltea/widget-core/inspection + inspected DOM
```

The protocol is versioned, runtime-validated, and JSON-safe. `InspectorAgent` projects authoritative Core inspection facts into serializable DTOs and owns inspected-document hit testing, pointer suppression, and highlight chrome. Runtime values use a bounded display encoding that does not execute accessors or application `toJSON()`.

`InspectorAgent` owns Escape handling inside its inspected document. A future iframe host or DevTools panel may also map a host-frame Escape shortcut to the existing `inspect.disable` request; that is host policy, not a second inspection state model. A1 likewise defines explicit disconnect semantics while leaving timeout/retry policy to a future asynchronous transport host.

A1 is read-only: no state mutation, Method invocation, eval, generic object RPC, iframe Runtime host, extension manifest, or Runtime discovery global hook. A later iframe/extension phase should replace transport/host pieces without changing the client-facing semantic model.
