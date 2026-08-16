# AGENTS.md — widget-lab

Current-state operating guide for this app. GitHub issue #13 is the canonical Widget Lab decision
log (architecture checkpoints, accepted trade-offs, historical rationale); issue #10 is the semantic
authority for `@deviltea/widget-core` that this app never reinterprets. This file describes what is
true in the repository right now so a fresh agent can work without replaying the issue timeline —
when it conflicts with repo reality, fix this file; when it conflicts with #10/#13 decisions, the
issues win.

## Scope and layout

Private, never-published workspace application with two roles:

1. **Lab shell** — workbench, live JSON source editing with an explicit Apply lifecycle, Preview,
   and readonly Blueprint/Runtime/Dependency Graph inspectors over `@deviltea/widget-core` /
   `@deviltea/widget-vue`.
2. **Released showcases** — switchable via the header's showcase selector, all served by the same
   shell and Apply pipeline: `Sandbox` (minimal fixtures), Showcase A `Interactive Survey`, and
   Showcase B `Sales Pipeline CRM`.

The app deploys to GitHub Pages together with `docs/site` (see "Deployment" below).

- `src/lab/` — framework-agnostic, unit-tested Apply lifecycle logic: `LabSession` (draft/active
  snapshot state machine, `types.ts`) and the shared cross-inspector focus store (`focus.ts`). No Vue
  import here on purpose — this is the regression-worthy core, independently testable.
- `src/composables/use-lab-store.ts` — the one place that bridges `LabSession`/focus store into Vue
  `computed()` refs and supplies the `LabSessionHooks` seam (`detachPreview`/`mountPreview`) that
  guarantees unmount-before-dispose ordering via `nextTick()`. Owns `switchShowcase()` — the
  application-level replacement operation (teardown old Runtime → switch showcase context → load
  showcase source → same Apply pipeline), serialized with Apply/preset/revert through one
  `enqueue()` promise chain. Also owns `graphShowAbsent`/`graphShowIsolatedMembers` — Dependency
  Graph presentation preferences that deliberately live as plain refs on the `LabStore` object
  itself (not derived from `session`) so they survive Apply.
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
- `src/composables/use-graph-edge-selection.ts` — panel-local Graph edge-selection state (edge
  selection never expands into the shared cross-inspector focus).
- `src/runtime-inspector/viewmodel.ts` — framework-agnostic passive view models
  (`createStateMemberViewModel`/`createPropertyMemberViewModel`) over `RuntimeStateInspection`/
  `RuntimePropertyInspection`. Calls only `getSnapshot()`/`subscribe()` — never `state.get()`/
  `property.get()` — so opening/subscribing an inspector can never activate a lazy Property.
- `src/graph/` — the Dependency Graph's pure projection/layout pipeline; see "Dependency Graph" below.
- `src/lib/issue-format.ts` — shared structured-issue formatting helpers (`formatIssuePath`,
  `formatDependencyReference`, ...) reused by `blueprint/IssueList.vue` and
  `runtime/RuntimePropertyIssueList.vue`. `message` is never parsed for structure; every field beyond it
  comes from `issue.source`.
- `src/components/` — the app shell: `LabHeader.vue` (compact header: showcase selector, preset,
  status, Apply), `Workbench.vue` (`dockview-vue` two-column default layout), `NonClosableTab.vue`
  (a custom Dockview `tabComponent` — issue #27 Finding 2: registered as `tabComponents.nonClosable` and
  selected via `AddPanelOptions.tabComponent` on each of the five canonical panels' `addPanel()` calls, it
  renders only a title, no close control, so those panels can never be closed; Dockview's own `Tab`
  wrapper — drag/reorder/dock/resize/activate — is untouched, since a `tabComponent` only replaces what
  that wrapper renders as content), `panels/*` (Source/Blueprint/Runtime/Graph tabs), `preview/PreviewPanel.vue`,
  `blueprint/*` (the Blueprint Inspector's tree + selected-node detail + issue list), `runtime/*` (Runtime
  Inspector's member rows + property-issue list), `graph/*` (the Vue Flow canvas + panel-local edge
  details).
