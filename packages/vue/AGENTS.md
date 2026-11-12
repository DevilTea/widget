# AGENTS.md — @deviltea/widget-vue

## Scope and layout

A thin Vue 3 integration over `@deviltea/widget-core` Runtime semantics: a keyed renderer registry
builder (`createWidgetVueRenderer`), the recursive `WidgetRenderer` root component, and the
widget-scoped `useWidget(Plugin)` bridge (lazy `Ref`/callable projections of state, properties,
methods, diagnostics, events (`emit`), slots, and the resolved `config`, plus the unconditional `widgetId`/`widgetType` identity fields — see
"Package boundaries" below), and the `@deviltea/widget-vue/testing` subpath (`createWidgetTestHost`). The normative semantic contract for this package lives in `DevilTea/deviltea-labs#13`
("Widget Vue integration — Phase 3 decision log"); `DevilTea/deviltea-labs#10` remains the core semantic authority
and this package never reimplements or reinterprets it. These bare `#N` numbers are historical
`DevilTea/deviltea-labs` issue numbers (see `docs/migration/source-history.md`); current authority is
`DevilTea/widget` Discussion #12 and current `DevilTea/widget` Issues/Discussions.

- `src/index.ts` — public entry; only export the public contract surface.
- `src/context.ts` — private Vue injection types/key linking the internal host tree to `useWidget()`. Never exported.
- `src/bridge.ts` — lazy Runtime -> Vue `customRef`/callable primitives.
- `src/renderer.ts` — the renderer registry builder, the internal recursive host, the shared `WidgetSlot` component (including its optional scoped default slot), and `createWidgetVueRenderer`.
- `src/runtime-guard.ts` — passive validation of a supplied Runtime (`invalid-runtime`, `foreign-runtime`), shared by the root renderer and the testing host.
- `src/testing.ts` — the public `./testing` subpath entry (`createWidgetTestHost`). It provides the widget context through `provideCurrentWidgetContext()` in `context.ts`, the same construction the real host uses, and never exports the injection key.
- `src/use-widget.ts` — `useWidget(Plugin)`.
- `src/types.ts` — the public `useWidget()` return-type surface.
- `src/errors.ts` — `WidgetVueIntegrationError` and `WidgetVueIntegrationErrorCode`, the single programmer/configuration exception class. Consumers discriminate by class and `code` (never `message`); the codes are `invalid-renderer-registry` (with frozen `missingTypes`/`unknownTypes`/`duplicateTypes`/`invalidTypes`, `null` for every other code). It is an ordinary exported `class WidgetVueIntegrationError extends Error` (stable `constructor.name` under every transform, subclassable); the instance type is deliberately not a union discriminated by `code`, so the lists are typed `readonly string[] | null` and consumers handle `null`, `invalid-runtime`, `foreign-runtime`, `unknown-widget`, `runtime-system-mismatch`, `outside-widget-renderer`, `widget-plugin-mismatch`, and `readonly-projection-write`. Only caller-reachable misuse gets a code; states made impossible by exact-plugin, registry and System-identity validation are internal invariants and throw a plain `Error`. Add a code only for a materially different caller-reachable problem.
- `src/test-fixtures.ts` — real `@deviltea/widget-core` plugins/system/runtime fixtures shared by the colocated tests. Not part of the public contract; excluded from `tsconfig.package.json`.
- `src/**/*.unit.test.ts` — colocated Vitest unit tests (run by the root config too).

The published entries are exactly `.` (`src/index.ts`) and `./testing` (`src/testing.ts`); `tsdown.config.ts` keeps `@deviltea/widget-core` and `vue` external.
`@deviltea/widget-core` is a peer dependency (`workspace:^`, with a `workspace:*` devDependency), never a regular dependency and never bundled: core recognizes its own Runtimes by module-local identity, so a second copy would make `emit` fail. The root renderer therefore checks Runtime provenance with core's `assertCoreRuntime` (from `@deviltea/widget-core/integration`) the first time it is given a Runtime.

## Commands

```bash
pnpm test        # vitest run for this package
pnpm typecheck   # package + tests tsconfig
pnpm build       # tsdown (includes publint)
```

## Package boundaries (`DevilTea/deviltea-labs#13` checkpoint A)

This package owns the renderer/lifecycle/reactivity adapter surface only. It must not own:

