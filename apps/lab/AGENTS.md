# AGENTS.md — widget-lab

## Scope and layout

Private, never-published workspace application: the interactive Widget Lab shell — workbench, live
JSON source editing with an explicit Apply lifecycle, Preview, and readonly Blueprint/Runtime/Dependency
Graph inspectors — over `@deviltea/widget-core` / `@deviltea/widget-vue`. Normative source: GitHub
issue #13's Widget Lab Phase 4 and Phase 5 comments (package/app boundaries, implementation stack,
default workbench layout, Blueprint Inspector model, inspector panel interaction contract, Source Apply
lifecycle, readonly-inspector consumer updates, Runtime Inspector passivity, Dependency Graph semantic
representation/implementation stack/worker loading). Issue #10 (core) and issue #13's earlier
Vue-integration checkpoints remain the semantic authority this app never reinterprets.

- `src/lab/` — framework-agnostic, unit-tested Apply lifecycle logic: `LabSession` (draft/active
  snapshot state machine, `types.ts`) and the shared cross-inspector focus store (`focus.ts`). No Vue
  import here on purpose — this is the regression-worthy core, independently testable.
- `src/composables/use-lab-store.ts` — the one place that bridges `LabSession`/focus store into Vue
  `computed()` refs and supplies the `LabSessionHooks` seam (`detachPreview`/`mountPreview`) that
  guarantees unmount-before-dispose ordering via `nextTick()`. Also owns `graphShowAbsent`/
  `graphShowIsolatedMembers` — Dependency Graph presentation preferences that deliberately live as plain
  refs on the `LabStore` object itself (not derived from `session`) so they survive Apply.
- `src/composables/use-monaco-editor.ts` + `src/components/editor/MonacoJsonEditor.vue` — the entire
  `modern-monaco` integration surface. Nothing else in this app imports `modern-monaco`.
- `src/composables/use-runtime-member.ts` — Vue bridge for one Runtime Inspector member view model
  (`src/runtime-inspector/viewmodel.ts`): adapts its `getSnapshot()`/`subscribe()` shape into a ref and
  disposes the previous view model whenever the reactive observable source changes (different selected
  member, or a Runtime replaced by Apply) or the component unmounts.
- `src/composables/use-dependency-graph.ts` — Vue bridge for the Dependency Graph panel: projects
  `store.active.value.blueprint` through `projectSemanticGraph()` and drives a `LayoutSession`
  (`src/graph/layout-session.ts`) that only requests a fresh ELK layout when the projected graph itself
  changes (new Blueprint snapshot or a graph filter toggle) — never on Runtime activity.
- `src/runtime-inspector/viewmodel.ts` — framework-agnostic passive view models
  (`createStateMemberViewModel`/`createPropertyMemberViewModel`) over `RuntimeStateInspection`/
  `RuntimePropertyInspection`. Calls only `getSnapshot()`/`subscribe()` — never `state.get()`/
  `property.get()` — so opening/subscribing an inspector can never activate a lazy Property.
- `src/graph/` — the Dependency Graph's pure projection/layout pipeline; see "Dependency Graph" below.
- `src/lib/issue-format.ts` — shared structured-issue formatting helpers (`formatIssuePath`,
  `formatDependencyReference`, ...) reused by `blueprint/IssueList.vue` and
  `runtime/RuntimePropertyIssueList.vue`. `message` is never parsed for structure; every field beyond it
  comes from `issue.source`.
- `src/components/` — the app shell: `LabHeader.vue` (compact header: preset, status, Apply),
  `Workbench.vue` (`dockview-vue` two-column default layout), `panels/*` (Source/Blueprint/
  Runtime/Graph tabs), `preview/PreviewPanel.vue`, `blueprint/*` (the Blueprint Inspector's tree +
  selected-node detail + issue list), `runtime/*` (Runtime Inspector's member rows + property-issue
  list), `graph/*` (the Vue Flow canvas + panel-local edge details).
