# AGENTS.md — widget-lab

Current-state operating guide for this app. GitHub issue #13 is the historical Widget Lab decision
log; issue #60 tracks the current post-`WidgetDocument` Lab redesign and accepted migration decisions;
issue #10 (with its detailed source/document design in #54) is the semantic authority for
`@deviltea/widget-core` that this app never reinterprets. This file describes what is
true in the repository right now so a fresh agent can work without replaying the issue timeline —
when it conflicts with repo reality, fix this file; current accepted decisions in #10/#54/#60 win over
stale prose here or historical #13 checkpoints that #60 explicitly supersedes.

## Scope and layout

Private, never-published workspace application with two roles:

1. **Lab shell** — the two-column workbench's `Author` workspace (Catalog/Structure/JSON), Preview,
   and readonly Blueprint/Runtime/Dependency Graph inspectors over `@deviltea/widget-core` /
   `@deviltea/widget-vue`.
2. **Released showcases** — switchable via the header's showcase selector, all served by the same
   shell and Document-backed authoring model: `Sandbox` (minimal fixtures), Showcase A `Interactive Survey`, and
   Showcase B `Sales Pipeline CRM`.

The app deploys to GitHub Pages together with `docs/site` (see "Deployment" below).

- `src/lab/` — framework-agnostic, unit-tested authoring/runtime-host lifecycle logic: `LabSession`
  (JSON draft + authoritative `WidgetDocument` mutation + Runtime promotion, `types.ts`), `author.ts`
  (high-level Structure commands lowered to `SourcePatch`), and the shared
  cross-inspector focus store (`focus.ts`). No Vue
  import here on purpose — this is the regression-worthy core, independently testable.
- `src/composables/use-lab-store.ts` — the one place that bridges `LabSession`/focus store into Vue
  `computed()` refs and supplies the `LabSessionHooks` seam (`detachPreview`/`mountPreview`) that
  guarantees unmount-before-dispose ordering via `nextTick()`. Owns `switchShowcase()` — the
  application-level whole-context replacement operation (teardown old Runtime → create target
  revision-0 Document/Runtime → mount it), serialized with Apply/preset/revert through one
  `enqueue()` promise chain. Also owns `graphShowAbsent`/`graphShowIsolatedMembers` — Dependency
  Graph presentation preferences that deliberately live as plain refs on the `LabStore` object
  itself (not derived from `session`) so they survive Apply.
- `src/composables/use-monaco-editor.ts` + `src/components/editor/MonacoJsonEditor.vue` — the entire
  `modern-monaco` integration surface. Nothing else in this app imports `modern-monaco`.
- `src/composables/use-runtime-member.ts` — Vue bridge for one Runtime Inspector member view model
  (`src/runtime-inspector/viewmodel.ts`): adapts its `getSnapshot()`/`subscribe()` shape into a ref and
  disposes the previous view model whenever the reactive observable source changes (different selected
  member, or a Runtime replaced by Apply) or the component unmounts.
- `src/composables/use-dependency-graph.ts` — Vue bridge for the Dependency Graph panel: projects the
  current Document Blueprint through `projectSemanticGraph()` and drives a `LayoutSession`
  (`src/graph/layout-session.ts`) that only requests a fresh ELK layout when the projected graph itself
  changes (new Blueprint snapshot or a graph filter toggle) — never on Runtime activity.
- `src/composables/use-document-tools.ts` — request-only bridge for the lazy, closable Phase 6 Document
  Tools developer panel; it owns no Document state and only asks `Workbench.vue` to add or activate the
  panel, paralleling the Implementation explorer lifecycle.
- `src/composables/use-graph-edge-selection.ts` — panel-local Graph edge-selection state (edge
  selection never expands into the shared cross-inspector focus).
- `src/runtime-inspector/viewmodel.ts` — framework-agnostic passive view models
  (`createStateMemberViewModel`/`createPropertyMemberViewModel`) over `RuntimeStateInspection`/
  `RuntimePropertyInspection`. Calls only `getSnapshot()`/`subscribe()` — never `state.get()`/
  `property.get()` — so opening/subscribing an inspector can never activate a lazy Property.
