# AGENTS.md — widget-lab

Current-state operating guide for this app. Issue numbers in this file (`#10`, `#13`, `#25`–`#30`, `#54`,
`#60`) are historical `DevilTea/deviltea-labs` numbers (`DevilTea/widget#5` and `DevilTea/widget#8` below are current issues) (see `docs/migration/source-history.md`); current
authority is `DevilTea/widget` Discussion #12 and current `DevilTea/widget` Issues/Discussions.
`DevilTea/deviltea-labs#13` is the historical Widget Lab decision
log; `DevilTea/deviltea-labs#60` tracked the post-`WidgetDocument` Lab redesign and accepted migration decisions;
`DevilTea/deviltea-labs#10` (with its detailed source/document design in `DevilTea/deviltea-labs#54`) was the semantic authority for
`@deviltea/widget-core` that this app never reinterprets. This file describes what is
true in the repository right now so a fresh agent can work without replaying the issue timeline —
when it conflicts with repo reality, fix this file; current accepted decisions in Discussion #12 win over
stale prose here or historical `DevilTea/deviltea-labs#13` checkpoints that `DevilTea/deviltea-labs#60` explicitly supersedes.

## Scope and layout

Private, never-published workspace application with two roles:

1. **Lab shell** — the two-column workbench's `Author` workspace (Catalog/Structure/JSON), Preview, the
   `Selected widget` pane, and readonly Blueprint/Runtime/Dependencies inspectors over `@deviltea/widget-core` /
   `@deviltea/widget-vue`.
2. **Showcases** — served by the same shell and Document-backed authoring model, as registered in
   `src/showcases/registry.ts`: `Interactive Survey` (`survey`) is the default and the only showcase
   listed in the header's Examples menu; `Sandbox` (`sandbox`, minimal fixtures) is a hidden,
   test-only fixture (see "Showcase selection" below). The former `Product Prototype` (`crm`) and
   `Vuetify Task Workspace` (`vuetify-tasks`) showcases, and the CRM tour, were removed (tracking issue
   `DevilTea/widget#230`); new showcases are added after the Lab redesign.

### Showcase selection (`?showcase=<id>`)

`src/showcases/registry.ts` registers every showcase; an entry with `hidden: true` is registered but not
listed. `listedShowcases` (what the header's Examples menu and `LabStore.showcases` expose) and the default
(`defaultShowcase`, the first listed entry: `survey`) exclude hidden entries. `resolveInitialShowcase()`
reads the `?showcase=<id>` URL parameter once at startup (`App.vue` -> `createLabStore(initialShowcase)`),
accepting any registered id, listed or hidden; a missing, empty or unknown id falls back to the default.
`App.vue` then keeps the parameter in step with the active showcase: it watches `LabStore.showcaseId` and
rewrites it with `history.replaceState` (`urlWithShowcase()`; no history entry, other parameters, the path and
the hash untouched, the id written even for the default showcase), so a reload restores the showcase;
`?lang=` switching keeps `?showcase=` like any other unrelated parameter. When a hidden fixture is open, the
Examples menu lists it as an extra item so what is open is always named. This is how e2e opens the Sandbox (`?showcase=sandbox`, combinable with `?lab-test`); do not add a
user-facing affordance for hidden showcases.

The app deploys to GitHub Pages together with `docs/site` (see "Deployment" below).

- `src/lab/` — framework-agnostic, unit-tested authoring/runtime-host lifecycle logic: `LabSession`
  (JSON draft + authoritative `WidgetDocument` mutation + Runtime promotion, `types.ts`), `author.ts`
  (high-level Structure commands lowered to `SourcePatch`), the shared
  cross-inspector focus store (`focus.ts`), and the header/feedback logic of issue #230 PR 3a:
  `json-locate.ts` (maps a source path onto offsets of the JSON text, and a `JSON.parse` failure onto an offset),
  `problems.ts` (the Problems model, see "Problems list and editor squiggles" below), `status.ts` (the two
  plain-language header chips), `example.ts` (what the Examples menu says is open) and `draft-guard.ts` (the
  unapplied-draft confirmation state machine) and, from PR 3b, `layout-storage.ts` (the saved Dockview layout format). No Vue
  import here on purpose — this is the regression-worthy core, independently testable.
- `src/composables/use-lab-store.ts` — the one place that bridges `LabSession`/focus store into Vue
  `computed()` refs and supplies the `LabSessionHooks` seam (`detachPreview`/`mountPreview`) that
  guarantees unmount-before-dispose ordering via `nextTick()`. Owns `switchShowcase()` — the
  application-level whole-context replacement operation (teardown old Runtime → create target
  revision-0 Document/Runtime → mount it), serialized with Apply/preset/revert through one
  `enqueue()` promise chain (`undoLastApply()` joins it too). It also exposes the derived header state
  (`canApply`, `canUndo`, `status`, `problems`, `example`/`loadedPresetId`) and `authorView`/`showProblems()`.
  Also owns `graphShowAbsent`/`graphShowIsolatedMembers` — Dependencies/Graph
  presentation preferences that deliberately live as plain refs on the `LabStore` object
  itself (not derived from `session`) so they survive Apply.
- `src/composables/use-monaco-editor.ts` + `src/components/editor/MonacoJsonEditor.vue` — the entire
  `modern-monaco` integration surface. Nothing else in this app imports `modern-monaco`. Besides the text model it
  owns the editor's Cmd/Ctrl+Enter command (Apply, registered as an action named in the Lab language and re-registered on a language switch), error squiggles over caller-supplied offset ranges and
  `revealRange()` (select + scroll + focus; a request made before Monaco has loaded is replayed once it is up).
- `src/composables/use-draft-guard.ts` + `src/components/DraftGuardDialog.vue` — Vue bridge and native-dialog
  confirmation for the unapplied-draft guard (see "Header, status chips and draft protection" below).
- `src/composables/use-inspect-anchor.ts` — the Lab's one-line-per-renderer projection of `useWidget()` identity onto a
  renderer's root element. It only wraps `inspectAnchorAttributes` from `@deviltea/widget-inspector/anchor`, which owns
  the attribute contract (names, identity-only shape, nesting/multi-fragment semantics); `@deviltea/widget-vue` itself
  still stamps no DOM attributes. Browser coverage lives in `e2e/inspect-anchors.spec.ts` (real `widget-vue` renderers).
- `src/composables/use-remote-runtime-member.ts` — Vue bridge for one remote Runtime Inspector member
  (State or Property row): it observes the member through the `@deviltea/widget-inspector` client's
  `runtime.memberChanged` events, and unsubscribes the previous remote subscription whenever the
  connection, selected widget, or member changes (for example a Preview Runtime replaced by Apply) or the
  component unmounts.
- `src/composables/use-dependency-graph.ts` — Vue bridge for the Dependencies panel's Graph view: projects the
  current Document Blueprint through `projectSemanticGraph()` and drives a `LayoutSession`
  (`src/graph/layout-session.ts`) that only requests a fresh ELK layout when the projected graph itself
  changes (new Blueprint snapshot or a graph filter toggle) — never on Runtime activity.
- `src/composables/use-document-tools.ts` — request-only bridge for the lazy, closable Phase 6 Document
  Tools developer panel; it owns no Document state and only asks `Workbench.vue` to add or activate the
  panel, paralleling the Implementation explorer lifecycle.
- `src/composables/use-graph-edge-selection.ts` — panel-local Graph edge-selection state (edge
  selection never expands into the shared cross-inspector focus).
- `src/runtime-inspector/` — small framework-agnostic helpers for the Runtime Inspector: `source.ts`
  (Document-vs-Preview revision metadata: stale/diverged) and `format-value.ts` (display formatting of
  Inspector value DTOs). The member data itself comes from the remote Preview connection, never from a
  local Runtime (see "Runtime Inspector is strictly passive").
- `src/graph/` — pure dependency projections plus the Graph layout pipeline; see "Dependencies inspector" below.
- `src/implementation/` — the curated Implementation source explorer's framework-agnostic core (issue
  `DevilTea/deviltea-labs#25` P3): `types.ts` (`SourcesRegistry`/`CuratedSourceFile` — metadata only, `load()` thunks are the
  lazy boundary), `registry-coverage.ts` (dangling/uncurated-type sanity used by unit tests),
  `applied-instance.ts` (pure extraction of the focused widget's own authored JSON fragment from the
  *applied* Document Blueprint, through Core's inspection node — never by searching the source text or by
  widget id), `focused-widget.ts` (shared focus -> plain `{ id, type }`), and `shiki-highlighter.ts` (the
  lazy, self-contained Shiki fine-grained highlighter — see "Loading policy" below for its chunk and
  engine-choice rationale). Each showcase's `sources.ts` (`src/showcases/survey/sources.ts`,
  `src/sandbox/sources.ts`) is the actual curated registry, wired into
  `ShowcaseEntry.sources` (`src/showcases/registry.ts`) alongside `presets`. `src/components/panels/
  ImplementationPanel.vue` (registered lazily — see below) and `src/components/implementation/*`
  (`ImplementationFile.vue`, `ImplementationSourceView.vue`) are the Vue layer; `src/composables/
  use-implementation-explorer.ts` is the small, deliberately parallel open/activate bridge to
  `Workbench.vue`'s Dockview instance (see that file's header for why it is not an extension of
  `LabStore.activeTab`).
- `src/lib/diagnostic-format.ts` — shared structured-diagnostic formatting helpers (`formatDiagnosticPath`,
  `formatDependencyReference`, `formatSeparatedSourceLocation`, ...) reused by `blueprint/DiagnosticList.vue`,
  `runtime/RuntimePropertyDiagnosticList.vue`, the Dependencies/Graph detail views, and the Document Tools
  panel. `message` is never parsed for structure; every field beyond it comes from the diagnostic's own
  structured fields (`code`, `location`, `path`, `reason`, ...). The Lab does not enumerate or label
  diagnostic/failure codes: a code is shown verbatim, so a new Core code needs no Lab change.