- `src/App.vue` also renders a narrow-viewport gate (issue #27 Finding 3): a pure CSS
  `@media (max-width: 899px)` rule (no JS resize listener/state) shows a `position: fixed` explanatory
  overlay ("Widget Lab is designed for a desktop-sized viewport. Widen the window to continue.") covering
  the whole viewport below 900px width, and hides it again above that width; `Workbench`/Dockview stay
  mounted underneath rather than being torn down.
- `src/sandbox/` — the `Sandbox` showcase: small, Lab-private fixtures (plugins, a `WidgetSystem`, a
  `createWidgetVueRenderer` registry, preset source texts) whose only job is to exercise the shell
  with minimal semantic surface. Product-shaped showcases live in `src/showcases/`, never here;
  sandbox fixtures must stay small.
- `src/showcases/` — the released product showcases and their registry:
  - `registry.ts` — the deliberately minimal `{ id, label, system, renderer, presets }` lookup table
    (no routing, no persistence) consumed by `use-lab-store.ts`'s `switchShowcase`. Plugin-tuple
    types are erased to `WidgetSystem<AnyWidgetPluginTuple>` on purpose — consumers only need object
    identity.
  - `survey/` — Showcase A: Interactive Survey (trip-planning domain). `domain.ts` (pure domain
    helpers), `plugins/` (semantic plugins, unit-tested), `renderers/` (Vue renderer components),
    `system.ts`, `presets.ts`, `test-support.ts`.
  - `crm/` — Showcase B: Sales Pipeline CRM. Same internal organization as `survey/` (`domain.ts`,
    `plugins/`, `renderers/`, `system.ts`, `presets.ts`, `test-support.ts`), with a deliberately
    richer widget vocabulary (store/query/form/table/modal/metric plugins and renderers).
  - Business/semantic rules (scoring, staging, validation, derived read models) belong in each
    showcase's `plugins/`/`domain.ts`, never in renderer glue — renderers present semantics, they do
    not compute them.
- `pika.config.ts` — the Lab's small PikaCSS token set (`variables.definitions`, safe-listed so the
  hand-authored `src/styles/dockview-theme.css` can reference them via plain `var()`).
- `src/**/*.unit.test.ts` — colocated Vitest unit tests for `src/lab/`, `src/graph/`,
  `src/runtime-inspector/`, `src/sandbox/`, `src/composables/` and `src/showcases/**` (plugins,
  presets, and selected renderer contracts via `@vue/test-utils` + `happy-dom`), run by both this
  app's own `vitest.config.ts` and the root config.

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

## Deployment (GitHub Pages)

The Lab deploys as part of the docs Pages artifact: `.github/workflows/docs.yml` runs
`pnpm docs:build:pages` (`scripts/build-pages.ts`), which builds `widget-lab` **and its workspace
dependencies** in topological order with `WIDGET_LAB_BASE=/deviltea-labs/widget-lab/` (consumed by
`vite.config.ts`'s `base`), builds `docs/site`, then copies the Lab build under the docs dist's
`widget-lab/` subdirectory. `docs/site` and `apps/widget-lab` remain separate source/application
boundaries — only build output is combined. If you touch the Lab's asset/worker URL behavior, verify
it still resolves under that subpath, not just under `/`.

`modern-monaco`'s editor engine is self-hosted rather than loaded from its default esm.sh CDN — see
issue #30 Scope A. `vite-plugin-vendor-modern-monaco-editor-core.ts` (project root, alongside
`vite.config.ts`) reads `editor-core.mjs` plus its two Worker-chain siblings
(`editor-worker-main.mjs`, `editor-worker.mjs`) straight out of `modern-monaco`'s installed
`node_modules` package — never committed to git — and (a) serves them from Vite dev middleware at
`/vendor/modern-monaco/*.mjs`, (b) `emitFile`s them into the production bundle at the same relative
path under `dist/`. Its `transformIndexHtml` hook injects a base-aware `<script type="importmap">`
mapping the bare specifier `modern-monaco/editor-core` to that URL, which `modern-monaco`'s own
`loadMonaco()` reads and prefers over its esm.sh fallback — this is `modern-monaco`'s documented "load
editor modules from a custom CDN" mechanism, just pointed at same-origin output instead of another
host. Because the plugin reads `config.base` at `configResolved` time, the importmap resolves
correctly under both plain `/` builds and the `WIDGET_LAB_BASE` subpath build above. See
`use-monaco-editor.ts`'s `ensureMonaco()` for the other half (the removed `defaultTheme` option that
used to trigger a separate, unrelated esm.sh fetch for the theme JSON).