- `src/graph/` — the Dependency Graph's pure projection/layout pipeline; see "Dependency Graph" below.
- `src/implementation/` — the curated Implementation source explorer's framework-agnostic core (issue
  #25 P3): `types.ts` (`SourcesRegistry`/`CuratedSourceFile` — metadata only, `load()` thunks are the
  lazy boundary), `registry-coverage.ts` (dangling/uncurated-type sanity used by unit tests),
  `applied-instance.ts` (pure extraction of a widget's own JSON fragment from the *applied* source
  text), `focused-widget.ts` (shared focus -> plain `{ id, type }`), and `shiki-highlighter.ts` (the
  lazy, self-contained Shiki fine-grained highlighter — see "Loading policy" below for its chunk and
  engine-choice rationale). Each showcase's `sources.ts` (`src/showcases/survey/sources.ts`,
  `src/showcases/crm/sources.ts`, `src/sandbox/sources.ts`) is the actual curated registry, wired into
  `ShowcaseEntry.sources` (`src/showcases/registry.ts`) alongside `presets`. `src/components/panels/
  ImplementationPanel.vue` (registered lazily — see below) and `src/components/implementation/*`
  (`ImplementationFile.vue`, `ImplementationSourceView.vue`) are the Vue layer; `src/composables/
  use-implementation-explorer.ts` is the small, deliberately parallel open/activate bridge to
  `Workbench.vue`'s Dockview instance (see that file's header for why it is not an extension of
  `LabStore.activeTab`).
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
  that wrapper renders as content), `panels/*` (Author/Blueprint/Runtime/Graph tabs, plus the
  lazily-registered `ImplementationPanel.vue` — issue #25 P3; it is the one panel `Workbench.vue`
  registers with no `tabComponent` override, i.e. Dockview's own default (closable) tab, since it is
  deliberately not a sixth canonical non-closable surface), `preview/PreviewPanel.vue`,
  `inspector/*` (presentation-only inspector shell and tree/details split layout shared by Blueprint and
  Runtime; these components own no semantic data, revision labels, or focus state), `blueprint/*` (the Blueprint Inspector's tree + selected-node detail + issue list; the selected-node
  detail also carries a "View implementation" entry point), `runtime/*` (Runtime Inspector's member rows
  + property-issue list), `graph/*` (the Vue Flow canvas + panel-local edge details).
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
main app JS (index-*.js)                ~778 KB raw / ~214 KB gzip  — eager
modern-monaco/core package JS (core-*.js) ~763 KB raw / ~275 KB gzip — loaded when Author JSON mounts
vendored editor-core.mjs                ~7.93 MB raw / ~1.41 MB gzip — loaded when Author JSON mounts
vendored editor-worker(-main).mjs       ~566 KB raw / ~119 KB gzip  — loaded on first Monaco worker use
ELK layout worker (layout.worker-*.js)  ~1.91 MB raw / ~465 KB gzip — loaded on first Graph layout
Implementation panel + Shiki (ImplementationPanel-*.js)
                                         ~373 KB raw / ~74 KB gzip  — loaded on first Implementation open