- `src/components/` — the app shell: `LabHeader.vue` (the grouped header, see "Header, status chips and draft
  protection" below), `Workbench.vue` (`dockview-vue` two-column layout, about half the width for the tool group by default, saved and restored, see "Workbench layout and the Selected widget pane" below), `NonClosableTab.vue`
  (a custom Dockview `tabComponent` — `DevilTea/deviltea-labs#27` Finding 2: registered as `tabComponents.nonClosable` and
  selected via `AddPanelOptions.tabComponent` on each of the six canonical panels' `addPanel()` calls, it
  renders only a title (kept in step with `onDidTitleChange`, so a language switch retitles it), no close control, so those panels can never be closed; Dockview's own `Tab`
  wrapper — drag/reorder/dock/resize/activate — is untouched, since a `tabComponent` only replaces what
  that wrapper renders as content), `panels/*` (Author/Selected widget/Blueprint/Runtime/Dependencies tabs, plus the
  lazily-registered `ImplementationPanel.vue` — `DevilTea/deviltea-labs#25` P3; it is the one panel `Workbench.vue`
  registers with no `tabComponent` override, i.e. Dockview's own default (closable) tab, since it is
  deliberately not a sixth canonical non-closable surface), `preview/PreviewPanel.vue`,
  which consumes the published `@deviltea/widget-inspector` client/agent boundary for Inspect mode through its public subpaths only (never a root entry or an internal module). The Preview Runtime, Vue
  renderer tree and `InspectorAgent` live in an isolated iframe realm (`preview-frame.html` ->
  `src/preview-frame-main.ts`); the parent owns only the iframe element, the remote `InspectorClient`, and
  the `src/preview-host/` machinery (`coordinator.ts` serializes Preview promotions, `frame-driver.ts`
  boots a frame and connects over a transferred `MessagePort`, `client.ts`/`protocol.ts` are the
  host-command protocol, `lifecycle.ts` is the generation-aware `booting`/`ready`/`replacing`/
  `disconnected`/`error` state machine). The parent never holds a Core Runtime or frame DOM. The Agent
  owns bounded Preview DOM hit-testing, pointer suppression, an Agent-owned ShadowRoot overlay for
  highlight/badge chrome (renderer elements are never mutated; the Lab only themes it through `--widget-inspector-*` custom properties in `global.css`), and Escape cleanup, while the panel only translates scoped `WidgetRef`
  selection events into the existing Preview focus/navigation rules. `DevilTea/widget#8` tracked the Phase B
  implementation and `DevilTea/widget#5` remains the iframe/extension umbrella,
  `inspector/*` (presentation-only inspector shell and tree/details split layout shared by Blueprint and
  Runtime; these components own no semantic data, revision labels, or focus state), `blueprint/*` (the Blueprint Inspector's tree + selected-node detail + issue list; the selected-node
  detail also carries a "View implementation" entry point), `runtime/*` (Runtime Inspector's member rows
  + property-issue list), `dependencies/*` (the Dependencies view switcher + Relations UI), `graph/*` (the Vue Flow canvas + panel-local edge details).
- `src/App.vue` also renders a narrow-viewport gate (`DevilTea/deviltea-labs#27` Finding 3): a pure CSS
  `@media (max-width: 899px)` rule (no JS resize listener/state) shows a `position: fixed` explanatory
  overlay ("Widget Lab is designed for a desktop-sized viewport. Widen the window to continue.") covering
  the whole viewport below 900px width, and hides it again above that width; `Workbench`/Dockview stay
  mounted underneath rather than being torn down.
- `src/sandbox/` — the hidden `Sandbox` test fixtures: small, Lab-private fixtures (plugins, a
  `WidgetSystem`, a `createWidgetVueRenderer` registry, preset source texts including the invalid and
  raw-slot recovery presets) whose only job is to exercise the shell with minimal semantic surface. Unit
  tests import them directly and e2e opens them with `?showcase=sandbox`. Product-shaped showcases live
  in `src/showcases/`, never here; sandbox fixtures must stay small.
- `src/showcases/` — the showcases and their registry:
  - `registry.ts` — the deliberately minimal `{ id, label, hidden?, system, renderer, presets }` lookup
    table (no routing, no persistence) consumed by `use-lab-store.ts`'s `switchShowcase`. Plugin-tuple
    types are erased to `WidgetSystem<AnyWidgetPluginTuple>` on purpose — consumers only need object
    identity.
  - `survey/` — Interactive Survey (the default showcase), the Maker Space open-day sign-up form (a survey rendered
    from one JSON definition; five plugin types `Survey`, `SingleChoice`, `MultipleChoice`, `Numeric`,
    `ShortAnswer`; root widget `open-day`; languages `en` and `zh-TW`). `domain.ts` (pure types,
    condition evaluation, built-in messages), `config.ts` (config checkers reporting located diagnostics),
    `schemas.ts` (Draft 2020-12 config schemas the Author Catalog shows and copies), `plugins/` (semantic
    plugins, unit-tested; a condition in the JSON becomes a declared dependency, so Core reports an
    evaluation cycle instead of the plugin guessing), `presets.ts` (`survey-default`, `survey-ai-draft`
    with one located diagnostic per widget, `survey-cycle`), `evaluate.ts` (the JSON-in/JSON-out
    function a backend runs), `cycle-safe-targets.ts` (test-only classification of which condition targets
    would create a cycle; the Lab has no editor operations), `renderers/` (Vue renderer components),
    `sources.ts`, `system.ts`, `test-support.ts`. The Survey tour (`tutorial/survey-script.ts`) is
    authored against `survey-default`; its `data-tutorial-target` lookup is keyed by widget id
    (`tutorial/survey-target-map.ts`).
  - Business/semantic rules (scoring, staging, validation, derived read models) belong in each
    showcase's `plugins/`/`domain.ts`, never in renderer glue — renderers present semantics, they do
    not compute them.
  - Historical note: several showcase plugins project their resolved `config` into Properties purely so
    renderers can display it, because the Vue adapter did not expose `config` to renderers. That projection
    is for rendering only and is not a semantic requirement; once `@deviltea/widget-vue` exposes `config`
    to renderers, those renderers may read it directly (do not change the showcases for this alone).
  - Authored sources the Lab ships (presets, tutorial, e2e fixtures) must use only Core's recognized widget
    keys (`id`, `type`, `config`, `slots`, and the reserved `meta` extension key); any other own key makes
    the Blueprint invalid (`unexpected-widget-field`). `src/showcases/registry.unit.test.ts` pins this.
- `pika.config.ts` — the Lab's small PikaCSS token set (`variables.definitions`, safe-listed so the
  hand-authored `src/styles/dockview-theme.css` can reference them via plain `var()`). The success/OK colour
  is the single token `--lab-color-ok` in both themes (dark here, light in `global.css`); do not add a second
  name for it (audit U17: `--lab-color-success` existed only in dark, `--lab-color-ok` only in light).
- `nuxt-ui.ts`, `src/styles/lab-ui.css`, `src/composables/use-nuxt-ui-theme-bridge.ts`, `src/ui/offline-icons.ts`,
  `src/test-support-ui.ts`, `src/test-setup.ts`, `scripts/nuxt-ui-codegen.mjs` — the Nuxt UI + Tailwind v4 foundation, see "Nuxt UI
  and Tailwind" below. The Lab shell (`index.html` -> `main.ts`) uses it; the Preview frame never does.
- `src/styles/preview-frame.css` — base rules for the Preview frame only (imported by
  `preview-frame-main.ts`, never by the shell): line-height 1.5, controls inheriting the surrounding font,
  square text inputs and pointer cursors, i.e. the subset of the removed Vuetify reset the survey renderers
  were styled against. It sits in a layer declared after PikaCSS's `utilities`, so it wins over PikaCSS
  utilities on those properties (see `showcases/survey/renderers/control-style.ts`). Do not move these rules
  into `global.css`: the Lab chrome keeps the UA defaults.
- `src/**/*.unit.test.ts` — colocated Vitest unit tests for `src/lab/`, `src/graph/`,
  `src/runtime-inspector/`, `src/sandbox/`, `src/composables/` and `src/showcases/**` (plugins,
  presets, and selected renderer contracts via `@vue/test-utils` + `happy-dom`), run by both this
  app's own `vitest.config.ts` and the root config.

## Commands

```bash
pnpm dev         # vite dev server
pnpm build       # vite build
pnpm typecheck   # generates pika.gen.ts and the Nuxt UI theme templates, then vue-tsc over app, unit tests, and browser/Page specs
pnpm test        # vitest run for this app's colocated *.unit.test.ts
```

`vite.config.ts`/`vitest.config.ts`/`pika.config.ts`/`nuxt-ui.ts` and Playwright config files themselves are not
part of `pnpm typecheck`'s program, matching every other package in this repo (none type-check their
own bundler config files). Browser/Page specs under `e2e/` and `e2e-pages/` are typechecked through
`tsconfig.browser-tests.json`, including the preset fixtures they import (`src/sandbox/presets.ts` and
`src/showcases/survey/presets.ts`), while the two
Playwright suites remain separate runtime jobs.
`pnpm typecheck` first runs `pika:codegen` (`scripts/pika-codegen.mjs`), which generates
`src/pika.gen.ts` directly through `@pikacss/integration` — the same file `@pikacss/unplugin-pikacss`'s
Vite plugin would otherwise only produce as a side effect of an actual `pnpm dev`/`pnpm build` pass, and
which augments Vue's `ComponentCustomProperties` so `pika()` type-checks inside `<template>`. This keeps
`pnpm typecheck` correct on a clean checkout without requiring a prior dev/build run.
It then runs `nuxt-ui:codegen` (`scripts/nuxt-ui-codegen.mjs`) for the same reason, see "Nuxt UI and Tailwind".

## Deployment (GitHub Pages)