- Survey/Product Prototype or any other domain widgets
- Lab inspectors, source editors, or other editor-domain UI
- persistence/versioning/migration of any kind
- showcase-specific application state or business rules

Those responsibilities belong to `widget-lab` (a private downstream application/architecture probe)
or to the widgets it hosts, never to this package.

## Implementation rules

- Do not resolve implementation difficulty by silently reintroducing a design `DevilTea/deviltea-labs#13` marks
  discarded/superseded; a genuine semantic change requires a new amendment on `DevilTea/deviltea-labs#13` first, and
  must never contradict `DevilTea/deviltea-labs#10`'s core semantics.
- The Runtime is the sole source of truth. Every value bridge is a `customRef` (or equivalent) with
  no authoritative mirrored cache and no optimistic local writes; Runtime subscriptions only ever
  `trigger()` Vue invalidation, they never carry a value payload the adapter caches.
- Keyed surfaces (`createLazyKeyedSurface(members, materialize)`) reflect exactly the Runtime's declared members through `get`, `in`, `Object.keys` and spread; listing keys materializes nothing. A surface is an ordinary frozen null-prototype object with one lazy caching accessor per declared member, never a Proxy (Proxy invariants break `Object.freeze`/`preventExtensions`), and it is keyed by the Runtime's own member object. `toRefs()` is deliberately unsupported: members are already refs and destructuring the surface is the idiom.
- Every `useXxx()` accessor and every member surface is lazy: obtaining a capability accessor must
  never read or subscribe the Runtime, and materializing a member wrapper must not either — only the
  first `.value` read (or, for methods, the first call) may touch the Runtime.
- A ref first activated after its owning scope is disposed returns the current Runtime value but
  releases its subscription immediately and is not reactive afterwards.
- `useWidget(Plugin)` is the single renderer integration boundary. It must never expose
  `runtime`/`system`/an unrestricted `getWidget` escape hatch — every cross-widget interaction stays
  mediated by `@deviltea/widget-core` dependencies (`registerDeps`), never by renderer code reaching
  across the tree.