- `src/sandbox/` — small, Lab-private dev fixtures (plugins, a `WidgetSystem`, a
  `createWidgetVueRenderer` registry, and preset source texts). **Not** the "Interactive Survey" /
  "Product Prototype" showcases named in issue #13 Checkpoint A — those are a later phase. Sandbox
  fixtures exist only to exercise this shell and must stay small.
- `pika.config.ts` — the Lab's small PikaCSS token set (`variables.definitions`, safe-listed so the
  hand-authored `src/styles/dockview-theme.css` can reference them via plain `var()`).
- `src/**/*.unit.test.ts` — colocated Vitest unit tests for `src/lab/`, `src/graph/`,
  `src/runtime-inspector/` and `src/sandbox/` (run by both this app's own `vitest.config.ts` and the root
  config). UI/editor/workbench components are not unit tested this phase (see "Testing" below).

## Commands

```bash
pnpm dev         # vite dev server
pnpm build       # vite build
pnpm typecheck   # generates pika.gen.ts (see below), then vue-tsc over src/
pnpm test        # vitest run for this app's colocated *.unit.test.ts
```

`vite.config.ts`/`vitest.config.ts`/`pika.config.ts` themselves are not part of `pnpm typecheck`'s
program, matching every other package in this repo (none type-check their own bundler config files).
`pnpm typecheck` first runs `pika:codegen` (`scripts/pika-codegen.mjs`), which generates
`src/pika.gen.ts` directly through `@pikacss/integration` — the same file `@pikacss/unplugin-pikacss`'s
Vite plugin would otherwise only produce as a side effect of an actual `pnpm dev`/`pnpm build` pass, and
which augments Vue's `ComponentCustomProperties` so `pika()` type-checks inside `<template>`. This keeps
`pnpm typecheck` correct on a clean checkout without requiring a prior dev/build run.

## Package boundaries (issue #13 Phase 4 Checkpoint A)

This app is a private downstream consumer and architecture probe. It owns the Lab shell, inspectors,
live source workflow, and (eventually) showcase applications. It must not own, and must not gain:

- any part of `@deviltea/widget-core`'s semantic compiler/runtime, or `@deviltea/widget-vue`'s
  renderer/lifecycle/reactivity adapter surface — both are consumed exclusively through their public
  entry points (`@deviltea/widget-core`, `@deviltea/widget-core/inspection`, `@deviltea/widget-vue`);
  no private/internal import from either package;
- Survey/Product Prototype domain widgets (a later phase) — `src/sandbox/` is fixtures, not showcases;
- persistence/versioning/migration of any kind — `LabSession`'s `draftSourceText`/`active` snapshot is
  in-memory only, and Monaco's own workspace/IndexedDB machinery is deliberately not used (see
  `use-monaco-editor.ts`) so it can never become a second, competing source of truth;
- deployment/hosting concerns — this phase does not touch the docs Pages workflow.

## Inspectors are readonly (issue #13 Phase 4 "readonly inspection" updates)

Blueprint/Runtime/Graph panels consume `@deviltea/widget-core/inspection` (`inspectBlueprint`,
`inspectRuntime`) as pure, passive projections. They must never:

- call `state.set()`, invoke a Method, or otherwise force Property evaluation from inspector UI;
- reconstruct semantic status from Issues, or run their own graph/SCC analysis — every fact comes from
  core's compiler/runtime-authoritative data;
- treat `issue.message` as a machine protocol — only `issue.source.type` and structured `related`
  locations drive navigation/rendering.

Real semantic interaction (State/Property/Method activity) stays exclusively in Preview
(`src/components/preview/PreviewPanel.vue`, via `useWidget()` from `@deviltea/widget-vue`). There is no
`Observe` action and no editor-domain operation anywhere in an inspector panel.

## Runtime Inspector is strictly passive (issue #13 Phase 5 "Runtime Inspector becomes strictly passive")