The Lab deploys as part of the docs Pages artifact: `.github/workflows/docs.yml` runs after the
`Pages integration` workflow succeeds on a `main` push (or via manual `workflow_dispatch` of `main`).
Its `gate` job always deploys the **current tip of `main`**: it requires the `CI` run (and the
`Pages integration` run, when one exists) for that commit to have succeeded, so a stale re-run never
rolls the site back and a docs commit whose CI was cancelled by a newer non-docs commit still ships
through that newer tip. If the tip has its own `Pages integration` run, that run's trigger deploys it
instead. `deploy-pages` cannot take a commit, so the GitHub deployment record shows the workflow's
`GITHUB_SHA` (the `main` tip when the run started); the gate's job summary records the deployed sha. The
Pages `push` path filter in `pages-integration.yml` must keep covering every path that affects the Pages
artifact, because it also decides when a deploy is triggered. The build runs
`pnpm docs:build:pages` (`scripts/build-pages.ts`), which builds `widget-lab` **and its workspace
dependencies** in topological order with `WIDGET_LAB_BASE=/widget/lab/` (consumed by
`vite.config.ts`'s `base`), builds `docs/site`, then copies the Lab build under the docs dist's
`lab/` subdirectory. `docs/site` and `apps/lab` remain separate source/application
boundaries — only build output is combined. If you touch the Lab's asset/worker URL behavior, verify
it still resolves under that subpath, not just under `/`.

`modern-monaco`'s editor engine is self-hosted rather than loaded from its default esm.sh CDN — see
`DevilTea/deviltea-labs#30` Scope A. `vite-plugin-vendor-modern-monaco-editor-core.ts` (project root, alongside
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

Intentional, not incidental (`DevilTea/deviltea-labs#30` Scope B) — the production artifact's chunk shape, verified by
building this app in isolation:

```text
main app JS (lab-*.js + shared global-*.js) ~847 KB + ~288 KB raw / ~230 KB + ~94 KB gzip — eager
                                         (was ~678 KB + ~287 KB / ~177 KB + ~93 KB before Nuxt UI)
Nuxt UI Toast (Toast-*.js)               ~30 KB raw / ~9 KB gzip   — loaded on first toast (none is shown yet)
modern-monaco/core package JS (core-*.js) ~763 KB raw / ~275 KB gzip — loaded when Author JSON mounts
vendored editor-core.mjs                ~7.93 MB raw / ~1.41 MB gzip — loaded when Author JSON mounts
vendored editor-worker(-main).mjs       ~566 KB raw / ~119 KB gzip  — loaded on first Monaco worker use
ELK layout worker (layout.worker-*.js)  ~1.91 MB raw / ~465 KB gzip — loaded on first Graph layout
Implementation panel + Shiki (ImplementationPanel-*.js)
                                         ~375 KB raw / ~75 KB gzip  — loaded on first Implementation open
curated raw-source chunks (per curated file, e.g. ShortAnswerRenderer-*.js)
                                         ~2-21 KB raw / ~1-6.2 KB gzip each — loaded on first
                                         selection of that file's tab
CSS (lab-*.css + global-*.css)            ~325 KB + ~9 KB raw / ~37 KB + ~3 KB gzip — eager
                                         (was ~128 KB + ~9 KB / ~12 KB + ~3 KB; the Lab shell only: Tailwind utilities
                                         plus the theme of every Nuxt UI component, see "Nuxt UI and Tailwind")
```

- **Eager**: the main app chunk and its CSS — `App.vue`, `Workbench.vue`, `LabStore`/`LabSession`,
  every panel *shell* (not necessarily every panel's heavy dependency, see below), the Survey showcase and the hidden Sandbox fixture,
  `dockview-vue`. This is unavoidable critical-path weight for a workbench app whose
  shell has to exist before any panel can render.
- **`modern-monaco/core` (package JS + vendored `editor-core.mjs`)**: not in the eager chunk —
  `import('modern-monaco/core')` in `use-monaco-editor.ts`'s `ensureMonaco()` is Vite's own code-split
  boundary for the package JS (the LSP-free submodule — the side-effectful main entry that
  force-enabled `useBuiltinLSP` and carried ~740 KB of unused LSP/grammar code is deliberately not
  imported anywhere), and
  `editor-core.mjs` is never in Vite's module graph at all (loaded by `modern-monaco` itself via the
  importmap-resolved dynamic `import()` described in "Deployment" above). Both are still fetched
  **during initial load today**, though: `AuthorJsonView.vue` renders `MonacoJsonEditor` when the JSON view is active,
  Dockview mounts every one of the six canonical panels' Vue components as soon as `Workbench.vue`'s
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
  initial mount today because `DependenciesPanel.vue` (like Blueprint/Runtime) is mounted immediately by
  Dockview per the same paragraph above, and its `useDependencyGraph()` composable's
  `watch(semanticGraph, ...)` fires as soon as the app's initial default-preset Apply produces the
  first real Blueprint — before any user ever opens the Graph tab. Runtime state/property/method
  activity still never re-triggers a relayout (that guarantee is unaffected and unrelated to this
  paragraph); what does not currently hold is "ELK stays uninitialized until a user opens Graph." Fixing
  that would mean gating panel *mount* (not just tab selection) on Dockview activity for Blueprint/
  Runtime/Graph, which is a Workbench/Dockview panel-lifecycle change out of scope for `DevilTea/deviltea-labs#30` — noted
  here as known, current-state behavior rather than silently left undocumented.
- Neither of the two heavy, on-load fetches above is a *regression*: this document only makes explicit
  what was already true before this issue's change (Monaco and ELK both already loaded on initial mount
  before self-hosting), and self-hosting Monaco's engine does not move it into, or out of, that eager
  path — it only removes the esm.sh dependency for the fetch that already happened at that same moment.
- **Implementation panel + Shiki + curated raw-source chunks (`DevilTea/deviltea-labs#25` P3)**: unlike Monaco/ELK above,
  these genuinely stay lazy — `ImplementationPanel.vue` is registered in `Workbench.vue`'s `components`
  map through `defineAsyncComponent(() => import('./panels/ImplementationPanel.vue'))`, and the panel
  itself is only ever added to Dockview (`api.addPanel({ id: 'implementation', ... })`) the first time
  `ImplementationExplorerStore.open()` is called — from Preview's "View implementation" button,
  Blueprint's selected-node detail, or the Survey tour's step 8 link — never at `onReady()` time the way
  the six canonical panels are. Verified by loading the built app fresh and driving each of those three
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

## Nuxt UI and Tailwind

Issue `DevilTea/widget#230` (Lab redesign) adopts Nuxt UI 4 (Tailwind v4) for the Lab chrome through its **Vite
plugin**, not Nuxt. This is the foundation: it changes no Lab behaviour or appearance except the migrated
surfaces below. PikaCSS stays for everything not yet migrated and is removed in a later PR.

- **Tooltips have no exit animation** (`nuxt-ui.ts`, `ui.tooltip.slots.content`). Reka keeps a closed tooltip's content mounted until its
  exit animation ends, and every mounted content listens for the "a tooltip opened" event and closes its own root, including the root of the
  tooltip that was just opened again. A late animation end (busy or throttled page) therefore sometimes killed the tooltip of a header
  button a keyboard user had just tabbed onto, and disabled buttons explain themselves only in the tooltip. Without the animation a closed
  tooltip unmounts at once. `e2e/tooltips.spec.ts` pins real Tab/Shift+Tab navigation, once with every tooltip animation stretched to ten
  minutes (deterministic) and once plainly over many rounds. Do not re-add a `data-[state=closed]:animate-*` class to tooltips.
- **Scope: Lab shell only.** `main.ts` imports `src/styles/lab-ui.css` (Tailwind theme + utilities, Nuxt UI),
  installs Nuxt UI's Vue plugin and wraps `App` in `UApp` (`toaster: null` until a surface needs toasts;
  `UApp` renders no element). `preview-frame-main.ts` / `preview-frame.html` never import any of it, so the showcase
  renderers are untouched; `e2e/nuxt-ui.spec.ts` pins, on the same-origin build, that the frame document has no
  Tailwind/Nuxt UI CSS, no `.dark` class and no `--ui-*` tokens. The frame's CSS does not depend on its origin
  (the entry never imports it), but `playwright.preview-origin.config.ts` only runs `preview-origin.spec.ts`
  (the frame boots and connects cross-origin); it does not repeat these assertions.
- **Plugin set-up** (`nuxt-ui.ts`, shared by `vite.config.ts`, `vitest.config.ts` and the repository root
  `vitest.config.ts`). `@nuxt/ui/vite` works with `unplugin-vue/vite` as is (the Lab does not use
  `@vitejs/plugin-vue`): it adds its own plugins (templates, icons, Tailwind) around whichever Vue plugin is
  present, and `vite build`, the dev server and Vitest all run with it. `@nuxt/ui` is excluded from dep
  pre-bundling by the plugin itself. Versions come from the pnpm catalog (`@nuxt/ui`, `tailwindcss`,
  `@iconify-json/lucide`, `@iconify/vue`); the repo's `minimumReleaseAge` applies, so a brand-new release
  (`@nuxt/ui@4.12.1+` at the time of writing) is not installable until it is three days old.
- **Explicit imports, no generated declarations.** `autoImport`, `components` and `dts` are off: import
  `UButton from '@nuxt/ui/components/Button.vue'` and composables from `@nuxt/ui/composables`. Nothing like
  `auto-imports.d.ts` / `components.d.ts` is generated, so there is nothing to commit, ignore or hand-edit, and
  `pnpm typecheck` cannot depend on a prior build. The only generated input is Nuxt UI's theme types
  (`node_modules/.nuxt-ui/ui/*`, mapped by `#build/ui` paths in `tsconfig.app.json`), which the plugin writes from
  its `config` hook; `pnpm typecheck` writes them first through `nuxt-ui:codegen`
  (`scripts/nuxt-ui-codegen.mjs`, which resolves `vite.config.ts` and does nothing else), the same pattern as
  `pika:codegen`. Do not enable auto-import to save an import line.
- **Cascade layers.** Order, lowest to highest: `properties` (Tailwind's `@property` fallback, which must rank
  below everything that sets a `--tw-*` variable), `theme`, `base`, `preflights` (PikaCSS tokens), `components`,
  `utilities` (Tailwind utilities, Nuxt UI component classes, and PikaCSS's `utilities`, whose layer name is
  fixed by its generated CSS, so the two share it; their classes never meet on one element). The statement lives
  inline in `index.html` because the first `@layer` statement the browser sees fixes the order and Vite emits the
  shared PikaCSS stylesheet link before the Tailwind one; `lab-ui.css` repeats it. Unlayered CSS (`global.css`,
  `dockview-theme.css`, scoped SFC styles) beats every layer, so Dockview, Vue Flow, Monaco and Shiki styling is
  untouched. `e2e/nuxt-ui.spec.ts` probes the resolved order in a real browser.
