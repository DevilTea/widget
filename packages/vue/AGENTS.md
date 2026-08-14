# AGENTS.md — @deviltea/widget-vue

## Scope and layout

A thin Vue 3 integration over `@deviltea/widget-core` Runtime semantics: a keyed renderer registry
builder (`createWidgetVueRenderer`), the recursive `WidgetRenderer` root component, and the
widget-scoped `useWidget(Plugin)` bridge (lazy `Ref`/callable projections of state, properties,
methods, diagnostics, and slots). The normative semantic contract for this package lives in GitHub
issue #13 ("Widget Vue integration — Phase 3 decision log"); GitHub issue #10 remains the core
semantic authority and this package never reimplements or reinterprets it.

- `src/index.ts` — public entry; only export the public contract surface.
- `src/context.ts` — private Vue injection types/key linking the internal host tree to `useWidget()`. Never exported.
- `src/bridge.ts` — lazy Runtime -> Vue `customRef`/callable primitives.
- `src/renderer.ts` — the renderer registry builder, the internal recursive host, the shared `WidgetSlot` component, and `createWidgetVueRenderer`.
- `src/use-widget.ts` — `useWidget(Plugin)`.
- `src/types.ts` — the public `useWidget()` return-type surface.
- `src/errors.ts` — `WidgetVueIntegrationError`, the single programmer/configuration exception type.
- `src/test-fixtures.ts` — real `@deviltea/widget-core` plugins/system/runtime fixtures shared by the colocated tests. Not part of the public contract; excluded from `tsconfig.package.json`.
- `src/**/*.unit.test.ts` — colocated Vitest unit tests (run by the root config too).

## Commands

```bash
pnpm test        # vitest run for this package
pnpm typecheck   # package + tests tsconfig
pnpm build       # tsdown (includes publint)
```

## Package boundaries (issue #13 checkpoint A)

This package owns the renderer/lifecycle/reactivity adapter surface only. It must not own:

- Survey/Product Prototype or any other domain widgets
- Lab inspectors, source editors, or other editor-domain UI
- persistence/versioning/migration of any kind
- showcase-specific application state or business rules

Those responsibilities belong to `widget-lab` (a private downstream application/architecture probe)
or to the widgets it hosts, never to this package.

## Implementation rules

- Do not resolve implementation difficulty by silently reintroducing a design issue #13 marks
  discarded/superseded; a genuine semantic change requires a new amendment on issue #13 first, and
  must never contradict issue #10's core semantics.
- The Runtime is the sole source of truth. Every value bridge is a `customRef` (or equivalent) with
  no authoritative mirrored cache and no optimistic local writes; Runtime subscriptions only ever
  `trigger()` Vue invalidation, they never carry a value payload the adapter caches.
- Every `useXxx()` accessor and every member surface is lazy: obtaining a capability accessor must
  never read or subscribe the Runtime, and materializing a member wrapper must not either — only the
  first `.value` read (or, for methods, the first call) may touch the Runtime.
- `useWidget(Plugin)` is the single renderer integration boundary. It must never expose
  `runtime`/`system`/an unrestricted `getWidget` escape hatch — every cross-widget interaction stays
  mediated by `@deviltea/widget-core` dependencies (`registerDeps`), never by renderer code reaching
  across the tree.
- Renderer components never receive a `widget` prop. The current `RuntimeWidget` is injected
  privately through `CurrentWidgetContext`; renderer code only ever calls `useWidget(Plugin)`.
- `WidgetSlot` is always the one shared internal component identity (`SharedWidgetSlotComponent` in
  `renderer.ts`) — never allocate a fresh component definition per widget or per `useWidget()` call.
- Collision-safety matters the same way it does in `@deviltea/widget-core`: arbitrary plugin-type and
  member-key strings, including `__proto__` and `constructor`, must work through `Map`/Proxy/
  null-prototype storage, never plain-object bracket assignment.
- `createWidgetVueRenderer` validates exactly-once renderer coverage against the actual bound
  `WidgetSystem` instance at construction time, and the returned component validates
  `runtime.blueprint.system === boundSystem` at render time. Both are programmer/configuration
  exceptions (`WidgetVueIntegrationError`), never a Widget Issue.
- The root renderer never calls `runtime.dispose()`, on unmount or on `runtime` prop replacement.
  Runtime lifetime is owned by the caller.

## Unit-test standard

Follow the conformance matrix recorded in issue #13 checkpoint G: type-level conformance (registry
typestate, arbitrary string keys, broadened-`string`-universe rejection, exact `useWidget(Plugin)`
capability/member/slot inference, absent-vs-explicitly-empty), lazy bridge invariants (activation
timing, subscription counts, identity stability), state/property/method/diagnostics conformance, and
renderer/topology + root lifecycle mounted tests. Use real `@deviltea/widget-core` fixtures
(`test-fixtures.ts`) — never a parallel mocked semantic core. Test public behavior with precise,
discriminating assertions (exact values, ordering, activation counts, object identity where the
contract promises it); coverage percentage alone is not evidence of correctness.