curated raw-source chunks (per curated file, e.g. TableRenderer-*.js)
                                         ~0.6-14 KB raw / ~0.4-4.3 KB gzip each — loaded on first
                                         selection of that file's tab
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
  **during initial load today**, though: `AuthorJsonView.vue` renders `MonacoJsonEditor` when the JSON view is active,
  Dockview mounts every one of the five canonical panels' Vue components as soon as `Workbench.vue`'s
  `onReady()` calls `addPanel()` for it (`inactive: true` only controls which tab is initially
  *selected*, not whether Dockview mounts the panel's content — verified: dockview-vue keeps every
  panel's rendered content in the DOM, not just the active one), and Author is the panel added first /
  made the active tab. So `MonacoJsonEditor`'s `onMounted` runs immediately on app load regardless of
  which tab a user looks at. This is an accepted, documented trade-off, not an oversight: Author JSON is
  the Lab's default and most-used surface, so paying its cost immediately is preferable to adding a
  mount-gate (`v-if` on tab activity) whose only benefit is deferring, never avoiding, that cost for the
  overwhelmingly common path where a user opens Author JSON anyway. If onboarding/information-architecture
  ever makes Author not the default active panel, revisit gating `MonacoJsonEditor`'s mount on the view
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
- **Implementation panel + Shiki + curated raw-source chunks (issue #25 P3)**: unlike Monaco/ELK above,
  these genuinely stay lazy — `ImplementationPanel.vue` is registered in `Workbench.vue`'s `components`
  map through `defineAsyncComponent(() => import('./panels/ImplementationPanel.vue'))`, and the panel
  itself is only ever added to Dockview (`api.addPanel({ id: 'implementation', ... })`) the first time
  `ImplementationExplorerStore.open()` is called — from Preview's "View implementation" button,
  Blueprint's selected-node detail, or the Survey tour's step 8 link — never at `onReady()` time the way
  the five canonical panels are. Verified by loading the built app fresh and driving each of those three
  entry points: no request for `ImplementationPanel-*.js` (which statically bundles
  `src/implementation/shiki-highlighter.ts` — `@shikijs/core`, `@shikijs/engine-javascript`, and the
  `typescript`/`vue`/`json` `tm-grammars` grammars + `tm-themes`' `one-dark-pro` theme) occurs before the
  first `open()` call, and one occurs immediately after. Within an open panel, each curated file's own
  raw text is a *second*, independent lazy boundary: `showcases/*/sources.ts` / `sandbox/sources.ts`
  only holds `load()` thunks (`() => import('...?raw')`), and `ImplementationFile.vue` only calls a
  file's `load()` once that file's tab is actually selected — so opening the panel never fetches every
  curated file's text up front, only the initially-selected tab's, and switching tabs fetches the next
  one lazily too. `e2e/implementation.spec.ts`'s lazy-boundary test pins both requests are absent before
  first open and present after (page.on('request') across a full page load, matching this section's own
  verification method) — mirroring the network-blocked fixture's own "assert what is/isn't fetched"
  posture (`e2e/fixtures.ts`) rather than adding a second, parallel assertion mechanism.

## Package boundaries

This app is a private downstream consumer and architecture probe. It owns the Lab shell, inspectors,
live source workflow, and the showcases. It must not own, and must not gain:

- any part of `@deviltea/widget-core`'s semantic compiler/runtime, or `@deviltea/widget-vue`'s
  renderer/lifecycle/reactivity adapter surface — both are consumed exclusively through their public
  entry points (`@deviltea/widget-core`, `@deviltea/widget-core/inspection`, `@deviltea/widget-vue`);
  no private/internal import from either package;
- persistence/versioning/migration of any kind — `LabSession`'s `draftSourceText`/`documentState` and
  `preview` snapshots are in-memory only, and Monaco's own workspace/IndexedDB machinery is deliberately not used (see
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
+ the compiler's `transitivelyWrites` fact); there is no invocation affordance. The Runtime Inspector
always consumes `store.preview`'s Blueprint/Runtime and shows its Preview revision; an invalid current
Document may leave an older valid Preview running, so it is not an unavailable Runtime state by itself.
Only a session with no valid Preview has an unavailable Runtime panel. `src/runtime-inspector/viewmodel.ts`
is the passive-projection layer this panel is built on — see its file-level comment and colocated tests
for the exact contract.

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

Graph works for an invalid current Document Blueprint (compile-time facts only, no Runtime dependency) and
its node click sets Document-scoped focus (`nodeId` + member). Blueprint and Graph never consume a
Preview-scoped node id when revisions diverge. Runtime and Preview use a separate Preview-scoped focus;
equal Document/Preview revisions synchronize the two scopes, while diverged revisions never map raw
`InspectionNodeId`s between them. A changed Document resets Document focus; a replaced Preview resets
Preview focus.

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
  the current Document Blueprint and therefore never relayouts.
- `vite.config.ts`'s `worker: { format: 'es' }` keeps this Worker's own `elkjs` import going through
  normal Vite ESM bundling.

## Apply lifecycle

Editing the Author JSON view only ever mutates `LabSession.draftSourceText`; it never recompiles. Apply
parses the captured draft and submits one root `SourcePatch` replacement to core's authoritative
`WidgetDocument`. A structural `changed:false` accepts the Lab-local text representation without a
Document revision, Blueprint compile, Preview detach, or Runtime replacement. A `changed:true` commit
compiles/increments the Document revision first. If that committed Blueprint is invalid, authored state
advances but the Lab Runtime Host retains the exact last-valid Preview Runtime and its older revision;
there is no detach/dispose/mount. If the committed Blueprint is valid, the host then detaches/disposes
the previous Preview Runtime, creates a fresh Runtime for the new revision, and mounts it. Runtime state
is never migrated across valid revisions. `LabSession.documentState` and `LabSession.preview` are the
explicit two snapshots; the deprecated `active` compatibility shape must not be used to infer that its
current Document Blueprint and retained Runtime share a revision. See `src/lab/session.ts` and its tests
for parse-failure isolation, concurrent-Apply guard, no-op semantics, revision behavior, and ordering.

Do not add a second Lab path that calls `system.createBlueprint()` for authored-state mutation: manual
Apply and presets must go through the Document/SourcePatch boundary. Format/Revert remain draft-only.
`switchShowcase()` is intentionally different: it replaces the whole System/Document context and mounts
the target session's already-authoritative revision-0 Runtime directly; re-applying identical default
source merely to trigger mounting is forbidden because Core correctly treats it as `changed:false`. All
lifecycle-mutating operations remain serialized by the Lab store's transaction boundary.

## Author workspace (Phase 3)

The canonical authored surface is the outer `Author` panel with three Lab-owned views: `Catalog`,
`Structure`, and `JSON`. `AuthorJsonView.vue` contains the existing Monaco draft workflow; header
`Apply`/`Format`/`Revert` controls continue to operate on that same draft. `Catalog` reads the immutable
public `session.system.catalog` and public `WidgetPlugin.capabilities`; it never reads or derives from the
curated `ShowcaseEntry.sources` Implementation Explorer registry. Core currently publishes config/slot
descriptions and capability-presence facts, so the view does not invent state/property/method schemas or
member definitions that Core does not publish through the catalog contracts.

`Structure` renders the current committed Document Blueprint inspection and uses Document-scoped focus.
Its deliberately narrow operation is replacing an existing scalar config value on the selected inspection
node. `ReplaceConfigScalarCommand` carries both the current Document `InspectionNodeId` and Document
revision; `src/lab/author.ts` resolves that exact snapshot node and lowers the command to an array-form
`SourcePatch`. The component never constructs a patch and never targets a widget by id, which keeps
duplicate authored ids and cross-revision focus safe. Unsupported/non-scalar fields and mechanical patch
failures are explicit outcomes.

Successful Structure commands and JSON Apply share `LabSession`'s Document commit and Runtime promotion
boundary. A successful Structure commit rewrites both applied source text and the JSON draft to deterministic
pretty JSON only when the draft still equals the command's captured clean text; a concurrent Monaco edit is
preserved as dirty. Invalid Document commits advance the authored revision while retaining the prior valid
Preview revision. No persistence, history, undo/redo, collaboration, drag/drop, or Runtime-state migration
belongs to this Phase 3 workspace.

### Author recovery and diagnostics (Phase 4)

AuthorStatusSurface.vue is a Lab-owned status projection for the current Document. It reads the
draft's Lab-only SourceParseError, Core's committed blueprint.sourceJsonCompatible and blueprint.status,
Core's aggregate blueprint.diagnostics.length, Core inspection recovery counts, and the existing
Document/Preview revision link status. It does not parse JSON outside Apply, perform a compatibility
check, classify diagnostic codes, or turn a diagnostic message into a second protocol. JSON syntax errors
therefore remain distinct from Core source-compatibility and Blueprint semantic status.

BlueprintTree continues to traverse BlueprintInspection.nodes and sourceSlots, so unresolved nodes and
raw-slot placements remain visible and selectable. DiagnosticList displays Core's location/path fields
and uses src/lab/diagnostics.ts only to resolve a node location through the current Document inspection.
Source-level locations intentionally return no inspection node and remain non-navigable. Node-level
diagnostic navigation writes Document-scoped shared focus; it never consumes Preview-scoped IDs or maps
across diverged revisions. Structure and Blueprint read that same Document focus, while Runtime and
Preview retain their Preview-revision scope.

Phase 4 adds no persistence/history/undo/redo/editor framework, second validator, compatibility
implementation, or alternative authored source authority.

### Separate inspector panels with shared presentation primitives (Phase 5)

Blueprint and Runtime remain separate outer, canonical Dockview panels. `BlueprintPanel.vue` is the
current Document inspection surface for semantic status, diagnostics, recovery nodes, and Document
focus; `RuntimePanel.vue` is the Preview-revision surface for passive Runtime state/property/method
inspection and Preview focus. They must not gain a shared Blueprint/Runtime mode, shared revision state,
or cross-revision `InspectionNodeId` mapping. Preview Inspect continues to select Blueprint when
Document/Preview revisions are linked and Runtime when they diverge; Graph and Implementation retain
their existing Document-scoped entry points.

`src/components/inspector/InspectorPanelShell.vue` and `InspectorSplitLayout.vue` are intentionally
small, props/slot-only presentation primitives. The shell owns only the repeated description-bar and
column-container chrome; the split layout owns only the tree/divider/details columns. Blueprint and
Runtime continue to provide their own data, status lines, diagnostics, recovery behavior, selection
handlers, and details components. Do not use these primitives as a semantic or focus abstraction, and
do not merge the two outer panels merely to remove presentation duplication.

### Document Tools developer panel (Phase 6)

`DocumentToolsPanel.vue` is a lazy-added, closable developer surface in the left Dockview group, not a
canonical panel and not an Author subview. Its header entry point and `use-document-tools.ts` request
store parallel the Implementation explorer's lifecycle; `Workbench.vue` owns the actual Dockview
`addPanel`/activation operation and does not increase the canonical non-closable panel count.

The panel observes the latest successfully accepted SourcePatch from `LabSession` as transient
Lab-observed telemetry and offers copy-only display. JSON Apply and Structure commands remain the only
authoring paths. The optimistic-concurrency fixture calls the same public
`WidgetDocument.applyPatch(patch, { expectedRevision })` contract with a stale revision and displays
Core's returned result; it has no Lab-owned conflict model and must leave both Document and Preview
revisions unchanged.

The separated-source section uses Core's public `separateWidgetSource()` only when the current Blueprint
is valid. It is a read-only projection of the current Document source, never an alternate source
authority or validator; invalid/recovery Documents show that the Core precondition is unavailable.

The Document trace is a finite, session-only ring of Lab-observed parse/commit/patch/conflict metadata.
It is explicitly telemetry: no persistence, replay, restore, undo/redo, collaboration, or authoritative
history semantics may be added. Runtime/Preview behavior, revision-scoped focus, Author recovery,
Blueprint/Runtime separation, Graph, and Implementation entry points remain unchanged.

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
core): `src/lab/`, `src/graph/`, `src/runtime-inspector/`, `src/implementation/`, `src/sandbox/`,
`src/composables/`, and `src/showcases/**` (plugin semantics, preset validity, and selected renderer contracts via
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