- **No global Tailwind preflight (yet); a `[data-slot]`-scoped preflight instead.** `lab-ui.css` imports
  `tailwindcss/theme.css` and `tailwindcss/utilities.css` only. The full preflight would change the existing
  chrome (measured on the survey Lab at 1440x900: header 77px -> 83px, every button/select 27px -> 30px,
  `border-*-style` none -> solid on ~120 elements, line-height, tab-size). Nuxt UI/Reka elements all carry
  `data-slot`, so the `base` layer restates the preflight rules Nuxt UI needs for exactly those elements (and
  stays below Nuxt UI's own utilities): zero margin/padding, `border: 0 solid` and `border-box` on every
  `[data-slot]` element and its pseudo-elements; headings inherit size and weight; links inherit colour and
  decoration; `b`/`strong`, `code`/`kbd`/`samp`/`pre`, `hr`, `table`, `summary`, `progress`; lists without
  markers; media elements block and middle-aligned (`img`/`video` fit the width); form controls with inherited
  font, colour and letter-spacing, no radius, transparent background, opacity 1, `appearance: button` on buttons;
  placeholder opacity and colour; vertical-only `textarea` resize; the `hidden` attribute.
  **Not covered**, so the Lab chrome keeps its UA defaults: the `html` rules (`line-height: 1.5`, `tab-size`, font
  stack, text-size-adjust, tap highlight; text in Nuxt UI components without a `text-*` size therefore inherits
  the Lab's `line-height: normal`), the universal reset on elements without `data-slot` (e.g. Lab content placed
  inside a Nuxt UI slot), `abbr`, `small`/`sub`/`sup`, `:-moz-focusring`, the date/time, search and spin-button
  pseudo-element fixes and `::file-selector-button`. Add a scoped rule when a migrated component needs one;
  adopt the full preflight and delete the scoped block when the chrome itself moves to Tailwind.
  `e2e/nuxt-ui.spec.ts` injects a title/description/list/control structure with and without `data-slot` and pins
  both outcomes. Tailwind source detection is `source(none)` plus explicit `@source`s (`index.html`, `App.vue`,
  `src/components`); a Tailwind class in any other directory needs one more `@source`.
- **Theme bridge, one source of truth.** The Lab theme store (`use-lab-theme.ts`, `theme/theme.ts`,
  `data-lab-theme` on `<html>`) stays authoritative. `useNuxtUiThemeBridge()` (called by `App.vue`) mirrors it onto
  the `.dark` class Nuxt UI's `dark:` variants read, synchronously with `data-lab-theme`. Nuxt UI's own colour mode
  (`useDark()`, `vueuse-color-scheme` in localStorage, `UColorModeButton`) is disabled with `colorMode: false`
  so nothing else can set the class or persist a competing preference; never add a second theme control.
  Nuxt UI's `--ui-*` tokens are mapped to the Lab palette in `lab-ui.css` as plain `var(--lab-color-*)`
  references (so they follow both themes without a per-theme block): `--ui-bg` = `bg`, `bg-muted` = `surface`,
  `bg-elevated` = `surface-alt`, `bg-accented` = `border`, `bg-inverted` = `text`; `--ui-text*` = `text` / `text-muted`
  (`text-inverted` = `accent-contrast`); `--ui-border*` = `border`; `--ui-primary` / `info` = `accent`, `success` =
  `ok`, `warning`, `error` = `danger`; `--ui-radius` = `--lab-radius`. The mapping is unlayered on purpose (it must
  beat Nuxt UI's `theme`-layer defaults, including its `.dark` block). Add a token to the Lab palette first, then map it.
- **Offline.** No remote fonts (the plugin is not given a font provider and `lab-ui.css` has no `@import url()`)
  and no remote icons: `i-lucide-*` names are inlined at build time from `@iconify-json/lucide` (`icon.clientBundle.scan`
  over `src/**/*.{vue,ts}`; names built at runtime or from another collection must be listed in
  `clientBundle.icons` / installed), and `disableRemoteIcons()` (`src/ui/offline-icons.ts`, called by `main.ts` and
  `src/test-setup.ts`, the Vitest `setupFiles` entry of both Vitest configs, so it holds for every unit test) removes
  Iconify's `fetch`, so an unbundled name is a missing icon, never a request to
  `api.iconify.design`. Everything is same-origin, so the offline e2e fixture and the `/widget/lab/` Pages base work
  (`pnpm docs:build:pages` + `test:pages`).
- **Unit tests.** Mount a Nuxt UI component with `global: { config: { globalProperties: testGlobalProperties },
  plugins: testGlobalPlugins }` (`src/test-support.ts` for the `pika` mocks, `src/test-support-ui.ts` for the real
  Nuxt UI plugin). A component that renders a Nuxt UI icon without the plugin has no bundled icons, which is why
  `InspectorPanelPrimitives.unit.test.ts` passes it. Overlays/tooltips/toasts also need `UApp` as an ancestor.
- **Overlays inside Lab dialogs.** The Lab's own dialogs are native `<dialog>.showModal()` (top layer), while `UApp`
  portals Nuxt UI overlays (`UPopover`, `UTooltip`, `USelectMenu`, `UDropdownMenu`...) to `body`. An overlay opened
  from inside such a dialog would render beneath the top layer and be inert. Point it into the dialog instead:
  `UApp`'s `portal` prop (or the component's own `portal`) can take the dialog element or a selector, or pass
  `:portal="false"` so it renders in place. Check this the first time a migrated component opens an overlay
  inside `WelcomeCard`/`TutorialConfirmDialog`.
- **Migrated so far.** `PanelDescriptionBar.vue`'s dismiss button is a `UButton` (ghost, neutral, `xs`, square,
  `i-lucide-x`, 24px target, solid accent focus ring), keeping its `aria-label` and the `button[aria-label="Dismiss"]`
  selector. `LabHeader.vue` (menus, buttons, tooltips, badges, popover), `DraftGuardDialog.vue` (buttons) and the
  Problems list (`author/AuthorProblems.vue`) are Nuxt UI + Tailwind too, together with the stale-preview notice in
  `PreviewPanel.vue`. The header's native `<select>`s are gone; specs go through the helpers in `e2e/fixtures.ts`.
  Notes from that migration: menu items cannot carry a `data-testid` (Nuxt UI does not forward it), so specs find them
  by role and name; both header menus are `:modal="false"` (Reka's modal menu `aria-hidden`s the whole page, which axe
  reports as `aria-hidden-focus`); a badge keeps its colour on the icon and uses the default text colour
  (`:ui="{ label: 'text-default' }"`) because the tinted `text-error`/`text-warning` fail contrast on their tint.
- **Cost.** The eager Lab chunk grows by about 168 KB raw / 54 KB gzip (Nuxt UI runtime, reka-ui, iconify,
  tailwind-variants, `UApp`) and the Lab CSS by about 197 KB raw / 25 KB gzip (the Nuxt UI component themes).
  The plugin's `experimental.componentDetection` would cut the CSS to about 184 KB (verified once) but is
  experimental and only sees components present when Vite starts, so it is not enabled; revisit when the set of
  used components stabilises.

## Package boundaries

This app is a private downstream consumer and architecture probe. It owns the Lab shell, inspectors,
live source workflow, and the showcases. It must not own, and must not gain:

- any part of `@deviltea/widget-core`'s semantic compiler/runtime, or `@deviltea/widget-vue`'s
  renderer/lifecycle/reactivity adapter surface — both are consumed exclusively through their public
  entry points (`@deviltea/widget-core`, `@deviltea/widget-core/inspection`, `@deviltea/widget-vue`);
  no private/internal import from either package;
- any part of `@deviltea/widget-inspector`'s protocol, transport, client or agent — it is consumed
  exclusively through its public subpaths (`/agent`, `/anchor`, `/channel`, `/client`, `/frame-bootstrap`,
  `/protocol`, `/transport`, `/value`), never its root entry or an internal module; `@deviltea/widget-vue`
  stamps no DOM attributes, so the Lab projects identity onto renderers only through `/anchor`;
- persistence/versioning/migration of any kind — `LabSession`'s `draftSourceText`/`documentState` and
  `preview` snapshots are in-memory only, and Monaco's own workspace/IndexedDB machinery is deliberately not used (see
  `use-monaco-editor.ts`) so it can never become a second, competing source of truth;
- an editor-command/undo architecture — Source text editing plus explicit Apply is the whole model.

When Lab work exposes a genuine gap in widget-core/widget-vue's public contract, canonicalize it on
GitHub (`DevilTea/deviltea-labs#10`/`DevilTea/deviltea-labs#13`) instead of silently working around it in Lab-private code — implementation evidence
may challenge architecture, but never rewrites it locally.

## Inspectors are readonly

The Blueprint and Dependencies panels consume `@deviltea/widget-core/inspection` (`inspectBlueprint`) of the
Document Blueprint, and the Runtime panel consumes the Inspector protocol (see below), as pure, passive
projections. They must never:

- call `state.set()`, invoke a Method, or otherwise force Property evaluation from inspector UI;
- reconstruct semantic status from diagnostics, or run their own graph/SCC analysis — every fact comes from
  core's compiler/runtime-authoritative data;
- treat `diagnostic.message` as a machine protocol — only the structured `code`, `location` (including its
  `type`), `path` and `related` locations drive navigation/rendering;
- read the authored source to rediscover what Core already exposes: a node's identity comes from the resolved
  `id`/`type` or the unresolved node's `id`/`type` hints, and its position in the source from the node's
  `sourcePath` (or `blueprint.getSourcePath()`), never from a hand-written traversal of the source grammar.

Real semantic interaction (State/Property/Method activity) stays exclusively in Preview
(`src/components/preview/PreviewPanel.vue`, via `useWidget()` from `@deviltea/widget-vue`). There is no
`Observe` action and no editor-domain operation anywhere in an inspector panel.

