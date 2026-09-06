# AGENTS.md — experimental Widget DevTools boundary

This private workspace contains the merged Phase A1 boundary from DevilTea/widget#6 plus Phase B transport/bootstrap foundation tracked by #8. It is deliberately not a published package commitment yet.

- `protocol.ts` and `value.ts` are browser/Vue/Chrome-independent wire vocabulary. Keep them JSON-safe.
- `projection.ts` is the only layer allowed to translate `@deviltea/widget-core/inspection` facades into wire DTOs.
- `transport.ts` is transport-only. In-process and MessagePort transports share one interface and JSON-safe wire semantics; disconnect must deterministically notify client/Agent cleanup. A future runtime.Port transport should preserve the same contract.
- `agent.ts` owns inspected-document hit testing, pointer suppression, highlight lifecycle, and Core inspection access. The client never receives Runtime/Blueprint objects.
- No mutation, method invocation, eval, state editing, generic object RPC, or Core semantic changes belong here.
- `frame-bootstrap.ts` owns only the one-time frame-channel bootstrap envelope/validation. Validate exact source/origin, session, generation, and one transferred port; ordinary Inspector messages never belong on the global window `message` bus.
