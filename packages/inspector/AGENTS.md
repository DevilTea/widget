# AGENTS.md — @deviltea/widget-inspector

The single published Inspector boundary for DevilTea Widget: the read-only, versioned Inspector protocol, client, DOM agent, transports, and inspect-anchor attribute contract. Decision of record: Discussion #12 C5 ("external Inspector consumer boundary", closes `DevilTea/widget#160` and `#161`). It replaced the former private `@deviltea/widget-devtools` (Phase A1 `DevilTea/widget#6`, Phase B transport/bootstrap `#8`).

Support statement: **0.x experimental, protocol-major guarantee only.**

## Public surface

There is **no root `.` entry**. The public subpaths are exactly `/protocol`, `/client`, `/transport`, `/channel`, `/frame-bootstrap`, `/agent`, `/value`, and `/anchor`. `src/package-boundary.unit.test.ts` pins the exact list and that every source module is classified; the packed-tarball consumer checks in CI pin it again against the built package. Adding a subpath is a public API decision, not a refactor.

`geometry.ts`, `overlay.ts`, `projection.ts`, `validation.ts`, and `test-fixture.ts` are internal: nothing outside this package may import them, and they are reachable only through the public entries' bundled chunks. Add a new source module only after classifying it as public (entry in `tsdown.config.ts` and `package.json` `exports`) or internal (listed in the boundary test).

## Two version axes

- npm semver governs the TypeScript API. While on `0.x` a minor release may break it.
- Protocol `major.minor` (`INSPECTOR_PROTOCOL_VERSION` in `protocol.ts`) governs cross-realm compatibility. Minors only add negotiated capabilities (new methods, events, error codes, or fields gated on the negotiated minor); a breaking DTO change bumps the major. A new capability must be unavailable to peers negotiated at an older minor (see `agent.ts` `capabilitiesForMinor` and the `subscription-limit` handling).

`@deviltea/widget-core` is a **peerDependency** (with a `workspace:*` devDependency for local work). A bundled second Core copy would make `inspectRuntime` reject the host's Runtime as foreign, so the build never bundles it.

## Source layout

- `protocol.ts` and `value.ts` are browser/Vue/Chrome-independent wire vocabulary. Keep them JSON-safe. Runtime values/event args use bounded `InspectableValue`; config Draft 2020-12 schema documents are transmitted directly as JSON-safe metadata and must not be truncated through that encoder.
- `projection.ts` is the only layer allowed to translate `@deviltea/widget-core/inspection` facades into wire DTOs.
- `transport.ts` is transport-only. In-process and MessagePort transports share one interface and JSON-safe wire semantics; disconnect must deterministically notify client/Agent cleanup. A future runtime.Port transport should preserve the same contract. `channel.ts` multiplexes logical transports over one MessagePort.
- `agent.ts` owns inspected-document hit testing, pointer suppression, highlight lifecycle, semantic geometry coordination, readonly event-occurrence projection, the optional subscription cap, and Core inspection access. The client never receives Runtime/Blueprint/DOM objects. `geometry.ts` owns Preview-viewport geometry math and frame-coalesced invalidation.
- `anchor.ts` is the framework-neutral, DOM-independent anchor writer contract: the attribute names and `inspectAnchorAttributes({ widgetId, widgetType })`. Anchors carry identity only (no Runtime or root identity); the Agent binds one Runtime to one root and resolves attributes against Core inspection, so stale values resolve to no target. Any renderer-owned element carrying both attributes is an anchor; several elements may mark one Widget (each contributes to `rects[]` in document order); the innermost resolvable anchor wins hit-testing; anchors live and die with the renderer DOM, so there is no register/cleanup API. `@deviltea/widget-vue` stamps no DOM attributes.
- `overlay.ts` is the Agent-owned highlight chrome: one fixed, pointer-transparent host with an open ShadowRoot appended to the inspected document, drawn from geometry rects. The Agent must never mutate renderer elements, add classes or attributes to them, or insert nodes into the renderer subtree, and a renderer re-render must not clear the highlight. Hosts theme it only through inherited `--widget-inspector-*` custom properties.
- Subscription cap: `maxSubscriptions` is optional with **no default** (unlimited unless the host configures one). `subscription-limit` exists only behind protocol minor 3 and is returned only when a cap is configured; peers negotiated below minor 3 receive `internal-error` instead.
- `frame-bootstrap.ts` owns only the one-time frame-channel bootstrap envelope/validation. Validate exact source/origin, session, generation, and one transferred port; ordinary Inspector messages never belong on the global window `message` bus.

No mutation, method invocation, eval, state editing, generic object RPC, or Core semantic changes belong here.

## Commands

```bash
pnpm test        # vitest run for this package
pnpm typecheck   # package + tests tsconfig
pnpm build       # tsdown (includes publint)
```

Release wiring (release script, `publish.yml` tag pattern, root `publint`, CI packed-consumer job) treats this package like core and Vue; never run `pnpm release*` without an explicit release instruction.