## Runtime Inspector is strictly passive

`src/components/panels/RuntimePanel.vue` and `src/components/runtime/*` never touch a Core Runtime: the
Runtime lives in the Preview iframe, and the panel consumes only `@deviltea/widget-inspector` protocol DTOs
through the remote `InspectorClient` of `store.previewHost.connection` (`runtime.getWidgetSnapshot`, then
`runtime.memberChanged` events via `use-remote-runtime-member.ts`). It never imports `inspectRuntime()`.
State members render the remote member snapshot only — nothing in the inspector reads `state.get()` or
`property.get()`. Property members render `Never evaluated` until the member snapshot reports
`status: 'completed'` — the latest result some *real* Runtime consumer (Preview) naturally produced — and
never `fresh`/`dirty`/`active`/`stale` labels. Methods are inventory only (name + the compiler's
`transitivelyWrites` and `transitivelyEmits` facts; the Runtime panel reads them from the Inspector snapshot, where
`transitivelyEmits` exists only from protocol 0.4 and can be absent); there is no invocation affordance. The Runtime Inspector always follows the
Preview connection and shows its Preview revision (`runtime-inspector/source.ts`); an invalid current
Document may leave an older valid Preview running, so it is not an unavailable Runtime state by itself.
Only a session with no valid Preview has an unavailable Runtime panel. The only Lab code that calls
`inspectRuntime()` is the Preview frame's tutorial observation (`src/tutorial/inspection-reader.ts`), which
holds the same `getSnapshot()`/`subscribe()`-only discipline.

## Dependencies inspector

The canonical readonly `Dependencies` Dockview panel owns two presentation views over the same current Document Blueprint facts. `Relations` (a focus-centric dependency inspector, readable at the default tool width) is the default view since issue #230 PR 3b; `Graph` is the opt-in topology view. Switching views is presentation-only: it preserves shared Document focus and never mutates semantic state.

`src/graph/` implements the authoritative Lab-side dependency projections. The Graph view continues to use this pipeline:

```text
BlueprintInspection -> projectSemanticGraph() -> toElkGraph() -> ELK layout -> toVueFlow()
```

- `relations.ts` — pure `projectRelations()`: `SemanticGraph + InspectorFocus + rootNodeId` -> a framework-agnostic Relations view model. It imports neither Vue Flow nor ELK. Root/no usable focus yields an explicit empty state; member focus exposes exact incoming **Used by** and outgoing **Depends on** facts grouped by remote widget; widget focus treats all members as the selected set, keeps cross-widget incoming/outgoing separate, and lists same-widget dependencies in an internal section. Every row retains the original semantic edge/reference/path/operation; unresolved stubs remain unresolved and non-focusable. Relations shares `graphShowAbsent`, but deliberately projects with isolated members present so the Graph-only `graphShowIsolatedMembers` presentation preference can never erase a focused member from this inspector. Resolved member/widget clicks write through the existing Document-scoped focus API; they do not request ELK layout.
- `src/components/dependencies/DependenciesPanel.vue` owns the internal `Relations | Graph` switcher and view-specific toolbar. The switcher follows the WAI-ARIA tabs pattern (roving tab stop plus Arrow/Home/End keyboard navigation and labelled tabpanels). The Graph DOM stays mounted with `v-show`, preserving pan/zoom across view changes. Shared focus changes never mutate Graph expansion state or request layout/refit; cluster identity selection and the explicit expand/collapse toggle are separate actions. `RelationsView.vue` renders the dense three-column inspector and the widget/internal-dependency mode without a canvas layout engine; same-widget unresolved stubs stay in the internal section rather than leaking into cross-widget outgoing dependencies.
- `types.ts` / `projection.ts` — the Lab's semantic graph shape and its pure, deterministic projection.
  Widgets are visual clusters (`GraphCluster`); State/Property/Method members are the semantic vertices
  (`GraphVertex`). Edge direction is owner -> declared dependency target; `state-get`/`property-get`
  project as `reads`, `method-invoke` as `invokes`, `state-set` (Method-only) as `writes`. `resolved`
  dependencies become `GraphEdge`s; `absent`/`invalid` become presentation-only `GraphStub`s, never a
  fabricated resolved edge. `absent` stubs (and any member with no other visible relation) are hidden
  unless the panel's `showAbsent`/`showIsolatedMembers` filters are on; `invalid` stubs are always
  visible. `transitivelyWrites`, `transitivelyEmits` and `invalidCycles` are projected verbatim from core inspection
  facts — this module never recomputes any of them.
- `elk-adapter.ts` — pure `toElkGraph()`/`fromElkResult()`, the JSON-shape boundary to ELK's graph schema.
  Accepts optional `LayoutGraphOptions` (`expandedClusterIds`). Collapsed clusters are treated as leaf
  nodes with compact dimensions (`COLLAPSED_CLUSTER_WIDTH`, `COLLAPSED_CLUSTER_HEIGHT`), and cross-cluster
  edges between collapsed clusters connect to the cluster node directly with duplicate endpoints collapsed
  for layout efficiency. Unit-testable without a worker or the real elkjs runtime.
- `layout.ts` — the shared `LayoutedGraph`/`LayoutGraphFn` adapter shapes and `LayoutGraphOptions`.
- `layout-session.ts` — `createLayoutSession(layoutFn)`: framework-agnostic, generation-guarded async
  wrapper around any `LayoutGraphFn` (real or a test fake). A layout result for a superseded `request()`
  call is discarded — this is what makes Graph layout safe as an asynchronous projection that never
  blocks Blueprint/Runtime/Preview availability (see "Layout worker boundary" below).
- `vue-flow.ts` — `toVueFlow()`: the laid-out `SemanticGraph` -> plain Vue Flow `nodes`/`edges`.
  Supports hierarchical progressive disclosure:
  - Widget clusters are the top-level view by default (collapsed), preventing visual overload on
    dense topologies (the Survey is 5 clusters / 37 members).
  - Expanding a cluster reveals its internal member vertices and stubs as child nodes.
  - Inter-cluster edges between collapsed clusters aggregate into single presentation edges. The
    canvas deliberately labels these with only a compact dependency count (`1 dep` / `N deps`);
    `semanticEdges` retains every exact member-level operation/path/reference for the details surface.
  - Selecting/focusing a widget or member highlights the connected subgraph and deemphasizes
    unrelated nodes and edges (`isDimmed` / `graph-node--dimmed` / `graph-edge--dimmed`).
  - Vue Flow is strictly viewer-only: every node is `draggable: false`/`connectable: false` and no edge
    is `updatable`.
- `src/components/graph/GraphCanvas.vue` — the only place in this app that imports `@vue-flow/core`
  (and its structural `dist/style.css`); custom node templates for `cluster`, `member`, and `stub`,
  themed through Lab/PikaCSS tokens. Collapsed and expanded cluster identities and expanded member cards are keyboard-focusable/selectable without changing expansion state. The collapsed cluster card makes widget type primary, widget id
  secondary, and summarizes member inventory as S/P/M counts; the expanded cluster becomes a subdued
  compound inspector shell rather than a dashed debug boundary. Member nodes keep State/Property/Method
  distinguishable by a small letter badge plus restrained accent, so kind is not encoded by color alone.
  Edge operation is encoded primarily by stroke treatment (reads thin solid, writes stronger solid,
  invokes dashed). Since PR 3c (audit U11) every edge label (the aggregate counts too) is hidden until its edge is hovered or selected, because neighbouring
  labels ran into each other; all text is 11px or more (members 12px, node footprints `VERTEX_WIDTH` 200 x 36, `COLLAPSED_CLUSTER` 240 x 88 to fit it), and `GraphKey.vue`,
  a row above the canvas that is always visible, says what S, P, M, W, E, ! and the three line styles mean, so the Legend popover is only the long form.
  Handles remain intentionally unobtrusive and the canvas uses only a subtle dot grid: these cues must
  never imply that the readonly inspector is an editable node editor.
- `src/components/graph/GraphEdgeDetails.vue` — panel-local edge-selection details (dependency-container
  `path` + reference target/operation, plus aggregated semantic dependencies list when an aggregated
  cluster-to-cluster edge is selected) — edge selection stays local, never expands into shared focus.

Graph works for an invalid current Document Blueprint (compile-time facts only, no Runtime dependency) and
its node click sets Document-scoped focus (`nodeId` + member). Blueprint and Graph never consume a
Preview-scoped node id when revisions diverge. Runtime and Preview use a separate Preview-scoped focus;
equal Document/Preview revisions synchronize the two scopes, while diverged revisions never map raw
`InspectionNodeId`s between them. A changed Document resets Document focus; a replaced Preview resets
Preview focus.

Viewport fit policy (`DevilTea/deviltea-labs#27` Finding 1 & reliable lifecycle):
`GraphCanvas.vue` coordinates `fitView()` with both layout readiness and container dimensions. In
Dockview, tabs mounted in inactive/background state have 0 client dimensions, which caused an initial
`fitView()` in `onNodesInitialized` to fail. `GraphCanvas.vue` pairs `onNodesInitialized` with a
`ResizeObserver` on the canvas container element to run `attemptFit()` as soon as non-zero dimensions
become available (e.g. when the user first switches to the Graph tab). Before accepting an automatic fit,
`attemptFit()` also verifies that Vue Flow's current internal node set exactly matches the current
presentation node ids and that every node has non-zero measured dimensions; `onNodesChange` retries while
a new layout generation is still being measured. This prevents `fitView()` from succeeding against only a
partially measured subset and then incorrectly marking that generation fitted. `useDependencyGraph` exposes
`layoutVersion` (incremented only when ELK layout succeeds), which resets fit tracking so the graph
automatically refits on semantic graph replacements and cluster expansion/collapse, while ordinary
Runtime activity and focus deemphasis never trigger a refit. `DependenciesPanel.vue`'s Graph view also exposes an explicit
**Fit graph** button along with **Zoom in** / **Zoom out** and **Expand all** / **Collapse all** controls in the toolbar. Fit leaves 8% around the graph (it used to
leave 20%, so a fitted graph used about 40% of the canvas); an expanded Survey is still larger than the pane and is read by zooming.

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