`src/components/panels/RuntimePanel.vue` and `src/components/runtime/*` consume `inspectRuntime()`
readonly. State members render `RuntimeStateInspection.getSnapshot()`/`subscribe()` only — never
`state.get()`. Property members render `Never evaluated` until `RuntimePropertyInspection`'s snapshot
reports `status: 'completed'` — the latest `ExecutionResult` some *real* Runtime consumer (Preview)
naturally produced — and never `fresh`/`dirty`/`active`/`stale` labels. Methods are inventory only (name
+ the compiler's `transitivelyWrites` fact); there is no invocation affordance. An invalid Blueprint
keeps the Runtime tab present with an unavailable/blocked message (`store.active.value.runtime === null`)
rather than hiding it. `src/runtime-inspector/viewmodel.ts` is the passive-projection layer this panel
is built on — see its file-level comment and colocated tests for the exact contract.

## Dependency Graph (issue #13 Phase 5 "semantic representation" / "implementation stack" comments)

`src/graph/` implements the readonly projection pipeline behind `src/components/panels/GraphPanel.vue`:

```text
BlueprintInspection -> projectSemanticGraph() -> toElkGraph() -> ELK layout -> toVueFlow()
```

- `types.ts` / `projection.ts` — the Lab's semantic graph shape and its pure, deterministic projection.
  Widgets are visual clusters (`GraphCluster`); State/Property/Method members are the semantic vertices
  (`GraphVertex`) — never collapsed into widget-to-widget edges. Edge direction is owner -> declared
  dependency target; `state-get`/`property-get` project as `reads`, `method-invoke` as `invokes`,
  `state-set` (Method-only) as `writes`. `resolved` dependencies become `GraphEdge`s; `absent`/`invalid`
  become presentation-only `GraphStub`s, never a fabricated resolved edge. `absent` stubs (and any member
  with no other visible relation) are hidden unless the panel's `showAbsent`/`showIsolatedMembers`
  filters are on; `invalid` stubs are always visible. `transitivelyWrites` and `invalidCycles` are
  projected verbatim from core inspection facts — this module never recomputes either.
- `elk-adapter.ts` — pure `toElkGraph()`/`fromElkResult()`, the JSON-shape boundary to ELK's graph
  schema. Type-only `elkjs` import (`elkjs/lib/elk-api`); no `ELK` instantiation here, so it is
  unit-testable without a worker or the real elkjs runtime.
- `layout.ts` — the shared `LayoutedGraph`/`LayoutGraphFn` adapter shapes.
- `layout-session.ts` — `createLayoutSession(layoutFn)`: framework-agnostic, generation-guarded async
  wrapper around any `LayoutGraphFn` (real or a test fake). A layout result for a superseded `request()`
  call is discarded — this is what makes Graph layout safe as an asynchronous projection that never
  blocks Blueprint/Runtime/Preview availability (see "Layout worker boundary" below).
- `vue-flow.ts` — `toVueFlow()`: the laid-out `SemanticGraph` -> plain Vue Flow `nodes`/`edges`. Every
  node is `draggable: false`/`connectable: false` and no edge is `updatable` — Vue Flow is viewer-only
  here (pan/zoom/fit/readonly selection), never graph editing.
- `src/components/graph/GraphCanvas.vue` — the only place in this app that imports `@vue-flow/core`
  (and its structural `dist/style.css`); custom node templates for `cluster`/`member`/`stub`, themed
  through PikaCSS tokens rather than Vue Flow's own default theme CSS.
- `src/components/graph/GraphEdgeDetails.vue` — panel-local edge-selection details (dependency-container
  `path` + reference target/operation) — edge selection stays local, never expands into shared focus.

Graph works for an invalid Blueprint (compile-time facts only, no Runtime dependency) and its node click
sets the shared cross-inspector focus (`nodeId` + member) the same way Blueprint/Runtime do; a new
applied Blueprint resets that shared focus to the new root exactly as it already did before this phase.

## Layout worker boundary (issue #13 Phase 5 "Dependency Graph worker loading" comment)

- `src/graph/layout.worker.ts` — the actual persistent Vite module Worker
  (`new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })`, created lazily in
  `layout-client.ts` and kept alive for the Lab's lifetime rather than a one-shot Blob Worker per
  request). Deliberately a single side-effect import — `import 'elkjs/lib/elk-worker.js'` — because
  elkjs itself splits into two halves: `elk-api.js`'s `ELK` class is the *requesting*-side orchestrator
  (owns a `Worker` handle, does promise/request-id bookkeeping), while `elk-worker.js` is the actual
  layout algorithm and self-registers `self.onmessage` the instant it runs inside a Worker. This keeps
  the worker file itself thin (nothing worth unit-testing there — it is excluded from the test suite by
  design) and avoids the `elk.bundled.js` browser bundle, which still spawns its *own* nested Worker
  internally and is not suitable for running a second layer deep inside a Worker we already own.
- `src/graph/layout-client.ts` — the main-thread side: wraps that persistent Worker with elkjs's own
  `ELK` class (`workerFactory: () => worker`, reusing elkjs's protocol instead of hand-rolling a second
  one) behind the `layoutGraph(graph): Promise<LayoutedGraph>` adapter, plus `disposeLayoutWorker()`
  (called from `App.vue`'s `onUnmounted` — app lifecycle cleanup, unrelated to widget-core Runtime
  disposal, which `LabStore.dispose()` already owns separately).
- Only `src/composables/use-dependency-graph.ts`'s projected-graph `watch` triggers a `layoutGraph()`
  request (via `LayoutSession.request()`) — Runtime state/property/method activity never touches
  `store.active.value.blueprint` and therefore never relayouts.
- `vite.config.ts`'s `worker: { format: 'es' }` keeps this Worker's own `elkjs` import going through
  normal Vite ESM bundling.

## Apply lifecycle (issue #13 Phase 4 "Source Apply lifecycle" comment)

Editing the Source panel only ever mutates `LabSession.draftSourceText`; it never recompiles. Apply is
the one explicit command that crosses the applied-snapshot boundary, following the ordering `detach
Preview -> dispose old Runtime -> commit new Blueprint -> create Runtime if valid -> mount Preview` (see
`src/lab/session.ts` and its unit tests for the full contract: parse-failure isolation, concurrent-apply
guard, draft-capture-at-command-start, invalid-Blueprint -> `runtime: null`, and the disposal-ordering
seam). Do not add a second path that recompiles outside `LabSession.apply()`/`applyPreset()` — presets,
Format, and Revert all route through the same session, never around it.

## Testing

Root AGENTS.md's coverage policy lists the packages whose runtime source joins the root Vitest V8
coverage report; this app is **not** on that list and its sources are excluded from the coverage
`include`/`exclude` lists in the root `vitest.config.ts`; it still participates in `pnpm test:unit` via
`test.include`. Rationale: this is a private application shell, not a published package, and most of
its code is UI/editor/workbench chrome (Monaco, Dockview, template-heavy panels) that this phase
explicitly does not require unit/e2e coverage for — folding it into the repo's 90%-threshold coverage
gate would either force out-of-scope UI tests this phase or silently lower the bar for everything the
gate already protects. `src/lab/`, `src/graph/`, `src/runtime-inspector/` and `src/sandbox/` — the
actual regression-worthy logic — are unit-tested regardless (against real `@deviltea/widget-core`
fixtures, no mocked core); that value does not depend on being counted by the coverage gate. The ELK
layout Worker itself (`src/graph/layout.worker.ts`) is deliberately excluded from that testing — it is
kept thin by design (see "Layout worker boundary" above) and `layout-session.ts`'s generation-guard tests
exercise the same contract against a fake `LayoutGraphFn` instead.
