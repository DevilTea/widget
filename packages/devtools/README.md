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

A1 is read-only: no state mutation, Method invocation, eval, generic object RPC, iframe Runtime host, extension manifest, or Runtime discovery global hook. A later iframe/extension phase should replace transport/host pieces without changing the client-facing semantic model.