**Revert vs. Undo last apply.** Revert discards the unapplied draft only (disabled when there is none). *Undo last
apply* (`LabSession.undoLastApply()`, `LabStore.undoLastApply()`) restores the source the Document held before its
last revision-advancing commit, as a NEW Document revision through the same root-replacement commit and Preview
promotion path as Apply (origin `'undo'` in Document Tools): it never rewinds Core's Document, so revision numbers keep
growing (r0 -> r1 -> undo -> r2) and the Preview is replaced like for any valid commit. The session keeps a bounded
stack (`LAB_UNDO_LIMIT` = 20) of the previous applied source text, pushed by every commit that advances the revision
(JSON Apply, presets, Structure commands; not a structural no-op, not a failed parse, not Undo itself, so repeated Undo
walks back one step at a time). It is unavailable while an unapplied draft exists (`draft-dirty`: it would silently discard typing;
Revert or Apply first) and while another command runs; a fresh showcase session starts with an empty stack. The stack is a
convenience over the Document commit path, not an authoritative history, redo does not exist, and nothing persists.

## Author workspace (Phase 3)

The canonical authored surface is the outer `Author` panel with three Lab-owned views: `Catalog`,
`Structure`, and `JSON`. `AuthorJsonView.vue` contains the existing Monaco draft workflow; header
`Apply`/`Format`/`Revert` controls continue to operate on that same draft. `Catalog` reads the immutable
public `session.system.catalog` and public `WidgetPlugin.capabilities`; it never reads or derives from the
curated `ShowcaseEntry.sources` Implementation Explorer registry. Catalog entries carry the plugin and config
descriptions, slot descriptions, and optional passive Draft 2020-12 config JSON Schema metadata (Event descriptions
are not in the catalog; they come from `inspectPlugin`); capability-presence facts come from
`WidgetPlugin.capabilities`. An entry with a schema shows it in a collapsed `<details>`, and "Copy catalog JSON"
copies the whole public catalog as plain JSON (`{ widgets: [{ type, description, config: { description, schema } | null,
slots: { name: description } | null }] }`) so the plugin definitions can be handed to an AI as authoring context.
The view must not invent state/property/method schemas or member definitions that Core does not publish
through the catalog contracts; config schema metadata is authoring guidance, not Runtime validation truth.

`Structure` renders the current committed Document Blueprint inspection and uses Document-scoped focus.
Since issue #230 PR 3c (audit U15) it edits the selected widget's whole authored `config`, type-aware
(`ConfigFieldEditor.vue`, recursive, inside `AuthorStructureView.vue`): a switch for a boolean, a number box that knows
`integer`/`minimum`/`maximum`, a list for an `enum`, a text box for a string, an object with its optional keys (add from a list, remove with
a button; free keys of an `additionalProperties` object are added by name) and an array with Add and Remove. The controls
come from the plugin's passive config JSON Schema (`WidgetCatalogEntry.config.schema`, read by `src/lab/config-schema.ts`: `$ref`,
`type`, `enum`/`const`, `oneOf`/`anyOf` by a shallow "does the value look like this branch" test, `properties`, `required`,
`additionalProperties`, `items`, `minItems`/`maxItems`, the numeric and length limits, `default`, `description`). That reading chooses a
control and what may be added or removed and never validates: Core's compiler stays the authority, and an edit that makes the Document
invalid shows up as Core diagnostics in Problems. Without a schema (or inside a shape the module does not read, such as a `oneOf` no
branch of which fits) values are typed by what they hold; scalars still get switch/number/text controls, objects and arrays offer no add or
remove, and anything else is edited as its JSON text (Set value / Cmd or Ctrl+Enter). Switches and lists apply at once; text and number boxes apply
on Enter or **Set value**, and a refusal (not a number, not an integer, outside `minimum`/`maximum`) is shown at the field and sends nothing.

`EditConfigCommand` (`{ nodeId, documentRevision, configPath, edit: replace | add | remove }`; `ReplaceConfigScalarCommand` still exists for
the scalar case) carries both the current Document `InspectionNodeId` and Document revision; `src/lab/author.ts` resolves that exact
snapshot node and lowers the command to a `SourcePatch` addressed by the node's Core-computed `sourcePath` (array form, except that appending
to an array uses the JSON Pointer form `.../-`, the only way a patch can say "append"; the first key of a widget that has no `config` yet
creates it). The component never constructs a patch and never targets a widget by id, which keeps duplicate authored ids and cross-revision focus
safe. A path that no longer exists, an `add` over an existing key, a stale revision and a non-JSON value are explicit `unsupported` outcomes;
mechanical patch failures are `patch-error`. After a **Structure** commit Document focus stays on the same widget and member (found again
by id and type; an ambiguous or missing one goes back to the root), so edits can follow each other; every other commit (JSON Apply, preset,
Undo, showcase switch) still resets to the root.

Successful Structure commands and JSON Apply share `LabSession`'s Document commit and Runtime promotion
boundary. A successful Structure commit rewrites both applied source text and the JSON draft to deterministic
pretty JSON only when the draft still equals the command's captured clean text; a concurrent Monaco edit is
preserved as dirty. Invalid Document commits advance the authored revision while retaining the prior valid
Preview revision. No persistence, authoritative history, redo, collaboration, drag/drop, or Runtime-state migration
belongs to this Phase 3 workspace (the bounded "Undo last apply" stack in "Apply lifecycle" is a convenience over the
Document commit path, not a history).

### Author recovery and diagnostics (Phase 4)

`StatusDetails.vue` (the header's "Document and preview details" popover; it used to be the Author panel's own
`AuthorStatusSurface.vue` box, folded into the popover by issue #230 PR 3b so the facts are shown once) is a Lab-owned status
projection for the current Document. It reads the draft's Lab-only SourceParseError, Core's committed blueprint.sourceJsonCompatible and blueprint.status,
Core's aggregate blueprint.diagnostics.length, Core inspection recovery counts, and the existing
Document/Preview revision link status. It does not parse JSON outside Apply, perform a compatibility
check, classify diagnostic codes, or turn a diagnostic message into a second protocol. JSON syntax errors
therefore remain distinct from Core source-compatibility and Blueprint semantic status.

BlueprintTree continues to traverse BlueprintInspection.nodes and sourceSlots, so unresolved nodes and
raw-slot placements remain visible and selectable. DiagnosticList displays Core's location/path fields
and uses src/lab/diagnostics.ts only to resolve a node location through the current Document inspection.
Its `related` chips omit the entry that is the diagnostic's own location (Core's `property-evaluation-cycle`
lists every member of the cycle, itself included); every other entry stays, in Core's order. Each chip
names its widget with the header's vocabulary and separator (`id : type · property "name"`, a bare widget
location is just `id : type`; an unresolved node uses Core's `?` hints and `(unresolved)`); a related
location on the diagnostic's own widget (same `node`) stays short (`property "name"`, `widget`) because the
header names that widget. When two different widgets in one diagnostic (its own and its related ones) read the same `id : type`
(`duplicate-widget-id`; one widget listed twice in `related` does not count), the chip appends the node's
inspection `sourcePath` (`same : Text @ slots.items[1]`). Chips wrap onto several lines
(`overflow-wrap: anywhere`) and `title` is the full label; they are not truncated. These labels are identifiers, like the
header's, and add no i18n strings.
Source-level locations intentionally return no inspection node and remain non-navigable. Node-level
diagnostic navigation writes Document-scoped shared focus; it never consumes Preview-scoped IDs or maps
across diverged revisions. Structure and Blueprint read that same Document focus, while Runtime and
Preview retain their Preview-revision scope.

Phase 4 adds no persistence/history/redo/editor framework, second validator, compatibility
implementation, or alternative authored source authority.

### Header, status chips and draft protection

`LabHeader.vue` is one row from 1280px up (`e2e/header-feedback.spec.ts` pins it at 1280/1440/1920), grouped by job:
the title; the **Examples** menu; two plain-language **status chips** and a details popover; the edit actions
**Apply / Revert / Undo / Format**; and an **overflow** menu with Tutorial, Theme, Language and a **Developer**
submenu (Implementation, Document Tools). Hidden test fixtures stay reachable only through `?showcase=`.

- *Examples menu* (`UDropdownMenu`): a Showcase group and the current showcase's Preset group (checkbox items, the
  current one checked). The trigger always names the showcase and the last loaded preset
  (`LabStore.loadedPresetId`: the showcase default on entry, then the last preset loaded), or "edited": `deriveExampleState()`
  names the loaded preset only while there is no unapplied draft and the applied source text equals that preset's text (or
  another preset of the showcase it exactly equals, so Undo back to the default names the default again), otherwise
  `edited`. `data-showcase-id`, `data-preset-id` and `data-example-kind` are the machine-readable hooks.
