# @deviltea/widget-devtools

Private experimental DevTools boundary for DevilTea Widget. Phase A1 (`DevilTea/widget#6`) is merged; Phase B foundation is tracked in `DevilTea/widget#8`. The package name is provisional and this is **not** a published API commitment.

```text
Inspector UI
    |
InspectorClient
    |
InspectorTransport   (in-process or MessagePort; JSON-safe wire semantics)
    |
InspectorAgent
    |
@deviltea/widget-core/inspection + inspected DOM
```

The protocol is versioned, runtime-validated, and JSON-safe. `InspectorAgent` projects authoritative Core inspection facts into serializable DTOs and owns inspected-document hit testing, pointer suppression, and highlight chrome. Runtime values use a bounded display encoding that does not execute accessors or application `toJSON()`.

`InspectorAgent` owns Escape handling inside its inspected document. A future iframe host or DevTools panel may also map a host-frame Escape shortcut to the existing `inspect.disable` request; that is host policy, not a second inspection state model. Transports expose explicit disconnect semantics; the MessagePort adapter maps native peer close into the same client/Agent lifecycle used by the in-process adapter.

The boundary remains read-only: no state mutation, Method invocation, eval, generic object RPC, extension manifest, or Runtime discovery global hook. Phase B adds a versioned frame-bootstrap envelope that validates source/origin/session/generation and transfers exactly one dedicated MessagePort; ordinary Inspector traffic then stays off the global `message` bus. The actual iframe Runtime host is still a later Phase B step.
