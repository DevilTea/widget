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
- `src/types.ts` — the public `useWidget()` return-type surface (see the 0.3 typing rules under "Implementation rules").
- `src/errors.ts` — `WidgetVueIntegrationError` and `WidgetVueIntegrationErrorCode`, the single programmer/configuration exception class. Consumers discriminate by class and `code` (never `message`); the codes are `invalid-renderer-registry` (with frozen `missingTypes`/`unknownTypes`/`duplicateTypes`/`invalidTypes`, `null` for every other code). It is an ordinary exported `class WidgetVueIntegrationError extends Error` (stable `constructor.name` under every transform, subclassable); the instance type is deliberately not a union discriminated by `code`, so the lists are typed `readonly string[] | null` and consumers handle `null`, `invalid-runtime`, `foreign-runtime`, `unknown-widget`, `runtime-system-mismatch`, `outside-widget-renderer`, `widget-plugin-mismatch`, and `readonly-projection-write`. Only caller-reachable misuse gets a code; states made impossible by exact-plugin, registry and System-identity validation are internal invariants and throw a plain `Error`. Add a code only for a materially different caller-reachable problem.
- `src/use-widget-jsdoc.unit.test.ts`, `src/use-widget-slot-types.unit.test.ts` and `src/use-widget-diagnostic-reasons.unit.test.ts` pin the 0.3 typing above (JSDoc through a TypeScript program over the test file with a key-union control; slot name and scope narrowing; typed `details`). The JSDoc test imports `typescript`, which resolves from the workspace root.
- `type-fixtures/` — `WidgetSlotNarrowing.vue` and its plugin, type-checked by `pnpm typecheck:vue` (vue-tsc, `strictTemplates`, `tsconfig.vue-fixtures.json`): the scoped `type` of each `<WidgetSlot name="…">` in a template is its slot's own union, and an unknown `name` is rejected. Never run or published.
- `src/test-fixtures.ts` — real `@deviltea/widget-core` plugins/system/runtime fixtures shared by the colocated tests. Not part of the public contract; excluded from `tsconfig.package.json`.
- `src/**/*.unit.test.ts` — colocated Vitest unit tests (run by the root config too).
- `skills/widget-vue-renderer/` — the Agent Skill this package ships (`SKILL.md`), listed in `files` and published with the package (Discussion #12 amendment "`@deviltea/widget-docs-generator` is a published package", point 3): registration, the root renderer, the `useWidget()` surface, slots and `WidgetSlot`, `/testing` and the integration errors. It is part of the package: a change to that API updates it in the same PR. Its `ts` samples are compiled, and run where marked `run`, by `scripts/docs-samples.unit.test.ts` like the documentation's (the testing sample needs a DOM, so it is `after`: type-checked only). The layout `skills/<name>/SKILL.md`, with a frontmatter `name` equal to the folder's name and a `description`, is what `npx skills` reads. Write the frontmatter as exactly two lines, `name: <lowercase-kebab>` and `description: "<one JSON double-quoted string>"`: the CLI parses it as YAML and silently skips a skill it cannot parse (an unquoted value holding `: `, for one), and the checks accept only this spelling; `scripts/package-skills.unit.test.ts` and CI's packed-consumer job (`scripts/packed-consumer-skills.mjs`) check it, and the root `skills.sh.json` lists `./packages/vue/skills`. The generated `<system>-renderer-implementation` skill (`@deviltea/widget-docs-generator`) refers to this skill for the API.

The published entries are exactly `.` (`src/index.ts`) and `./testing` (`src/testing.ts`); `tsdown.config.ts` keeps `@deviltea/widget-core` and `vue` external.
`@deviltea/widget-core` is a peer dependency (`workspace:^`, published as `^<version>`; this package is released together with Core, the Inspector and the documentation generator under one version, see the root `AGENTS.md` "Releasing"; with a `workspace:*` devDependency), never a regular dependency and never bundled: core recognizes its own Runtimes by module-local identity, so a second copy would make `emit` fail. The root renderer therefore checks Runtime provenance with core's `assertCoreRuntime` (from `@deviltea/widget-core/integration`) the first time it is given a Runtime.

## Commands

```bash
pnpm test        # vitest run for this package
pnpm typecheck   # package + tests tsconfig + the vue-tsc template fixtures
pnpm build       # tsdown (includes publint)
```

## Package boundaries (`DevilTea/deviltea-labs#13` checkpoint A)

This package owns the renderer/lifecycle/reactivity adapter surface only. It must not own:

- Lab showcase (Survey or any other) domain widgets
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
- 0.3 typing rules (Discussion #12, "Interfaces are the single source of a plugin's shape and documentation (0.3.0)"). The Interfaces type, with its JSDoc, is the one place a plugin is documented, so the public surface types in `src/types.ts` must keep that JSDoc on hover: every keyed surface (State, Property, Method, Event, and the three member-diagnostics surfaces) is a homomorphic mapped type over `keyof` the Interfaces section (key remapping with `as` keeps the `WidgetMemberKey` filter and the documentation), never a mapping over a key union such as `WidgetStateKeyOf<Interfaces>`, and `emit` is `UseWidgetEventEmitter`, not Core's `WidgetEventEmitter`. `use-widget-jsdoc.unit.test.ts` reads the documentation through the TypeScript checker; `expectTypeOf` cannot see it. Slots are a record: `WidgetSlot`'s `name` is the record's keys and the scoped slot's `type` is `WidgetSlotChildTypeOf<Interfaces, Name>` (the plain union's members or a contract's `Types` from Core's `WidgetSlotPluginTypeOf`, resolved per slot name, `string` when it is `never`, i.e. for any widget). The expectation is type-level only; this package adds no run-time check and does not read it. Diagnostics surfaces are typed with `ReasonedDiagnostic<Diagnostic, Interfaces>`: by `Interfaces['reasons']` when declared (a union discriminated by `reason`, `details` the reason's payload), Core's own shape otherwise; diagnostics without a `reason` field (dependency diagnostics) are never rewritten. The run-time value is always Core's diagnostic object, untouched.
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
  Its optional default scoped slot receives `{ Child, id, type, index }` (publicly typed as `WidgetSlotScope<Type>`, `Type` defaulting to `string`)
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
  generic component/constructor shape (`new <Name>(props: { readonly name: Name }) => { $props, $slots }`), never `FunctionalComponent`, because the shared
  runtime value is a `defineComponent()` output, not a plain callable function. The constructor must take the props: vue-tsc checks
  `<WidgetSlot name="header">` as `new WidgetSlot({ name: 'header' })`, and only a parameter infers `Name` (a parameterless
  constructor widens the scoped `type` to every slot's types). `type-fixtures/` holds the vue-tsc check of this.
- The keyed surfaces (`useState()`, `useProperties()`, `useMethods()`, `emit`, the diagnostics surfaces) map homomorphically over
  `keyof` the Interfaces section (so hover shows the member's JSDoc) and always with `-?`: every declared member has its accessor
  at run time, so an optional member is never an optional key.
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