- *Status chips* (`deriveLabStatus()`): validity (`data-state` `valid` | `problems`, `data-problem-count`;
  "Valid" / "N problems"; a JSON syntax error of the last Apply counts as one problem, since no Document was committed
  from that text) and preview (`data-state` `current` | `stale` | `unavailable`: "Preview up to date" / "Preview shows the
  last valid version" / "No preview yet"). `data-testid` stays `document-status` / `preview-status`. Revision numbers, the Blueprint
  status and Linked / Diverged are developer details in the info popover (`status-details`; `revision-link-status` lives there).
- *Edit actions*: a disabled action keeps `aria-disabled="true"` instead of `disabled` so it stays focusable and its tooltip
  can say why (nothing to apply / revert / undo, or "apply or revert your unapplied edits before undoing"); the click
  handler also refuses. Apply's tooltip shows the shortcut as key caps. Undo shows "Undo" and is
  named "Undo last apply" for assistive technology (the visible text is contained in the name); because that name contains
  "apply", specs and helpers must look the Apply button up with `exact: true` (or its test id).
- *Cmd/Ctrl+Enter* applies from Monaco (an editor *action* registered in `use-monaco-editor.ts` and disposed with the editor; a
  `addCommand()` would leak a global keybinding per remount; Monaco binds the key to "insert line" otherwise) and from anywhere
  else through `App.vue`'s window listeners. Everything except Dockview tabs is handled in the **bubble** phase, so a control that
  owns Enter wins (`defaultPrevented` is honoured; a Graph node's `@keydown.enter.prevent.stop` never reaches the window). A
  focused Dockview tab preventDefaults Enter itself, so events whose target is inside `.dv-tab` are handled in the **capture** phase and
  claimed (the bubble listener then skips them). It leaves events inside `.monaco-editor` (the editor action handles those) and open
  `[role=menu]`s alone, and honours `canApply`.
- *Unapplied-draft protection*: loading a preset or switching showcase while `isDirty` asks first
  (`DraftGuardDialog`, a native `alertdialog` through `useModalDialog`, "Keep editing" first and focused, Escape = keep, "Discard
  changes" continues). The guard lives in the header/UI layer (`createDraftGuardStore`), never inside
  `LabStore.switchShowcase()`/`applyPreset()`, so the tutorial (which has its own dirty-draft confirmation and calls the store
  directly) never asks twice. A header action that can open a dialog (the guard, the tutorial's confirmation) runs only after
  its menu closed (`onCloseAutoFocus`) and, when the menu closed by Escape or an item select, focus was put back on the menu's trigger,
  so the dialog's focus-return target is that trigger. When the menu closed because the user interacted *outside* it (clicked into
  Monaco, onto the other header menu; tracked with `onInteractOutside`, as Reka's own handler does for non-modal menus) focus is left
  where the user put it: refocusing the trigger there swallowed typing and closed the menu that click had just opened. A chosen item's
  action runs in both cases. e2e (`menu focus handling`) pins both, and the menu helpers click a menu path once, with no retry.
- `LabStore.authorView` (Catalog / Structure / JSON) lives in the store, not in `AuthorPanel`, so other surfaces can
  open the JSON view; `showProblems()` sets `activeTab`, `authorView` and `problemsFocusPending`. `Workbench.vue` now also feeds
  Dockview's active panel back into `activeTab` (and never re-activates the panel already active, which moves DOM focus out of
  Monaco), so asking for a tab that is "already" `activeTab` in the store but no longer on screen still switches.
- The tutorial rail is a docked column: a 320px flex item beside `Workbench` in `.lab-body` (below the header), see "Workbench layout
  and the Selected widget pane". It was `position: fixed`, then `absolute`, and covered what was under it both times.

### Problems list and editor squiggles

After an Apply the JSON view shows the Problems list under the editor (`AuthorProblems.vue`, in `AuthorJsonView.vue`).
`collectProblems()` (`src/lab/problems.ts`) lists the last Apply's JSON `SyntaxError` (Lab-only, `SourceParseError`, first)
and the committed Document's Core diagnostics in Core's order; `code` and `message` are Core's (or the engine's), verbatim and
never translated, parsed or classified. Each row jumps to a source range and has an error squiggle over the same range.
`LabStore.problems` depends only on the committed Blueprint and the parse error (reference-stable computeds), not on the
per-keystroke session tick, so typing re-runs neither the inspection nor the collection; the editor's squiggle ranges are
recomputed from the current text on every edit, because they must follow it.

The range is located by source path in the **current editor text**, so it stays on target while the user edits and an
unapplied draft is still mapped (a note says the rows are "from the last Apply"; an unparsable draft has no ranges). The
path is `blueprint.getSourcePath(node)` of the diagnostic's location node plus its own relative part (`invalid-widget-config`'s
`path` is config-relative, the other diagnostics' `path` is node-relative, a `slot` / `slot-child` location adds
`slots[slot][index]`, a source-level diagnostic's `path` is absolute). `problemSpan()` then highlights a primitive value whole,
a widget (or one of its Property/Method members) by its `"id"` (else `"type"`) member, any other object/array by its property key
(or, for an array item or the root, the line it opens on), never a whole subtree; a path that no longer exists resolves to its
nearest existing ancestor. A syntax error is located by the engine's message position when it has one (V8 does not always:
"Unexpected token ..." has none) and otherwise by `json-locate.ts`'s own scan of the same text. A Core diagnostic with no node
(`getSourcePath()` returns `null`) points at the root.

Squiggles are model decorations with Monaco's `squiggly-error` class, not `setModelMarkers()` markers: in the vendored
`editor-core` build the marker service holds markers but never turns them into decorations (checked in a real browser), so
markers would draw nothing. `data-marker-count` on `[data-testid=json-editor]` is the number of ranges handed to the editor
(only lines in the viewport render a `.squiggly-error` element).

**Grouped cycles (audit U16).** Core reports an evaluation cycle once per Property in it, each time with the same `related` list (one frozen array
shared by those diagnostics). `collectProblems()` tags such a problem with its cycle (`LabProblem.cycle`: the list's identity as an id and the members
as `widget.member` labels) and `groupProblems()` turns two or more problems of one cycle into one `cycle` entry; `AuthorProblems.vue` shows it collapsed
(`data-testid=problem-group`, `aria-expanded`, the code, "N members depend on each other in a loop" and the members in Core's order) and expanding it lists
Core's own diagnostics, one `problem-row` each, code, message and location verbatim, each still a jump. Only the presentation is grouped: the list,
the summary, `data-problem-count`, the header chip, the editor squiggles and the Blueprint panel's "All diagnostics" view keep Core's count and text
(a cycle with a single diagnostic is an ordinary row).

### Stale-preview notice

When the Preview lags the Document the notice above it says why and offers an action: "Your last change has N problems,
so the preview still shows the last working version." with **Show problems** (`preview-show-problems`, `store.showProblems()`),
or, if the Document is valid but the Preview has not caught up, a plain "does not show your latest change yet" line without
the button (a valid Document has no problems to show).
`data-testid="preview-diverged-status"`; revision numbers appear only in the header's details popover.

### Separate inspector panels with shared presentation primitives (Phase 5)

Blueprint and Runtime remain separate outer, canonical Dockview panels. `BlueprintPanel.vue` is the
current Document inspection surface for semantic status, diagnostics, recovery nodes, and Document
focus; `RuntimePanel.vue` is the Preview-revision surface for passive Runtime state/property/method
inspection and Preview focus. They must not gain a shared Blueprint/Runtime mode, shared revision state,
or cross-revision `InspectionNodeId` mapping. Preview Inspect selects the Selected widget pane when
Document/Preview revisions are linked (it selected Blueprint before) and Runtime when they diverge; Graph and Implementation retain
their existing Document-scoped entry points.

`src/components/inspector/InspectorPanelShell.vue` and `InspectorSplitLayout.vue` are intentionally
small, props/slot-only presentation primitives. The shell owns only the repeated description-bar and
column-container chrome; the split layout owns only the tree/divider/details columns. Blueprint and
Runtime continue to provide their own data, status lines, diagnostics, recovery behavior, selection
handlers, and details components. Do not use these primitives as a semantic or focus abstraction, and
do not merge the two outer panels merely to remove presentation duplication.

### Workbench layout and the Selected widget pane (issue #230 PR 3b)

**Layout.** The default layout is two Dockview groups: the tool group (Author, Selected widget, Blueprint, Runtime, Dependencies;
Author active) and Preview. The tool group is about half the workbench (48%, clamped to 420-940px; it was about 29%, which clipped
Relations and the Implementation source). The layout is saved to `localStorage` (`widget-lab:layout`, value
`{ version, layout }` where `layout` is `DockviewApi.toJSON()`) 250ms after it settles and on `pagehide`, and restored by
`Workbench.vue` on load. `src/lab/layout-storage.ts` (no Vue, storage injected) owns the format: a layout is used only if it has the
current `LAYOUT_VERSION`, every canonical panel, panels that name registered components only, and a sized grid; anything else (invalid
JSON, another version, a missing panel, an unknown component) reads as "none" and the default layout is built. Dockview's
`fromJSON` can still throw for plausible data: that is caught, and the default is built. Whatever was stored and not usable is removed.
Bump `LAYOUT_VERSION` whenever a change to the panels or their components would make an old saved layout wrong (the first version
already includes the Selected widget panel). All storage access is try/catch; blocked storage means "nothing saved". Panels opened on
request (Implementation, Document Tools) are saved with the layout but stripped from the data before Dockview loads it
(`stripLazyPanels`, applied by `loadSavedLayout`), because their content depends on a request that load did not make; a group whose
active panel was one of them activates its first remaining panel, and a group that held only such panels (a lazy panel dragged into a group of its own) is
removed from the grid: its size goes to the previous sibling (the next one when it came first), a branch left with one child is replaced by it
(a leaf takes the branch's size; a branch's children are lifted into the parent, scaled to fill it, and a root left with a single branch flips its axis), and
`activeGroup`/`maximizedNode` are dropped when they pointed into the old tree, so the other dividers stay where the user put them. A grid it does not
recognise (or one with nothing but lazy panels) is still unusable (default layout). After a restore `Workbench.vue` writes Dockview's active panel to `LabStore.activeTab` (the Dockview-to-store
subscription is made later), so the store and the screen agree about the open tab (Dockview-vue also reports the restored active panel a moment later through
`onDidActivePanelChange`, so that explicit write only closes the short window before; `e2e/layout.spec.ts` asks for Author from outside Dockview after a
restore, but no browser spec can tell the two apart: with the write removed the spec still passes, because that later event arrives first). Saved sizes are proportional on restore, so a layout from a wide window fits a narrow one. Tab titles are
set when a layout is built or restored and follow a language switch. **Reset layout** (overflow menu; `WorkbenchLayoutStore` is a request
bridge like Document Tools) clears the saved layout and rebuilds the default. The selected showcase is restored separately, by
`?showcase=`.

**Tutorial rail.** `TutorialRail.vue` is a 320px flex column beside `Workbench` inside `.lab-body`. `Workbench.vue` already observes
its own size, so Dockview re-lays out when the rail opens or closes, and the rail never covers the header, the overflow menu, the
Dockview groups or the Preview frame (the survey's own Language select). With the rail open at 1280px the tool area is about 460px, narrower than the three
Relations columns need (about 680px), so `RelationsView.vue` stacks them (Used by, the focus, Depends on) and scrolls vertically below 680px of **pane** width
(a container query, so dragging the divider changes it too) instead of scrolling sideways. `e2e/layout.spec.ts` measures this at 1280, 1440 and 1920.

**Selected widget.** `SelectedWidgetPanel.vue` (canonical panel `widget`) is the first piece of the Explain area: one widget's
declaration and Runtime values together. The widget is the shared Document focus (the Blueprint tree, Relations/Graph and Preview
Inspect all set it). Left (stacked below 600px of pane width, by container query) `BlueprintNodeDetails` (`embedded`): identity,
location, config, slots, members, diagnostics; right `RuntimeNodeDetails` (`embedded`) over the same Preview connection the Runtime
panel uses (`useSelectedRuntimeWidget()`, shared by both). The Runtime half only exists while the Preview shows the Document's
revision (Preview focus is the linked mapping of Document focus); otherwise the pane says why (`data-runtime-state`: `diverged`,
`no-preview`, `unresolved`, `unavailable`, `loading`, `ready`) instead of mixing revisions. Blueprint and Runtime stay as
they were; the pane reuses their detail components and does not replace them. Both panels stay mounted while their tab is hidden, so the Runtime snapshot is one
shared source (`use-selected-runtime-widget.ts`, one per store): requested once per selection, and only while at least one panel reports itself visible
(`usePanelVisibility(params.api)`, Dockview's `isVisible`/`onDidVisibilityChange`). A panel that is not visible reads `null`, so the member rows under it, which subscribe
to the remote Runtime, are not rendered and hold no subscription.

**Runtime values (audit U10).** State and Property rows are `RuntimeValueRow.vue`: the member name and a one-line summary that takes
the room the row has (no fixed width; its full text is the tooltip), a separate named disclosure button (`aria-expanded`,
"Value of NAME") for containers and long or cut strings, and a separate select button (focus). The open value is
`InspectableValueTree.vue`, an expandable tree over the Inspector value DTO. The limits that remove information (depth 4, 50 entries,
1000 nodes, 500 characters) belong to the Inspector snapshot, set in `packages/inspector`; the Lab does not change the protocol or work
around them and instead marks every cut where it happened ("truncated by the Inspector snapshot (nested too deeply)", "more entries
were left out", "cut"), with one note under a value that has any (`hasTruncation()`). `formatInspectableValue()` (the one-line
summary) still prints `<truncated>`.

**Config (audit U25).** `ConfigView.vue` shows the resolved config by default and the authored one on request, and only when they
differ (`lib/config-compare.ts`, structural equality; it names the top-level fields that differ); equal configs are one block with a note.

### Preview failure and first paint (issue #230 PR 3c, audit U22, U23)

**Preview failure.** If the Preview frame does not answer in time (`readinessTimeoutMs`, 15 s) or its connection closes by itself, `previewHost.error`
holds the cause and the Lab says so instead of leaving a blank pane: the Preview pane shows an alert (`data-testid=preview-error`, the engine's message
verbatim, **Try again**), the dead iframe is hidden, and the header's preview chip is `failed` ("Preview failed to load"). **Try again**
(`previewHost.retry()`) mounts the latest requested Preview again, which reloads the frame; success clears the error. The coordinator learns about a
connection that closed by itself from the driver's `onUnexpectedClose` (not for a close the driver itself caused by navigating, timing out or
disposing). A renderer that crashes without closing its port cannot be seen by the parent, so only a later failed mount or a closed port reports
it. `?lab-test&preview-timeout-ms=N` shortens the timeout for specs only (`previewReadinessTimeoutOverride()`, inert without `lab-test`).

**First paint.** The stylesheet's default palette is the dark one and `html[data-lab-theme='light']` only exists once the app module has run,
so a light user used to see a dark screen first. `index.html` now has an inline script that sets `data-lab-theme` and `color-scheme` from the same
inputs as `resolveLabTheme()` (the stored `widget-lab:theme`, else the system preference, else light) before anything paints;
`theme-bootstrap.unit.test.ts` runs that exact script against `resolveLabTheme()`, and `e2e/polish.spec.ts` holds the app's entry module and checks the
theme and the page colour before it has loaded. Keep the script in step with `STORAGE_KEY` in `use-lab-theme.ts`.

### Accessibility, language and polish (issue #230 PR 3c, audit U18-U21)

- **Targets and text.** Interactive elements of the chrome are at least 24px high (and wide, except text controls that are wider anyway); no text of the
  chrome (HTML or the Graph's SVG labels) is under 11px (`pika({ fontSize })` values and scoped CSS were raised; do not add a smaller one). A native checkbox
  is 16px with its label as the 24px target. The check is run by hand with a Playwright script that lists visible interactive elements under 24px and
  text nodes under 11px per surface, plus axe-core (tags wcag2a, wcag2aa, wcag21aa, wcag22aa and best-practice; both themes, 1440px) on Header, Author (JSON, Catalog,
  Structure), Selected widget, Blueprint, Runtime and Dependencies (Relations, Graph); axe is deliberately not a dependency of the repository.
  `e2e/polish.spec.ts` pins the Graph's sizes.
- **Focus.** `dockview-theme.css` draws a 2px accent ring (inside the tab) on a Dockview tab or tab action reached with the keyboard (`:focus-visible`; Dockview's own
  1px divider-colour outline is `!important`, so the Lab's rule is too, and more specific). The Graph's expand/collapse toggles, cluster buttons and member
  cards have a 2px accent outline. Graph **edges** cannot take focus: Vue Flow writes their `tabIndex` attribute with a capital I, which SVG ignores; Relations
  is the keyboard route to the same facts, and the Graph has **Zoom in / Zoom out** buttons next to Fit graph (the wheel and pinch already zoom).
- **Language.** Navigation names are Taiwan Chinese: Author is 編寫, Dependencies 相依性, Relations 關聯, Graph 關係圖, Catalog 目錄, Structure 結構 (tab titles
  follow a language switch). **Widget vocabulary stays English** (Widget, Blueprint, Runtime, Preview, Document, State, Property, Method, Event, Source) and so do
  the developer panels **Implementation** and **Document Tools** (they name features of the docs and Core, and the specs reach them by those names), `JSON` and the
  product name. Source-owned text is never translated: Core diagnostics, plugin and schema descriptions, the survey's questions and the engine messages. The
  survey examples' names and descriptions in the Examples menu are Lab copy and are translated. `i18n/pr3c-messages.unit.test.ts` fails when a literal passed to
  `i18n.t()` in the PR 3c surfaces has no zh-TW entry.
- **Monaco contrast (U18).** `theme/monaco-themes.ts` is One Light and One Dark Pro with the colours that failed 4.5:1 on the editor background replaced by
  value (light line numbers, string green, property-name red and the teal of `true/false/null`; dark line numbers and property-name red); the Shiki viewer of
  the Implementation panel still reads the unmodified themes. `monaco-themes.unit.test.ts` computes the contrast.

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
is valid. `separateWidgetSource()` never throws and returns `{ separated, diagnostics }`; the section shows
`separated` and lists Core's representation diagnostics (`code`, `{ area, path }` location, `message`) when
there are any. It is a read-only projection of the current Document source, never an alternate source
authority or validator; invalid/recovery Documents show that the Core precondition is unavailable.

The Document trace is a finite, session-only ring of Lab-observed parse/commit/patch/conflict metadata.
It is explicitly telemetry: no persistence, replay, restore, redo, collaboration, or authoritative
history semantics may be added (an "Undo last apply" commit is just another observed commit, origin `undo`). Runtime/Preview behavior, revision-scoped focus, Author recovery,
Blueprint/Runtime separation, Dependencies, and Implementation entry points remain unchanged.

## Active follow-up backlog

Post-convergence usability/hardening work is tracked on GitHub; read the issue before working in its
area, and keep implementation truth in those threads rather than expanding this file:

- `DevilTea/deviltea-labs#25` — guided onboarding/tutorial + curated widget/component implementation source explorer;
- `DevilTea/deviltea-labs#26` — Survey semantic presentation correctness (result freshness, failed-Property display,
  dependency-issue propagation);
- `DevilTea/deviltea-labs#27` — Graph/workbench correctness and recovery;
- `DevilTea/deviltea-labs#28` — real-browser contract tests + baseline accessibility semantics;
- `DevilTea/deviltea-labs#29` — this document's current-state refresh;
- `DevilTea/deviltea-labs#30` — self-contained deployment / Monaco self-hosting / lazy-loading policy.

## Testing

Intended split for this app:

```text
framework-agnostic semantic/viewmodel logic -> Vitest unit tests
browser/workbench/DOM/focus/integration behavior -> narrow real-browser contracts
```

Unit tests are colocated `*.unit.test.ts` against real `@deviltea/widget-core` fixtures (no mocked
core): `src/lab/`, `src/graph/`, `src/runtime-inspector/`, `src/implementation/`, `src/sandbox/`,
`src/composables/`, and `src/showcases/**` (plugin semantics, preset validity, and selected renderer contracts via
`@vue/test-utils` + `happy-dom`). The real-browser contract harness is being introduced by `DevilTea/deviltea-labs#28`;
until it lands, workbench/editor/browser-integration behavior has no automated coverage here — do not
compensate by writing broad DOM-simulation tests for it, and once the harness exists, put
browser-semantics assertions (focus, keyboard navigation, dialog behavior) there instead of in
happy-dom unit tests.

Browser specs reach the header's menus only through the helpers in `e2e/fixtures.ts` (`selectShowcase`, `loadPreset`,
`setTheme`, `setLocale`, `openDeveloperTool`, `chooseTutorialMenuItem`, `answerDraftGuard`, `openStatusDetails`,
`openDependenciesGraph` (Relations is the default Dependencies view; `loadPreset` knows the zh-TW names of the survey examples), and the `expectShowcase` /
`expectDocumentStatus` / `expectPreviewStatus` assertions), never with ad-hoc menu clicks, so a future header change touches one
file. Two things to know when writing Monaco interaction specs: Playwright's Desktop Chrome user agent is a Windows one, so
Monaco's Cmd/Ctrl is **Control** whatever the host OS is; and Monaco re-indents and auto-closes inserted text, so edit inside a
JSON string (double-click a word, `keyboard.insertText`) instead of inserting a whole document.

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
