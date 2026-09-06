# AGENTS.md — experimental Widget DevTools boundary

This private workspace is the Phase A1 implementation tracked by DevilTea/widget#6. It is deliberately not a published package commitment yet.

- `protocol.ts` and `value.ts` are browser/Vue/Chrome-independent wire vocabulary. Keep them JSON-safe.
- `projection.ts` is the only layer allowed to translate `@deviltea/widget-core/inspection` facades into wire DTOs.
- `transport.ts` is transport-only. In-process transport must not leak object identity; future MessagePort/runtime.Port transports should implement the same interface.
- `agent.ts` owns inspected-document hit testing, pointer suppression, highlight lifecycle, and Core inspection access. The client never receives Runtime/Blueprint objects.
- No mutation, method invocation, eval, state editing, generic object RPC, or Core semantic changes belong here.