- `useWidget(Plugin).config` is present exactly when `plugin.capabilities.config` is true (type level: `HasWidgetCapability<Interfaces, 'config'>`). It is the Runtime widget's own resolved config object by identity: not cloned, not reactive (it never changes within one Runtime), typed deeply read-only.
- Accessors mirror core's section names (`state`/`properties`/`methods`/`events`/`slots`/`config` → `useState`/`useProperties`/`useMethods`/`emit`/`WidgetSlot`/`config`); do not invent a parallel naming scheme.
- Failure projects to `null` for Properties and Methods, so a member whose own type includes `null` cannot distinguish failure from a real `null` without its diagnostics ref. This is the designed projection; do not add a second channel for it.
- `useWidget()` must run synchronously during `setup()`; with no injection context it throws `outside-widget-renderer` with a message saying so (typically an `async setup()` calling it after an `await`).
- `useWidget(Plugin)` additionally returns flat, unconditional `widgetId: string` /
  `widgetType: Plugin['type']` (`DevilTea/deviltea-labs#13` checkpoint amendment "`useWidget()` may expose readonly
  local widget identity") — plain values projected once from the already-injected current
  `RuntimeWidget`, never refs, never gated by `plugin.capabilities`. This is identity only: it must
  never grow into exposing the `RuntimeWidget` object, Blueprint node, parent/child traversal, or a
  member-lookup-by-name escape hatch. This package must not itself stamp any DOM attribute/directive
  from these fields (no automatic `data-widget-id`/`data-widget-type`, no Inspect-specific
  presentation behavior) — a renderer/Lab may deliberately project them onto its own rendered root.
  The attribute contract for that projection (names, identity-only shape, nesting and multi-fragment semantics) is owned by
  `@deviltea/widget-inspector/anchor` (`inspectAnchorAttributes`), not by this package; this package neither imports nor
  re-exports it.
- Renderer components never receive a `widget` prop. The current `RuntimeWidget` is injected
  privately through `CurrentWidgetContext`; renderer code only ever calls `useWidget(Plugin)`.
- `WidgetSlot` is always the one shared internal component identity (`SharedWidgetSlotComponent` in
  `renderer.ts`) — never allocate a fresh component definition per widget or per `useWidget()` call.
  Its optional default scoped slot receives `{ Child, id, type, index }` (publicly typed as `WidgetSlotScope`)
  and exposes no Runtime handle; each `Child` is created once per child and reused across renders so wrapping
  it never remounts the child widget.
- Collision-safety matters the same way it does in `@deviltea/widget-core`: arbitrary plugin-type and
  member-key strings, including `__proto__` and `constructor`, must work through `Map`/Proxy/
  null-prototype storage, never plain-object bracket assignment.
- Capability presence (`config`/`state`/`properties`/`methods`/`events`/`slots`) is read from `plugin.capabilities` (
  `DevilTea/deviltea-labs#10` amendment "declaration-presence semantics and public `WidgetPlugin.capabilities`") — never
  inferred from Blueprint/Runtime object shape (member-key counts, semantic-slot-map key counts, or any
  `[Payload] extends [never]` heuristic). A capability can be explicitly-declared-empty (`slots: never`,
  `properties: Record<never, never>`, ...) and still present; shape-based heuristics cannot distinguish
  that from absence. The type-level mirror is `HasWidgetCapability<Interfaces, Key>`, never
  `[WidgetCapabilityOf<Interfaces, Key>] extends [never]`.
- Property and every diagnostics projection (`useStateDiagnostics`/`usePropertyDiagnostics`/
  `useMethodDiagnostics`/`useDiagnostics`) are publicly typed `ReadonlyRef<T>` (`Readonly<Ref<T>>`), never `ComputedRef<T>`: they
  are backed by `customRef()`, a plain `Ref`, and `ComputedRef` would over-promise computed-only public
  surface (e.g. `.effect`) that does not exist at runtime. `WidgetSlot`'s public type is a non-callable
  component/constructor shape (`new () => { $props }`), never `FunctionalComponent`, because the shared
  runtime value is a `defineComponent()` output, not a plain callable function.
- `createWidgetVueRenderer` validates exactly-once renderer coverage (and that every registered value is a component) against the actual bound
  `WidgetSystem` instance at construction time, and the returned component validates the `runtime` prop (object, same core copy,
  then `runtime.blueprint.system === boundSystem`) when it is first given a Runtime. Both are programmer/configuration
  exceptions (`WidgetVueIntegrationError`), never a Widget Issue.
- The root renderer never calls `runtime.dispose()`, on unmount or on `runtime` prop replacement.
  Runtime lifetime is owned by the caller.
- Server rendering of the renderer against a long-lived or shared Runtime is an accepted non-goal (Discussion #12 amendment
  "`@deviltea/widget-vue` does not support server rendering against long-lived Runtimes") and leaks subscriptions: bridge
  subscriptions are released only by `onScopeDispose`, which Vue's server renderer never runs. There is no SSR code path, flag,
  or hydration guarantee, and client-only mounting is the supported pattern; do not add ad-hoc SSR branches, flags, or hydration
  behavior without a new amendment. The README and the docs page state this same scope.

## Unit-test standard

Follow the conformance matrix recorded in `DevilTea/deviltea-labs#13` checkpoint G: type-level conformance (registry
typestate, arbitrary string keys, broadened-`string`-universe rejection, exact `useWidget(Plugin)`
capability/member/slot inference, absent-vs-explicitly-empty), lazy bridge invariants (activation
timing, subscription counts, identity stability), state/property/method/diagnostics conformance, and
renderer/topology + root lifecycle mounted tests. Use real `@deviltea/widget-core` fixtures
(`test-fixtures.ts`) — never a parallel mocked semantic core. Test public behavior with precise,
discriminating assertions (exact values, ordering, activation counts, object identity where the
contract promises it); coverage percentage alone is not evidence of correctness.

Widget identity (`widgetId`/`widgetType`, `use-widget-identity.unit.test.ts`) pins the checkpoint
amendment's four conformance points: value equals the current Runtime widget instance id/type;
`widgetType` retains the exact `Plugin['type']` TypeScript type (`expectTypeOf`), never a widened
`string`; identity is available regardless of declared capabilities (a zero-capability `BarePlugin`
fixture); the exact-plugin runtime assertion (`assertWidgetMatchesPlugin`) remains authoritative —
identity is only ever read after it has already succeeded.