## Loading policy

Intentional, not incidental (issue #30 Scope B) — the production artifact's chunk shape, verified by
building this app in isolation:

```text
main app JS (index-*.js)                ~742 KB raw / ~204 KB gzip  — eager
modern-monaco/core package JS (core-*.js) ~763 KB raw / ~275 KB gzip — loaded when Source mounts
vendored editor-core.mjs                ~7.93 MB raw / ~1.41 MB gzip — loaded when Source mounts
vendored editor-worker(-main).mjs       ~566 KB raw / ~119 KB gzip  — loaded on first Monaco worker use
ELK layout worker (layout.worker-*.js)  ~1.91 MB raw / ~465 KB gzip — loaded on first Graph layout
CSS (index-*.css)                       ~120 KB raw / ~11 KB gzip   — eager
```

- **Eager**: the main app chunk and its CSS — `App.vue`, `Workbench.vue`, `LabStore`/`LabSession`,
  every panel *shell* (not necessarily every panel's heavy dependency, see below), the Sandbox/Survey/
  CRM showcases, `dockview-vue`. This is unavoidable critical-path weight for a workbench app whose
  shell has to exist before any panel can render.
- **`modern-monaco/core` (package JS + vendored `editor-core.mjs`)**: not in the eager chunk —
  `import('modern-monaco/core')` in `use-monaco-editor.ts`'s `ensureMonaco()` is Vite's own code-split
  boundary for the package JS (the LSP-free submodule — the side-effectful main entry that
  force-enabled `useBuiltinLSP` and carried ~740 KB of unused LSP/grammar code is deliberately not
  imported anywhere), and
  `editor-core.mjs` is never in Vite's module graph at all (loaded by `modern-monaco` itself via the
  importmap-resolved dynamic `import()` described in "Deployment" above). Both are still fetched
  **during initial load today**, though: `SourcePanel.vue` renders `MonacoJsonEditor` unconditionally,
  Dockview mounts every one of the five canonical panels' Vue components as soon as `Workbench.vue`'s
  `onReady()` calls `addPanel()` for it (`inactive: true` only controls which tab is initially
  *selected*, not whether Dockview mounts the panel's content — verified: dockview-vue keeps every
  panel's rendered content in the DOM, not just the active one), and Source is the panel added first /
  made the active tab. So `MonacoJsonEditor`'s `onMounted` runs immediately on app load regardless of
  which tab a user looks at. This is an accepted, documented trade-off, not an oversight: Source is the
  Lab's default and most-used surface, so paying its cost immediately is preferable to adding a
  mount-gate (`v-if` on tab activity) whose only benefit is deferring, never avoiding, that cost for the
  overwhelmingly common path where a user opens Source anyway. If onboarding/information-architecture
  ever makes Source not the default active panel, revisit gating `MonacoJsonEditor`'s mount on the tab
  actually being active rather than merely present.
- **ELK layout worker**: same eager-on-load shape as Monaco, for the same underlying reason, and this
  predates this issue's change — verified by loading the built app fresh (no tab interaction) and
  observing `layout.worker-*.js` requested immediately. `layout-client.ts`'s `ensureElk()` still only
  creates the `Worker` on the *first* `layoutGraph()` call rather than as an import-time side effect
  (so it is "lazy" in the narrow sense that comment describes), but that first call happens during
  initial mount today because `GraphPanel.vue` (like Blueprint/Runtime) is mounted immediately by
  Dockview per the same paragraph above, and its `useDependencyGraph()` composable's
  `watch(semanticGraph, ...)` fires as soon as the app's initial default-preset Apply produces the
  first real Blueprint — before any user ever opens the Graph tab. Runtime state/property/method
  activity still never re-triggers a relayout (that guarantee is unaffected and unrelated to this
  paragraph); what does not currently hold is "ELK stays uninitialized until a user opens Graph." Fixing
  that would mean gating panel *mount* (not just tab selection) on Dockview activity for Blueprint/
  Runtime/Graph, which is a Workbench/Dockview panel-lifecycle change out of scope for issue #30 — noted
  here as known, current-state behavior rather than silently left undocumented.
- Neither of the two heavy, on-load fetches above is a *regression*: this document only makes explicit
  what was already true before this issue's change (Monaco and ELK both already loaded on initial mount
  before self-hosting), and self-hosting Monaco's engine does not move it into, or out of, that eager
  path — it only removes the esm.sh dependency for the fetch that already happened at that same moment.

## Package boundaries

This app is a private downstream consumer and architecture probe. It owns the Lab shell, inspectors,
live source workflow, and the showcases. It must not own, and must not gain:

- any part of `@deviltea/widget-core`'s semantic compiler/runtime, or `@deviltea/widget-vue`'s
  renderer/lifecycle/reactivity adapter surface — both are consumed exclusively through their public
  entry points (`@deviltea/widget-core`, `@deviltea/widget-core/inspection`, `@deviltea/widget-vue`);
  no private/internal import from either package;
- persistence/versioning/migration of any kind — `LabSession`'s `draftSourceText`/`active` snapshot is
  in-memory only, and Monaco's own workspace/IndexedDB machinery is deliberately not used (see
  `use-monaco-editor.ts`) so it can never become a second, competing source of truth;
- an editor-command/undo architecture — Source text editing plus explicit Apply is the whole model.

When Lab work exposes a genuine gap in widget-core/widget-vue's public contract, canonicalize it on
GitHub (#10/#13) instead of silently working around it in Lab-private code — implementation evidence
may challenge architecture, but never rewrites it locally.

## Inspectors are readonly

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

## Runtime Inspector is strictly passive

`src/components/panels/RuntimePanel.vue` and `src/components/runtime/*` consume `inspectRuntime()`
readonly. State members render `RuntimeStateInspection.getSnapshot()`/`subscribe()` only — never
`state.get()`. Property members render `Never evaluated` until `RuntimePropertyInspection`'s snapshot
reports `status: 'completed'` — the latest `ExecutionResult` some *real* Runtime consumer (Preview)
naturally produced — and never `fresh`/`dirty`/`active`/`stale` labels. Methods are inventory only (name
+ the compiler's `transitivelyWrites` fact); there is no invocation affordance. An invalid Blueprint
keeps the Runtime tab present with an unavailable/blocked message (`store.active.value.runtime === null`)
rather than hiding it. `src/runtime-inspector/viewmodel.ts` is the passive-projection layer this panel
is built on — see its file-level comment and colocated tests for the exact contract.

## Dependency Graph

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
applied Blueprint resets that shared focus to the new root.

Viewport fit is coordinated with layout readiness, not `fitViewOnInit` (issue #27 Finding 1):
`GraphCanvas.vue` calls `useVueFlow()` before its own template renders `<VueFlow>` (creating and
`provide()`-ing a store `<VueFlow>` then injects, per `@vue-flow/core`'s documented same-component-instance
pattern) and calls `fitView()` from `onNodesInitialized`. Because `GraphPanel.vue` renders `GraphCanvas`
behind `v-if="flow !== null"`, and every new laid-out semantic graph transits through `flow === null`
first (`LayoutSession.request()` sets `status: 'loading'` synchronously), `GraphCanvas` fully
unmounts/remounts for every new graph — so this single `onNodesInitialized` hook covers first mount and
every subsequent semantic-graph replacement without special-casing either, and Runtime activity (which
never replaces `flow`) never re-triggers it. `GraphPanel.vue` also exposes an explicit **Fit graph**
button (next to the filter checkboxes) that calls the same `fitGraph()` path via a template ref —
`GraphCanvas.vue` remains the only place in this app that imports `@vue-flow/core`.

## Layout worker boundary

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

## Apply lifecycle

Editing the Source panel only ever mutates `LabSession.draftSourceText`; it never recompiles. Apply is
the one explicit command that crosses the applied-snapshot boundary, following the ordering `detach
Preview -> dispose old Runtime -> commit new Blueprint -> create Runtime if valid -> mount Preview` (see
`src/lab/session.ts` and its unit tests for the full contract: parse-failure isolation, concurrent-apply
guard, draft-capture-at-command-start, invalid-Blueprint -> `runtime: null`, and the disposal-ordering
seam). Do not add a second path that recompiles outside `LabSession.apply()`/`applyPreset()` — presets,
Format, Revert, and `switchShowcase()` all route through the same session/store queue, never around it.

## Active follow-up backlog

Post-convergence usability/hardening work is tracked on GitHub; read the issue before working in its
area, and keep implementation truth in those threads rather than expanding this file:

- issue #25 — guided onboarding/tutorial + curated widget/component implementation source explorer;
- issue #26 — Survey semantic presentation correctness (result freshness, failed-Property display,
  dependency-issue propagation);
- issue #27 — Graph/workbench correctness and recovery;
- issue #28 — real-browser contract tests + baseline accessibility semantics;
- issue #29 — this document's current-state refresh;
- issue #30 — self-contained deployment / Monaco self-hosting / lazy-loading policy.

## Testing

Intended split for this app:

```text
framework-agnostic semantic/viewmodel logic -> Vitest unit tests
browser/workbench/DOM/focus/integration behavior -> narrow real-browser contracts
```

Unit tests are colocated `*.unit.test.ts` against real `@deviltea/widget-core` fixtures (no mocked
core): `src/lab/`, `src/graph/`, `src/runtime-inspector/`, `src/sandbox/`, `src/composables/`, and
`src/showcases/**` (plugin semantics, preset validity, and selected renderer contracts via
`@vue/test-utils` + `happy-dom`). The real-browser contract harness is being introduced by issue #28;
until it lands, workbench/editor/browser-integration behavior has no automated coverage here — do not
compensate by writing broad DOM-simulation tests for it, and once the harness exists, put
browser-semantics assertions (focus, keyboard navigation, dialog behavior) there instead of in
happy-dom unit tests.

Root AGENTS.md's coverage policy lists the packages whose runtime source joins the root Vitest V8
coverage report; this app is **not** on that list and its sources are excluded from the coverage
`include`/`exclude` lists in the root `vitest.config.ts`; it still participates in `pnpm test:unit` via
`test.include`. Rationale: this is a private application shell, not a published package, and much of
its code is UI/editor/workbench chrome (Monaco, Dockview, template-heavy panels) whose value is
covered by browser contracts rather than the unit-coverage gate — folding it into the repo's
90%-threshold coverage gate would either force low-value DOM-simulation tests or silently lower the
bar for everything the gate already protects. The ELK layout Worker itself
(`src/graph/layout.worker.ts`) is deliberately excluded from unit testing — it is kept thin by design
(see "Layout worker boundary" above) and `layout-session.ts`'s generation-guard tests exercise the
same contract against a fake `LayoutGraphFn` instead.
