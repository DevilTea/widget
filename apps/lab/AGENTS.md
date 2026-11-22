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

1. **Lab shell** — the two-column workbench's `Author` workspace (Catalog/Structure/JSON), Preview, the `Explain` tab, the
   `Selected widget` pane, the live `Events` log, and readonly Blueprint/Runtime/Dependencies inspectors over `@deviltea/widget-core` /
   `@deviltea/widget-vue`.
2. **Showcases** — served by the same shell and Document-backed authoring model, as registered in
   `src/showcases/registry.ts`: `Interactive Survey` (`survey`) is the default, and `Trip budget splitter`
   (`trip-budget`), `Quote rules shared by browser and backend` (`quote-rules`), `Onboarding wizard with an Events log` (`onboarding`), `Legacy document repair` (`document-repair`) and `One document, two renderer packs` (`renderer-packs`) are listed after it in the header's Examples menu; `Sandbox` (`sandbox`, minimal fixtures) is a hidden,
   test-only fixture (see "Showcase selection" below). The former `Product Prototype` (`crm`) and
   `Vuetify Task Workspace` (`vuetify-tasks`) showcases, and the CRM tour, were removed (tracking issue
   `DevilTea/widget#230`); the new showcases of that issue are added one PR at a time (`trip-budget`, `quote-rules`, `onboarding`, `document-repair` and `renderer-packs` are the first five).

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
- `src/showcase-host/` — the showcase host contract (see "Showcase isolation" below): the one module outside its own
  directory a showcase may import. `host.ts` (`ShowcaseHost`: locale and theme), `messages.ts` (showcase-local messages
  selected by the host locale), `sources.ts` (the curated Implementation registry types), `config-schemas.ts`
  (`ConfigJsonSchema`, `ConfigSchemaMap`, `CONFIG_JSON_SCHEMA_DIALECT`: the types of a config schema map; the Lab generates
  it, and a showcase may hand its own, as quote-rules does) and `inspect-anchor.ts`
  (`useInspectAnchor`), the one-line-per-renderer projection of `useWidget()` identity onto a
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
- `src/explain/why.ts` — the Explain tab's "why" sentences (Lab UX phase 2, see "The Explain tab" below): pure, built from the
  Blueprint inspection and the plugin's config JSON Schema, unit-tested over the Survey, Trip budget, quote-rules and Sandbox
  presets. `src/lib/prose.ts` splits generated documentation into text and Markdown code spans (`splitInlineCode`) and a
  translated template into text and placeholders (`templateParts`).
- `src/lib/diagnostic-format.ts` — shared structured-diagnostic formatting helpers (`formatDiagnosticPath`,
  `formatDependencyReference`, `formatSeparatedSourceLocation`, ...) reused by `blueprint/DiagnosticList.vue`,
  `runtime/RuntimePropertyDiagnosticList.vue`, the Dependencies/Graph detail views, and the Document Tools
  panel. `message` is never parsed for structure; every field beyond it comes from the diagnostic's own
  structured fields (`code`, `location`, `path`, `reason`, ...). The Lab does not enumerate or label
  diagnostic/failure codes: a code is shown verbatim, so a new Core code needs no Lab change.
- `src/components/` — the app shell: `LabHeader.vue` (the grouped header, see "Header, status chips and draft
  protection" below), `Workbench.vue` (`dockview-vue` two-column layout, about half the width for the tool group by default, saved and restored, see "Workbench layout and the Selected widget pane" below), `NonClosableTab.vue`
  (a custom Dockview `tabComponent` — `DevilTea/deviltea-labs#27` Finding 2: registered as `tabComponents.nonClosable` and
  selected via `AddPanelOptions.tabComponent` on each of the seven canonical panels' `addPanel()` calls, it
  renders only a title (kept in step with `onDidTitleChange`, so a language switch retitles it), no close control, so those panels can never be closed; Dockview's own `Tab`
  wrapper — drag/reorder/dock/resize/activate — is untouched, since a `tabComponent` only replaces what
  that wrapper renders as content), `panels/*` (Author/Selected widget/Blueprint/Runtime/Events/Dependencies tabs, plus the
  lazily-registered `ImplementationPanel.vue` — `DevilTea/deviltea-labs#25` P3; it is the one panel `Workbench.vue`
  registers with no `tabComponent` override, i.e. Dockview's own default (closable) tab, since it is
  deliberately not an eighth canonical non-closable surface), `preview/PreviewPanel.vue`,
  which consumes the published `@deviltea/widget-inspector` client/agent boundary for Inspect mode through its public subpaths only (never a root entry or an internal module). The Preview Runtime, Vue
  renderer tree and `InspectorAgent` live in an isolated iframe realm (`preview-frame.html` ->
  `src/preview-frame-main.ts`); the parent owns only the iframe element, the remote `InspectorClient`, and
  the `src/preview-host/` machinery (`coordinator.ts` serializes Preview promotions, `frame-driver.ts`
  boots a frame and connects over a transferred `MessagePort`, `client.ts`/`protocol.ts` are the
  host-command protocol, `lifecycle.ts` is the generation-aware `booting`/`ready`/`replacing`/
  `disconnected`/`error` state machine). The parent never holds a Core Runtime or frame DOM. The Agent
  owns bounded Preview DOM hit-testing, pointer suppression, an Agent-owned ShadowRoot overlay for
  highlight/badge chrome (renderer elements are never mutated; the Lab only themes it through `--widget-inspector-*` custom properties in `preview-frame.css`), and Escape cleanup, while the panel only translates scoped `WidgetRef`
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
  - `registry.ts` — the deliberately minimal `{ id, label, hidden?, system, presets, sources, docs, configSchemas }` lookup
    table (no routing, no persistence; shell-safe: it imports no renderer, see "Showcase isolation") consumed by `use-lab-store.ts`'s `switchShowcase`. Plugin-tuple
    types are erased to `WidgetSystem<AnyWidgetPluginTuple>` on purpose — consumers only need object
    identity. `docs` and `configSchemas` are what Core 0.3 no longer publishes, see "Plugin documentation and config
    schemas (Core 0.3)" below.
  - `survey/` — Interactive Survey (the default showcase), the Maker Space open-day sign-up form (a survey rendered
    from one JSON definition; five plugin types `Survey`, `SingleChoice`, `MultipleChoice`, `Numeric`,
    `ShortAnswer`; root widget `open-day`; languages `en` and `zh-TW`). `domain.ts` (pure types,
    condition evaluation, built-in messages), `config.ts` (config checkers reporting located diagnostics),
    `plugins/` (semantic plugins, unit-tested; a condition in the JSON becomes a declared dependency, so Core reports an
    evaluation cycle instead of the plugin guessing), `presets.ts` (`survey-default`, `survey-ai-draft`
    with one located diagnostic per widget, `survey-cycle`), `evaluate.ts` (the JSON-in/JSON-out
    function a backend runs), `cycle-safe-targets.ts` (test-only classification of which condition targets
    would create a cycle; the Lab has no editor operations), `renderers/` (Vue renderer components),
    `sources.ts`, `system.ts`, `test-support.ts`. The Survey tour (`tutorial/survey-script.ts`) is
    authored against `survey-default`; its `data-tutorial-target` lookup is keyed by widget id
    (`showcases/survey/tutorial-targets.ts`: the survey owns which of its elements carry a target name; the
    tutorial, which is host glue, only reads those attributes), `messages.ts` (the renderers' own
    locale-selected text).
  - `trip-budget/` — Trip budget splitter (issue #230, showcase 1), the Lisbon weekend: five plugin types `Trip` (root
    `lisbon`, slots `settings`/`people`/`expenses`/`summary`, State `language`), `Currency`, `Person`, `Expense` and
    `Settlement`. Money is integer minor units of the base currency from `Expense.amountBase` on (`domain.ts`: `splitEqually`,
    `splitByPercent`, `settle`, `roundToStep`, the built-in en/zh-TW texts). It exists to show, with a real Runtime:
    a **Property chain across widgets** (`Currency.convert` -> `Expense.amountBase` -> `shares` -> `Person.owed`/`paid` ->
    `balance` -> `Settlement.balances` -> `transfers`, found through the root's slots by `plugins/reads.ts`);
    **read-only Methods called by Properties** (`Currency.convert` and `roundTransfer`; the second reads State
    `roundStep`, so the Properties that call it recompute when it changes); **laziness** (`Expense.breakdown` and
    `Person.ledger` are read only by `ExpenseBreakdownView.vue` / `PersonLedgerView.vue`, which exist only while a
    disclosure is open: the Runtime panel says `Never evaluated` until then, keeps the last result after the disclosure
    is closed, and cannot show who is subscribed); and **`resetState`**, which `useWidget()` does not expose, so the
    host component `TripBudgetRenderer` (`renderers/index.ts`) provides `resetWidget(id)` and `resetAll()` to the
    renderers (`renderers/reset-host.ts`). "Start over" is `TripRootRenderer.vue`'s `onStartOver()`: it calls `resetAll()` and then
    writes the `language` State back when the reset changed it, so the page keeps the language the visitor chose (the host does not). A failed dependency fails the consumer, so an expense in a currency with no
    rate fails `amountBase`, `shares`, the payer's `paid`, every person's `owed`/`balance` and the settlement (`Failed` in
    Selected widget). A consumer fails only when it calls the failing read, so every consumer checks `Expense.counted` first and an
    expense that is not counted (nobody shares it, nobody paid) is left out before its amount is read: it never takes the settlement
    down, even in a currency with no rate (`currency.unit.test.ts`). A Method called through a dependency records no failure of its own (its row says "No failure
    recorded"); the failure is on the consumers. Presets: `trip-default`, `trip-invalid` (four located diagnostics, one
    per widget, pinned by `presets.unit.test.ts`) and `trip-unsupported-currency`; there is no cycle preset (nothing reads
    the settlement). **Isolation:** it follows "Showcase isolation" below. It reads only `useShowcaseHost().theme` and `useInspectAnchor()`
    from the host contract, owns its colours as `--trip-*` custom properties (declared on the root renderer, keyed off the host theme),
    and registers its renderer loader in `preview-frame-renderers.ts` (its registry entry has none). It does not use the host
    `locale` or `useShowcaseMessages()`: the trip's language is Widget State (`Trip.language`, so the Runtime panel shows it and a
    reset restores it), like the survey's document language, and the built-in texts follow that, not the Lab's locale. Its
    renderers are tested with a plain-ref `ShowcaseHost` (`renderers/test-harness.ts`); the Lab-side zh-TW text (Examples menu
    entries and tutorial) is tested outside the showcase, in `i18n/trip-budget-messages.unit.test.ts` and
    `tutorial/trip-budget-script.unit.test.ts`, because a showcase file may not import the Lab's i18n tables. `view` is
    `{ language, base }` and the renderers look the texts up themselves (`tripText(language)`), so the Runtime panel
    shows two small values. The tutorial (`tutorial/trip-budget-script.ts`) is authored against `trip-default`; its
    `data-tutorial-target` is `trip-<widget id>` on every renderer root.
  - `quote-rules/` — Quote rules shared by browser and backend (issue #230, showcase 2), a print shop's price quote
    ("Corner Press"): six plugin types `Quote` (root `quote`, slots `items`/`rules`, no State of its own), `Item` (State
    `quantity`, `paper`; Property `line`) and four pricing rules, each its own plugin with a Property `adjustment`:
    `VolumeDiscount`, `RushSurcharge` (State `enabled`), `Delivery` (State `method`) and `SalesTax`. Money is integer minor
    units of the currency (`domain.ts`: `percentOf` rounds half-up once, on integers, with a percentage counted to two decimals; `formatMoney` takes the number of decimals from the currency through `Intl`, the quote JSON stays integers). The chain: `Item.line` -> `Quote.subtotalCents`/`totalQuantity` ->
    the three pre-tax rules' `adjustment` -> `Quote.taxableCents` -> `SalesTax.adjustment` -> `Quote.quote`, found through
    the root's slots by `plugins/reads.ts`; Core's cycle check is over members, so the root reading its children while they
    read the root is not a loop. `Quote.answers` (every State a customer set, by widget id and State name) and `Quote.quote` (the
    whole priced quote as plain JSON, language-independent: texts stay `{ en, zh-TW }` objects) are the request and the response of a
    JSON-in/JSON-out call. It exists to show, with a real Runtime:
    - **The same rules in a non-DOM context.** `evaluate.ts` (`evaluateQuote`/`evaluateQuoteJson`, no Vue, no DOM) compiles a document
      with the same `quoteSystem`, writes the answers into a fresh Runtime and reads `quote`; `quote.worker.ts` (six lines over
      `worker-protocol.ts`) runs it in a dedicated module **Web Worker** that the Preview starts (`worker-client.ts`:
      `new Worker(new URL('./quote.worker.ts', import.meta.url), { type: 'module' })`, started on the first request, restarted after an
      error, replaced by a stand-in in tests). Only JSON **text** crosses the boundary. `renderers/quote-host.ts` (the host of one
      Runtime, created by `QuoteRenderer` in `renderers/index.ts`) subscribes the root's `answers`, reads the live Runtime's outcome
      through the same `readQuoteOutcome()` the worker uses, sends `runtime.blueprint.source` and the answers, and compares the two
      outcomes as JSON text; `SameRulesPanel.vue` shows them side by side with where each ran (`document`/`window` present or not).
      `evaluate.unit.test.ts` pins that the worker's import graph holds no Vue, no `renderers/`, no host contract and no DOM global, and
      that every outcome equals a live Runtime's for the same answers (including failures). A deliberately defective backend is the
      test that the comparison can say "mismatch". The guards needed no change: the isolation guard already reads
      `new URL('<literal>', import.meta.url)` as a reference that must stay inside the showcase directory (a case for a Worker
      URL was added to `showcase-isolation.unit.test.ts`), and Vite bundles the worker as its own chunk (`worker.format: 'es'` is
      already set for the ELK worker). A frame that cannot start a Worker shows "The worker is not available" and keeps working.
    - **A schema library through Standard Schema.** Every plugin's `config.validate` and every State `validate` is a Valibot schema
      (`schemas.ts`, the only file that imports it) turned into a Core predicate by `guard()` (`standard-schema.ts`, the pattern of the
      Core guide: one diagnostic per issue with the library's own message and path, `reason: 'standard-schema'`; a Promise throws; a
      schema whose input and output types differ is a type error). `strictObject` everywhere, so a misspelt key is reported. Valibot
      (with `@valibot/to-json-schema`) was chosen over Zod for size: the quote system is part of the eager shell bundle, and Zod 4
      classic made the shared `tutorial-theme-*.js` chunk about 116 KB (raw) larger with the whole quote showcase, Valibot about 47 KB
      (`pnpm build`, measured). Both packages are declared in `allowed-packages.json` and in the pnpm catalog (the first
      extra packages a showcase declares; `showcase-isolation.unit.test.ts` pins the list). Presets: `quote-invalid` has six located
      `invalid-widget-config` diagnostics in five widgets whose text is Valibot's, verbatim (pinned in `evaluate.unit.test.ts` and
      `e2e/quote-rules.spec.ts`). A paper an Item does not list is State, not config, so it is a plugin diagnostic on `Item.line`
      (`unknown-paper`) rather than a schema error.
    - **The config JSON Schema.** Each entry of `quoteConfigSchemas` is `~standard.jsonSchema.input({ target: 'draft-2020-12' })` of the
      same schema object (`jsonSchemaOf()`), with the field descriptions as `v.description(...)`. `schemas.unit.test.ts` pins its shape, that the
      showcase hands exactly it to the Lab, and what `describeField` (`lab/config-schema.ts`) makes of it: a list of tiers with Add and Remove,
      number boxes, a switch, a choice list and free `papers` keys; `e2e/quote-rules.spec.ts` drives those controls in Author >
      Structure and shows the schema in Author > Catalog. The schema says no more than the validator can express: it cannot say that
      the smallest discount tier starts at 1 (and the validator does not either, which is the next point).
    - **An isolated exception.** `VolumeDiscount` has a deliberate, commented defect (`plugins/volume-discount.ts`): it assumes the
      smallest tier starts at 1, so a total quantity below every tier makes `compute` throw a `TypeError` (it applies the tier with the largest
      `minQuantity` the quantity reaches, wherever the tier is listed). A document cannot contain
      code, so `quote-buggy-rule` is a *valid* document whose tiers start at 100 (flyers 120 + poster 2 = 122 pieces), which prices
      fine until a customer lowers the quantity. Core then isolates the exception: the write succeeds, the other subscribers are
      notified, one report per cached exception reaches `setIsolatedErrorHandler`. The host installs a handler while the page lives and
      restores the one it replaced (the Lab frame installs none); the handler receives only the exception, so the host finds the
      widget by reading the members again, **in dependency order** (items, the rules that read the items' totals, then the tax:
      `findThrowingMember`), because a Property that reads one that threw rethrows the very same object, so the first member that
      throws it is the origin, whatever order the `rules` slot lists the rules in. It lists it once, with how many times Core handed
      it over (one per subscription that first read the cached exception; `IsolatedLog.vue`, `data-testid="quote-isolated"`).
      The subscription that threw is skipped, so the Vue ref does not change: the page keeps the last amounts that worked and says so
      (`quote-stale`, the page's only `role="alert"`; the rule card's `data-state="threw"` for the rule whose code threw, `"input-threw"` for one that only reads it). Renderers read Properties through `useSafeRead()` because a direct read of
      a throwing Property throws inside a render function (a document that already starts below the tier mounts with "no quote yet").
      A failed dependency read makes the rule return "not applied" instead of treating a missing quantity as 0 (which would have hit the
      defect for an unrelated reason). **Gap the Lab cannot show:** Core's inspection reports only a Property's latest *completed*
      result, so Runtime and Selected widget keep showing `volume.adjustment`'s last good value after it threw (and
      `getDiagnostics()` is empty); the exception is visible only in the Preview and, by the host, through the handler
      (`e2e/quote-rules.spec.ts` pins this, and the tour says so).
    Presets: `quote-default`, `quote-invalid`, `quote-buggy-rule` (no `rush` widget, which the tour reads to tell it from the default).
    **Isolation:** it follows "Showcase isolation" below: it reads `useShowcaseHost().locale` (its own chrome text, `messages.ts`, and
    the document's `{ en, zh-TW }` texts through `localize()`) and `.theme`, and `useInspectAnchor()`; it owns its colours as
    `--quote-*` custom properties on the root renderer; its renderer loader is in `preview-frame-renderers.ts`. Unlike the trip and the
    survey it has no language State: language is a view concern here, so the `quote` JSON stays language-independent. Announcements: the page has one `role="alert"` (the stale banner); the comparison line is not a live region, a hidden `role="status"`
    carries only the settled result (so it does not read "waiting" and "identical" on every keystroke); a refused quantity shows the library's
    message under the field (`quote-quantity-error`, `aria-invalid`, a polite live region) instead of snapping back silently. Renderers are
    tested with a plain-ref `ShowcaseHost` and an in-process stand-in for the Worker (`renderers/test-harness.ts`); the Lab-side zh-TW
    text (Examples entries, tutorial) is tested in `i18n/quote-rules-messages.unit.test.ts` and
    `tutorial/quote-rules-script.unit.test.ts`. The tutorial (`tutorial/quote-rules-script.ts`) is authored against `quote-default`;
    `data-tutorial-target` is `quote-<widget id>` on every renderer root, plus `quote-same-rules` and `quote-isolated` for the panels.
    Known limits: the ids of the items and rules are object keys inside `registerDeps`, so integer-like ids would sort first (as in
    the trip); one Worker per Preview, no caching of the Blueprint (the evaluation is stateless, as in `survey/evaluate.ts`).
  - `onboarding/` — Onboarding wizard with an Events log (issue #230, showcase 3), a new-member onboarding for a community
    workshop ("Tidepool Makers"): five plugin types `Onboarding` (root `onboarding`, slot `steps`, State `current` and `finished`),
    `AccountStep`, `InterestsStep`, `SafetyStep` and `InductionStep` (every step has the same four Properties `title`, `missing`,
    `complete` and `answers`, which is all the root reads, through `plugins/reads.ts`; the step ids come from the Blueprint, never from the
    document's text). It exists to show, with a real Runtime: **declared and emitted Events** (`Onboarding`: `stepChanged`, `completed`;
    `InductionStep`: `slotRequested`, `slotConfirmed`, `slotDeclined`, `slotCancelled`, each with an object payload, emitted from a Method
    that lists it in `emits`); a **host listener** (`renderers/onboarding-host.ts`, created per Runtime by `OnboardingRenderer` in
    `renderers/index.ts` and provided through `OnboardingHostKey`); **async work kept at the host** (see below); **Method argument validation**
    (`goTo` and `requestSlot` use `validateArgs`, which sees only the arguments and the config, so `invalid-method-arguments` is about the shape
    and the config (the offered days and times); the checks that need the Blueprint or another widget, `no-such-step`, `step-locked`,
    `booking-in-progress`, are in `execute` and are `invalid-method-result`); **Method failures** (a refused move writes and emits nothing; its
    diagnostic is the Method's latest failure, listed by the Events tab and shown on the Method's row in Selected widget/Runtime, and the next
    successful call replaces it); and **read-only versus writing Methods** (`Onboarding.canEnter` is read-only, `goTo` and `next` call it, so both apply the same locking rule (`step-locked`), every other
    Method writes State and emits, so Relations marks them W and E; `plugins/wizard.unit.test.ts` pins the derived flags with
    `inspectBlueprint`). Core's code for a failed `validateArgs` is `invalid-method-arguments`. Presets: `onboarding-default`,
    `onboarding-ready-to-book` (`startStep: 3` with the first three steps prefilled), `onboarding-deep-link` (`startStep: 3`, nothing filled in)
    and `onboarding-invalid` (four located diagnostics, pinned by `presets.unit.test.ts`).
    - **The booking (async work at the host).** Core is synchronous: a Method cannot await, a returned Promise is a contract violation and the
      `emit` and `deps` callables of a callback stop working when it returns (`plugins/induction.unit.test.ts` pins that a retained `emit` throws).
      `requestSlot` therefore writes `status: 'requesting'`, a new `ticket`, the slot, and emits `slotRequested({ ticket, date, time })`, and
      returns at once. The host (`onboarding-host.ts`) asks the simulated office (`booking-office.ts`: the answer is a pure function of the slot,
      17:00 is always declined, the wait is a `Scheduler` that the Preview fills with `setTimeout` and the unit tests fire by hand) and calls
      `settleBooking(ticket, outcome)`; the Method applies the answer only while `status` is `requesting` and the ticket is the current one, otherwise
      it returns `false` and changes and emits nothing (Core's "Async work" guide: the ticket is the guard for work that cannot be cancelled).
      `cancelBooking` emits `slotCancelled`; a host that can recall work (the office desk's "recall" switch, on by default) clears the timer. "Hold" keeps
      the office from answering until the visitor lets it, which is how the e2e suite controls the timing without sleeping. Unmount and Runtime
      disposal cancel every pending request (`runtime.subscribeDisposal`), and `resetAll()` forgets the requests in flight before `runtime.resetState()`
      puts the tickets back to 0. The two switches are host settings, not widget State: the office is outside Core.
    - **Isolation:** it follows "Showcase isolation" below. It reads `useShowcaseHost().locale` and `.theme` and `useInspectAnchor()`, owns its colours
      as `--onboarding-*` custom properties on the root renderer and registers its renderer loader in `preview-frame-renderers.ts`. Its own chrome text
      is `messages.ts` (en and zh-TW); the wizard's text is the document's `{ en, zh-TW }` objects. The page explains a refusal in the viewer's language
      from the diagnostic's machine-readable `reason` (`PROBLEM_MESSAGE_KEYS`) and shows the Core `code` and `reason` untranslated; the diagnostic
      `message` stays English and is what the Lab's panels show. No `allowed-packages.json`: it needs only Vue and Widget.
    - **Announcements:** the page has one `role="alert"` at a time. `renderers/problem-board.ts` is the one place a refused call is shown: the root
      renderer owns the board and every renderer reports the Method's latest diagnostic to it after a call (`reportCall`); a successful move clears it.
      The booking status is the page's one `role="status"` (it changes only when the host settles), the activity list and the office desk are plain
      lists, and no `aria-live` is used. When the host hears `stepChanged` the root moves focus to the entered step's heading (each step's `h2` has
      `tabindex="-1"`); the buttons that call refused Methods are not disabled, so the Method's own refusal is what the visitor sees.
    - **Tests:** plugins and the host are tested against real Runtimes (`plugins/wizard.unit.test.ts`, `plugins/induction.unit.test.ts`,
      `renderers/onboarding-host.unit.test.ts`), renderers with a plain-ref `ShowcaseHost` and a hand-fired scheduler (`renderers/test-harness.ts`,
      `renderers/onboarding-renderers.unit.test.ts`), and `e2e/onboarding.spec.ts` drives the real Lab. The Lab-side zh-TW text is in
      `i18n/onboarding-messages.unit.test.ts` and `tutorial/onboarding-script.unit.test.ts`; `lab/config-schema.onboarding.unit.test.ts` pins
      what the Structure editor makes of the config schemas. The tutorial (`tutorial/onboarding-script.ts`) is authored against `onboarding-default`; its
      `data-tutorial-target` is `onboarding-<widget id>` on every renderer root, plus `onboarding-steps`, `-actions`, `-jump`, `-problem`,
      `-induction-status`, `-office` and `-host-activity`. Property predicates see only State and already-evaluated Properties, never a Method
      diagnostic or an Event, so the steps whose "do" leaves no State behind (a refused Next, a bad step number) are narrated, and the two that load a
      preset are gated on the State that preset starts in.
    - Known limits: the Lab's Events log lists a Method failure when the Method's latest diagnostic snapshot becomes non-empty, and Core keeps only
      the latest snapshot, so it is a fact about the latest call, not a call log; Event arguments are typed by TypeScript only, Core validates no payload
      at run time; `validateArgs` cannot see the Blueprint, hence `goTo`'s range check is an `invalid-method-result`; the root keys the step dependencies by
      step id (`plugins/reads.ts`) and looks them up in the Blueprint's order (`stepChildren`), because a dependency container may hold only dependency
      expressions (a plain id string in it throws), and an object would sort an integer-like id first. Once the wizard is finished
      `requestSlot` and `cancelBooking` are refused (`already-finished`): the booking is part of what was completed; Start over (`resetState`) reopens it.
  - `document-repair/` — Legacy document repair (issue #230, showcase 4), the notice board app that opens drafts older versions saved.
    **Migration and repair are the application's policy, written in the showcase's own domain code: Core does not migrate, version, repair
    or quarantine anything, and nothing is persisted** (the drafts are in-memory fixtures in `fixtures.ts`; the Lab shell gains no
    persistence or migration, see "Package boundaries"). There are two Systems in the directory. The **outer** `repairSystem` (`system.ts`) is
    the one the Lab registers, so it is the Lab Document: `RepairDesk` (root `desk`, config `appVersion`, slot `drafts`) and `SavedDraft`
    (config `title`, `savedWith` `1.x`/`2.x`/`3.x` and `source`, any JSON: the stored legacy document, kept exactly as saved; Properties `title`,
    `savedWith`, `source`, `findings` and `plan`; State `revision`, `appRevision` and `repaired`, written by the host to mirror its session, `-1` and
    `false` while none is open). The **inner** `boardSystem` (`board/`, not registered as a showcase) is the app's document format v3: `Board`
    (root, config `title` per language, slot `notices`) and `Notice` (config `title`, `body`, `until` as a `YYYY-MM-DD` date, `tone` `info`/`warning`).
    It exists to show, with a real Runtime and real Documents:
    - **What Core says about a stored document.** `SavedDraft.findings` (`plugins/findings.ts`) compiles `source` with the inner system inside
      the Property's `compute` (an ordinary synchronous call: `createBlueprint` is not a Runtime callback, and `plugins/saved-draft.unit.test.ts`
      pins that Core accepts it) and projects plain JSON: `status`, `sourceJsonCompatible`, the diagnostics as `{ code, message, sourcePath,
      reason? }` (`sourcePath` is `blueprint.getSourcePath(location.node)`, or the diagnostic's own path for a source-level one such as
      `json-incompatible-value`) and a node summary from `inspectBlueprint(...).nodes[]` (resolved or unresolved with the authored `id` and `type`
      as hints, and `sourceSlots` placements: an undeclared slot is `raw-slot`).
    - **The application's plan.** `planRepair(source, savedWith)` (`domain.ts`, pure, never throws) returns ordered steps `{ id, title, why, patch }`
      (`title` and `why` are `{ en, zh-TW }`), each patch applying to the source as it is after the steps before it and starting with `test`
      guards for the value it was planned against (a guard that no longer holds fails the whole step atomically: `test-failed` with the
      `operationIndex`). `1.x`: `rename-slot` (`items` to `notices`, a raw-slot placement), `rename-type` (`Banner` to `Notice`, an unresolved node
      with hints), `rename-config-text` (`text` to `body`), `move-style` (a widget-level `style` is `unexpected-widget-field`; it moves into `meta.style`,
      which Core preserves and never interprets), `fix-duplicate-ids` (`duplicate-widget-id`) and `rewrite-no-id` (a node without an `id` is unresolved and
      nothing addresses it, so the whole array element is replaced: the repair floor); `1.x` and `2.x`: `convert-until` (an epoch-milliseconds
      `until` is a config diagnostic); `3.x`: no step. The `draft-poll` fixture (saved with `2.x`) has a `Poll` the application has no rule for: after its
      one step it is still invalid and Core creates no Runtime for it (all-or-nothing validity, no quarantine, no partial Runtime).
    - **The editing session at the host** (`renderers/repair-host.ts`, created per desk Runtime by `DocumentRepairRenderer` in `renderers/index.ts` and provided
      through `RepairHostKey`). "Open in the app" is `createWidgetDocument({ system: boardSystem, source: structuredClone(stored) })` (Core never mutates a source,
      since `applyPatch` is copy-on-write, but it retains the object it is given by reference as revision 0 and every later revision shares its untouched parts. The
      stored draft is the application's own model and may keep being edited, and an object changed after it was handed to Core corrupts every revision, so the host
      hands over a copy and the two share nothing; `renderers/repair-host.unit.test.ts` mutates the stored object after `open()` and asserts that the document and the plan
      do not move, and that test fails without the `structuredClone`). The plan is computed from the snapshot the app last read (`appRevision`); "Apply next step" is
      `applyPatch(step.patch, { expectedRevision: appRevision })`, shown as `{ ok, changed }` or as `failure.code` with `operationIndex` (a `changed: false` no-op leaves the
      revision alone and notifies nobody); a document listener logs every commit `(snapshot, { previous, patch })` (previous to new revision, number of
      operations, who saved it) and is read after `applyPatch` returns, never from inside the listener. "Another editor saves" applies a small valid edit
      (the board title) without an expected revision and without the app reading it, so the app's next step meets `document-revision-conflict` with
      `expectedRevision` and `actualRevision` and applies nothing; "Re-read and re-plan" reads the current snapshot and plans from it. When the document is valid,
      "Preview the repaired board" creates a Runtime from the valid Blueprint (an invalid one has no `createRuntime`) and renders it with the inner
      system's plain components (`renderers/board/`, a nested `@deviltea/widget-vue` root), and "Export" shows the repaired JSON text. Sessions and preview Runtimes
      are released on close, on "Close every draft" (`resetAll`), on unmount and on dispose of the host, and the host is a no-op once the desk's Runtime is disposed.
    - **Isolation:** it follows "Showcase isolation" below. It reads `useShowcaseHost().locale` and `.theme` and `useInspectAnchor()` (on `RepairDesk` and every
      `SavedDraft` renderer; the inner board renderers stamp none, because their widgets belong to the preview Runtime and not to the Runtime the Lab inspects, and
      a pointer on the board selects the draft that contains it), owns its colours as `--repair-*` custom properties on the root renderer and registers its renderer
      loader in `preview-frame-renderers.ts`. Its own chrome text is `messages.ts` (en and zh-TW); the plan's titles and reasons are `{ en, zh-TW }` in `domain.ts`, and the
      drafts' board content is the stored document's own text. The page explains a refused patch in the viewer's language from Core's failure `code`
      (`ALERT_MESSAGE_KEYS`) and shows the `code`, the operation index and Core's English `message` untranslated. No `allowed-packages.json`: it needs only Vue and Widget.
    - **Announcements:** one `role="alert"` at a time (the latest refused patch, owned by the host and shown by the root renderer; a success or a re-read clears it)
      and one `role="status"` (what the last action did); buttons are at least 24px high with a visible focus ring; no `aria-live` is used. Focus is moved by hand
      when a control removes or disables itself (`renderers/focus.ts`, the pattern of the onboarding showcase): opening a draft focuses the session heading and closing it
      focuses "Open in the app", applying the last step focuses "Preview the repaired board" (or "Re-read and re-plan" while the document stays invalid) and closing the
      preview focuses the button that opened it. The headings never skip a level: the desk title `h1`, "Saved drafts" `h2`, a draft `h3`, its session `h4`, a session block `h5`
      and the preview board's title `h6`.
    - **Tests:** the plan against real Core (`domain.unit.test.ts`: every step applies to its fixture, v1 and v2 end valid, v3 has no step, the poll draft stays invalid,
      guards fail atomically), the Properties against real Runtimes (`plugins/saved-draft.unit.test.ts`), the host against real Documents
      (`renderers/repair-host.unit.test.ts`), renderers with a plain-ref `ShowcaseHost` (`renderers/test-harness.ts`, `renderers/repair-renderers.unit.test.ts`), `presets.unit.test.ts`
      and `e2e/document-repair.spec.ts`. The Lab-side zh-TW text is in `i18n/document-repair-messages.unit.test.ts` and `tutorial/document-repair-script.unit.test.ts`.
      Presets: `repair-default` (drafts `draft-v1`, `draft-v2`, `draft-v3` and `draft-poll`) and `repair-invalid` (four located `invalid-widget-config` diagnostics in the OUTER
      document: an `appVersion` that is not a version, a draft without `source`, an unknown `savedWith` and a draft without a title; pinned by `presets.unit.test.ts`).
      The tutorial (`tutorial/document-repair-script.ts`) is authored against `repair-default`; its `data-tutorial-target` is `repair-<widget id>` on every renderer root, plus
      `repair-plan`, `-diagnostics`, `-log`, `-result`, `-preview` and `-alert`. It is gated on the State the host mirrors (open the draft, apply a step, the app falls behind, the app
      catches up, the document is valid, the poll draft took its step); the steps whose "do" leaves nothing behind (reading the plan, previewing) are narrated.
    - Known limits: nothing is persisted and nothing is migrated by Core, by design; the stored drafts are fixtures, so the Lab's own Apply on the desk replaces the desk (and
      its sessions), not a stored document; the plan is one fixed policy, so a stored shape outside it is not repaired; `fix-duplicate-ids` keeps the first node and renames the later ones;
      "Another editor" is simulated by the host, in the same realm, not by a second client; structured `'-'` append is not used and widgets are never patched by id (the paths are structural: `planRepair`
      builds them from its own walk of the source, and `domain.unit.test.ts` checks that they agree with `blueprint.getSourcePath` of the nodes Core reports); a source that is not JSON
      gets no plan, because Core would refuse every operand with `json-incompatible-value`, and a legacy notice without a `config` is replaced without one (the app does not invent
      content), so it stays invalid.
  - `renderer-packs/` — One document, two renderer packs (issue #230, showcase 5), a small "workspace settings" page: **one Document and one Runtime drawn by two renderer
    packs**, hand-written controls and a component library (Nuxt UI), one at a time or side by side. Eight plugin types in one System (`system.ts`): `SettingsPage` (root
    `settings`, config `title`, slots `providers` and `sections`; Property `appearance` is the `mode` and `density` of the first Appearance in its `providers` slot), the capability
    widgets `Appearance` (State `density` `comfortable`/`compact`, State `mode` `auto`/`light`/`dark`, where `auto` means the host theme) and `Notifier` (State `items`; Methods
    `notify(message, tone)`, which writes State and emits `notified`, and `dismiss(id)`; Properties `alert` and `status`), `Section` (config `title`, `description`, slot `fields`) and the
    fields `TextField` (State `value`, Property `message`: the plugin's validation message in both languages), `Toggle` (State `on`), `Choice` (State `value`, refused unless it is an
    option) and `DangerAction` (State `confirming`; Methods `ask()`, `cancel()` and `confirm()`, which invokes the Notifier's `notify`, closes the question and emits `confirmed`).
    Business rules (`textProblem`, `appendNotification`, `announcementsOf`, `resolveScheme`) are in `domain.ts`, never in a renderer. It exists to show, with a real Runtime:
    - **A renderer pack is a host-level choice.** `renderers/packs-host.ts` (`PacksHost`, created per Runtime by the page in `renderers/page.ts` and provided to both packs) holds the choice
      (`hand`, `nui` or `both`); it is not widget State (the Runtime panel does not show it) and switching mounts the other pack's renderers over the same Runtime, which is never disposed,
      so what was typed in one pack is in the other (`e2e/renderer-packs.spec.ts`, `renderers/pack-switching.unit.test.ts`). A new Runtime (Apply) gets a new host and the default pack
      again. Both packs register a renderer for every plugin type of the same System (`renderers/handwritten/index.ts`, `renderers/nuxt-ui/index.ts`, each exhaustive by construction) and
      both stamp `useInspectAnchor()` and a `packs-<widget id>` tutorial target on every renderer root.
    - **Named providers, no provider shadowing** (`DevilTea/widget#3`). Core has no nearest-ancestor lookup, so `Appearance` and `Notifier` are ordinary widgets that others name: a field
      has `config.appearance` and reads the Appearance's State `density` through `dep.widget(id)` (its Property `density`), and a `DangerAction` has `config.notifier` and `confirm()` invokes
      `notify` through a declared `dep.widget(id)` Method dependency. A name that matches no widget, or one of the wrong type, is a located `invalid-widget-structure` diagnostic
      (`plugins/structure.ts`: `unknown-appearance`, `not-an-appearance`, `unknown-notifier`, `not-a-notifier`; skipped for a widget whose config already failed, so one mistake is one
      diagnostic) and the dependency is only declared for a provider that exists. Relations marks `ask` and `cancel` W and `confirm` W and E.
    - **The Nuxt UI pack runs its own Nuxt UI instance in the frame.** `renderers/nuxt-ui/NuxtUiPack.ts` owns an element and `nested-app.ts` mounts a nested Vue app into it (`createApp`, once
      per mount, unmounted on unmount or pack switch, counted by `liveNuxtUiApps()`/`createdNuxtUiApps()` for the tests): it installs `@nuxt/ui/vue-plugin`, wraps the pack in `UApp` with
      `portal` set to `[data-packs-portal]`, an empty element `NuiSettingsPage.vue` renders inside the pack's root, so every overlay (`UModal`, the `USelect` menu) is teleported inside the
      pack, never to the frame's `<body>`; it provides the `ShowcaseHost` and the `PacksHost` it injected from its parent, renders the pack with the same Runtime, sets its own
      `app.config.idPrefix` (two Vue apps in one document would both hand out `v-0`, `v-1`...: the duplicate ids broke every `<label for>`, found by the e2e label check) and installs the plugin inside a
      detached `effectScope()` that `unmount()` stops: the plugin's generated colour block (`<style id="nuxt-ui-colors">`) is an `unhead` `useHead` entry, which is tied to the component being set up or else
      to the current effect scope, and to nothing when neither exists, so an app mounted from a timer or after an `await` would leave the `<style>` and its `watchEffect` behind on every pack
      switch (`nested-app.unit.test.ts` mounts outside any component and asserts the head is empty after unmount; the unhead 3.4 head has no `dispose`, so there is no hook to call). Icons are the build-time bundle (`icon.clientBundle.scan` already covers `src/**`)
      and `renderers/nuxt-ui/offline-icons.ts` is that approach's copy (a showcase may not import `src/ui/`): no Iconify fetch. The stylesheet `renderers/nuxt-ui/packs-ui.css` is the
      showcase's own Tailwind v4 entry: `tailwindcss/theme.css` and `utilities.css` with `source(none)` plus one `@source` of the pack's directory, `@import "@nuxt/ui"`, a preflight
      scoped to `.packs-ui` (a global preflight would restyle the hand-written pack next to it), and the pack's own `--ui-*` values on `.packs-ui` (light) and `.packs-ui.dark` (dark; a class
      of the pack's root only, driven by `Appearance.mode`, with `auto` following the host theme, never on the frame `<html>`). Only `nested-app.ts` imports it, so it is part of the lazy chunk
      of this pack: the default frame (hand-written) loads no Tailwind and no Nuxt UI CSS. **The frame document outlives the showcase** (the frame driver reuses it across showcase switches) and Vite's
      preload helper adds a lazy chunk's stylesheet `<link>` once and never again, so the stylesheet would stay and Tailwind utilities, `:root` Nuxt UI tokens and Nuxt UI's base rules (`color-scheme`,
      a focus rule on `a`) would reach the hand-written pack and every other showcase. Removing the link is not enough either (the helper remembers it and would not add it back), so
      `renderers/nuxt-ui/pack-styles.ts` owns the element, by reference counting (packs are switched faster than a stylesheet loads): `NuxtUiPack.ts` calls `acquirePackStyles()` when it mounts
      and `releasePackStyles()` when it unmounts, once each; an acquire puts the same element back and returns a promise for its load (the first mount, and a mount while nothing is pending, mounts at
      once; one that comes while another pack's restore is loading waits for that load), and only the release that brings the count to zero takes the element out and keeps it, so a pack switched
      away before the stylesheet loaded neither takes it from the pack that replaced it nor leaves it in the frame. The element is found by its content, the marker rule `.packs-ui-pack-marker` of
      `packs-ui.css` (not its last rule: Tailwind appends `@property` and `@keyframes` after it, so the finder reads the whole list; `shell-isolation.unit.test.ts` checks the marker survives the
      build), and an element the module put back is remembered, so it is found again before it has loaded. It is a `<link>` in a build; the dev server's `<style data-vite-dev-id>` belongs to Vite's
      HMR (`removeStyle` throws when its element is not in the head), so it is left alone and **in dev the pack's CSS stays in the frame** after the pack is gone. The alternative, discarding the frame when a showcase that loaded the pack is left, would need a shell protocol
      change for one showcase. `e2e/nuxt-ui.spec.ts` pins it: Nuxt UI, then another showcase, then `expectFrameIsolated`; and Nuxt UI, hand-written, Nuxt UI again, hand-written.
    - **Lazy chunks.** `renderers/index.ts` is a thin facade (`loadRendererPacksRenderer()`, called by `preview-frame-renderers.ts`) behind which `renderers/page.ts` (the page, the hand-written
      pack, what the packs share) and, behind that, `NuxtUiPack.ts` are lazy chunks. The facade exists because the pack shares modules with the page: the bundler puts them in the parent
      chunk and the child imports them from there, so the parent chunk stops being the chunk of its entry module and the shell-isolation guard (which finds a renderer's chunk by its entry in the
      build manifest) cannot tell it from a shared helper. `shell-isolation.unit.test.ts` now also follows the lazy chunks behind a renderer entry (`lazyClosure`), so the stylesheet of a nested
      pack is covered too. A page chunk that fails to load is the loader's failure (`discardFrame`, like any renderer); a Nuxt UI chunk that fails leaves a message in its pane and the hand-written pack working (`renderers/pack-load-failure.unit.test.ts`).
    - **Announcements and accessibility.** The page has one `role="alert"` (the Notifier's newest `danger` notification) and one `role="status"` (the newest of any other tone), kept by the
      first visible pack only (`PacksHost.isLive`), so side by side there are still one of each; an empty status region stays in the accessibility tree. The confirmation of an action is drawn by
      the pack whose button asked (`noteAsker`/`ownsDialog`), the other pane says "the confirmation is open in the other pane". The hand-written pack uses a native `<dialog>.showModal()`
      (Esc and the close event are `cancel()`), the Nuxt UI pack a `UModal`: both are inside the Preview frame document, so the Lab shell stays operable while one is open (a Preview-local modal,
      `DevilTea/widget#5`; nothing in the Lab is made `inert`) and focus is handled inside it (`e2e/renderer-packs.spec.ts` measures both). Expected focus behaviour, per modal: the `UModal` (Reka's focus scope) wraps, Tab on its last control goes to the first (the close button) and Shift+Tab on the first to the last, and focus never leaves it; for the native `<dialog>` in the iframe everything else in the frame document is inert, so Tab on its last control and Shift+Tab on its first never land on the page behind it, but may leave the frame document to the Lab shell (the browser's behaviour for any iframe), which the test allows. Controls are at least 24px by their own box or their
      label, with a visible focus ring.
    - **Isolation:** it follows "Showcase isolation" below and is the second showcase with an `allowed-packages.json` (`@iconify/vue`, `@nuxt/ui`, `tailwindcss`, pinned in
      `showcase-isolation.unit.test.ts`). It reads `useShowcaseHost().locale` and `.theme` and `useInspectAnchor()`, owns its colours as `--packs-*` custom properties (on the page frame,
      keyed off the host theme, and on the hand-written pack's root, keyed off the Appearance's resolved scheme) and `--ui-*` on the Nuxt UI pack's root, and registers its renderer loader in
      `preview-frame-renderers.ts`. The page's own text is `messages.ts` (en and zh-TW); labels, titles, options, confirmation questions and notifications are the document's `{ en, zh-TW }`
      objects, and a validation message is the plugin's. `e2e/nuxt-ui.spec.ts` asserts the frame the other way round for this showcase (no Tailwind or Nuxt UI CSS until the Nuxt UI pack is
      chosen, then none of the chrome's `--ui-*` to Lab palette mapping, no `dark` class on `<html>`).
    - **Tests:** the plugins against real Runtimes (`plugins/settings.unit.test.ts`: provider reads, `confirm` invoking the Notifier, Events, refusals and their diagnostics, derived W/E),
      `domain.unit.test.ts`, `config.unit.test.ts`, `presets.unit.test.ts`, both packs' renderers with a plain-ref `ShowcaseHost` (`renderers/hand-renderers.unit.test.ts`, and
      `renderers/nui-renderers.unit.test.ts` with the harness's own `UApp` and plugin: `src/test-support-ui.ts` is the chrome's and a showcase may not import it),
      `renderers/pack-switching.unit.test.ts` (one Runtime, the nested app created once and unmounted, overlays inside the pack's root, `dark` on the pack's root only, no duplicate ids,
      side by side) and `e2e/renderer-packs.spec.ts`. The Lab-side zh-TW text is in `i18n/renderer-packs-messages.unit.test.ts` and `tutorial/renderer-packs-script.unit.test.ts`.
      Presets: `packs-default` and `packs-invalid` (four located diagnostics: a text field with a `maxLength` of 0, a field whose `appearance` names no widget, a field whose `appearance` names
      a Notifier, and a DangerAction whose `notifier` names no widget; pinned by `presets.unit.test.ts`). The tutorial (`tutorial/renderer-packs-script.ts`) is authored against `packs-default`;
      its `data-tutorial-target` is `packs-<widget id>` on every renderer root of both packs, plus `packs-chooser`. It is gated on the State the visitor's action leaves (the box's value, the
      density, the mode, `confirming`, the Notifier's items); the pack choice is the host's, not State, so the step about it is narrated.
    - Known limits: the pack choice is not kept when Apply replaces the Runtime (a new host); a `Notifier` keeps at most `limit` notifications and only the newest alert and status are drawn
      (older ones are State, visible in Runtime); both packs draw the confirmation of an action from one State, so which pane draws it is a host rule (the pane that asked); the Nuxt UI pack
      has no axe check of its own (only target size, labels and focus are asserted); the generated colour block of Nuxt UI (`--ui-color-*` on `:root`) does
      reach the frame document while the pack is mounted, which the isolation spec accepts and asserts has none of the chrome's mapping.
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
- `src/styles/lab-tokens.css` — the Lab palette tokens (`--lab-color-*`, `--lab-radius`, `--lab-font-*`; dark on `:root`,
  light under `html[data-lab-theme='light']`), shared by the two documents that are the Lab's own: the shell and the Preview
  frame document (its background, text, tutorial spotlight and Inspect overlay, all host glue). Referenced by
  `src/styles/dockview-theme.css`, Monaco's styling and, through the theme bridge in `lab-ui.css`, by the chrome's Tailwind
  utilities. The success/OK colour is the single token `--lab-color-ok` in both themes; do not
  add a second name for it (audit U17: `--lab-color-success` existed only in dark, `--lab-color-ok` only in light).
  Showcases never read these tokens (see "Showcase isolation").
- `src/styles/global.css` — the baseline of the Lab SHELL document only (`main.ts`): it imports `lab-tokens.css` and adds
  box-sizing, the document font/colour, native dialog colour and the narrow-viewport overflow rule. The Preview frame does
  not import it.
- `nuxt-ui.ts`, `src/styles/lab-ui.css`, `src/composables/use-nuxt-ui-theme-bridge.ts`, `src/ui/offline-icons.ts`,
  `src/test-support-ui.ts`, `src/test-setup.ts`, `scripts/nuxt-ui-codegen.mjs` — the Nuxt UI + Tailwind v4 foundation, see "Nuxt UI
  and Tailwind" below. The Lab shell (`index.html` -> `main.ts`) uses it; the Preview frame never does.
- `src/styles/preview-frame.css` — the Preview frame document's own stylesheet (imported by
  `preview-frame-main.ts` after `lab-tokens.css`, never by the shell): the document baseline (box-sizing, the background,
  colour, font family and size a showcase inherits, and the `--widget-inspector-*` theme of the Inspect overlay) and the
  base layer: line-height 1.5, controls inheriting the surrounding font,
  square text inputs and pointer cursors, i.e. the subset of the removed Vuetify reset the survey renderers
  were styled against. It sits in a layer of its own, below every unlayered rule (the renderers' scoped
  styles), like a reset; the survey's native controls also carry their colour, size and weight inline (see
  `showcases/survey/renderers/control-style.ts`). Do not move these rules into `global.css`: the Lab chrome
  keeps the UA defaults.
- Styling, in one place: the **chrome** (everything outside the Preview frame) is Tailwind v4 utilities and Nuxt
  UI components, in the `class` attribute of the template; the **showcase renderers** (everything inside the
  frame) are plain CSS, a `<style scoped>` block per renderer, with no Tailwind class and no import from the
  chrome. PikaCSS is gone from the repository: no `pika()`, no plugin, no generated `pika.gen.*`. See
  "Nuxt UI and Tailwind" below and `src/styles/styling-boundary.unit.test.ts`.
- `src/**/*.unit.test.ts` — colocated Vitest unit tests for `src/lab/`, `src/graph/`,
  `src/runtime-inspector/`, `src/sandbox/`, `src/composables/` and `src/showcases/**` (plugins,
  presets, and selected renderer contracts via `@vue/test-utils` + `happy-dom`), run by both this
  app's own `vitest.config.ts` and the root config.

## Commands

```bash
pnpm dev         # vite dev server
pnpm build       # vite build
pnpm typecheck   # generates the Nuxt UI theme templates, then vue-tsc over app, unit tests, and browser/Page specs
pnpm test        # vitest run for this app's colocated *.unit.test.ts
```

`vite.config.ts`/`vitest.config.ts`/`nuxt-ui.ts`/`widget-docs.ts` and Playwright config files themselves are not
part of `pnpm typecheck`'s program, matching every other package in this repo (none type-check their
own bundler config files). Browser/Page specs under `e2e/` and `e2e-pages/` are typechecked through
`tsconfig.browser-tests.json`, including the preset fixtures they import (`src/sandbox/presets.ts` and
`src/showcases/survey/presets.ts`), while the two
Playwright suites remain separate runtime jobs.
`pnpm typecheck` first runs `nuxt-ui:codegen` (`scripts/nuxt-ui-codegen.mjs`), which writes the Nuxt UI theme types
that Vite would otherwise only produce as a side effect of a dev/build pass, so it is correct on a clean checkout
without a prior dev/build run, see "Nuxt UI and Tailwind". No other file is generated.

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
main app JS (lab-*.js + the chunk it shares with the frame, tutorial-theme-*.js) ~1139 KB + ~522 KB raw / ~305 KB + ~160 KB gzip — eager
                                         (the figures of this entry and of the Quote Web Worker were re-measured with `pnpm build` at the quote-rules commit; the older
                                         ~847 KB + ~288 KB and ~230 KB + ~94 KB had gone stale before that commit, so the difference to them is not
                                         this showcase's. Its own share is the shared chunk only: ~362 KB / ~116 KB gzip on main without it, ~410 KB /
                                         ~128 KB with it, about +48 KB / +12 KB (Valibot, its JSON Schema converter, the six plugins and the presets);
                                         lab-*.js is the same 1126.86 KB both ways. Zod 4 classic instead of Valibot measured +116 KB raw.
                                         Re-measured with `pnpm build` at the document-repair commit: the shared chunk was ~500 KB / ~154 KB gzip without that showcase and
                                         ~522 KB / ~160 KB with it, about +22 KB / +6 KB (the two Systems, their plugins, `planRepair`, the fixtures and presets;
                                         the renderers are lazy); lab-*.js is 1139.16 KB both ways. The ~410 KB above had already drifted before it)
                                         Re-measured with `pnpm build` at the renderer-packs commit (without the showcase: 1139.16 KB + 522.48 KB raw / 303.6 KB + 159.0 KB gzip):
                                         lab-*.js 893.24 KB / 228.2 KB gzip, Switch-*.js 251.85 KB / 78.7 KB (the Nuxt UI runtime, which the shell and the lazy Nuxt UI pack
                                         now share, so the bundler split it out of lab-*.js and the shell loads it with it) and the shared tutorial-theme-*.js 576.01 KB / 173.4 KB.
                                         Eager total +5.9 KB raw / +3.3 KB gzip for lab-*.js and Switch-*.js together, and +53.5 KB raw / +14.4 KB gzip for the shared chunk (the eight
                                         plugins, config checkers, schemas, domain, presets, sources thunks, the tour and the zh-TW text); no renderer is in it. Lab CSS is unchanged (342.5 KB / 39.7 KB)
Nuxt UI Toast (Toast-*.js)               ~30 KB raw / ~9 KB gzip   — loaded on first toast (none is shown yet)
Renderer packs page (page-*.js + page-*.css)
                                         ~16.2 KB raw / ~5.8 KB gzip JS + ~9.1 KB / ~1.8 KB CSS — loaded when the showcase's Preview mounts (the page frame and the
                                         hand-written pack; a 0.7 KB facade `index-*.js` and a 2.1 KB chunk sit next to it)
Renderer packs Nuxt UI pack (NuxtUiPack-*.js + NuxtUiPack-*.css)
                                         ~100.1 KB raw / ~23.9 KB gzip JS + ~197.7 KB / ~25.3 KB CSS — loaded the first time the Nuxt UI pack is chosen (its own
                                         nested Vue app, the eight Nuxt UI renderers, Tailwind utilities and the Nuxt UI component themes); the default frame never loads it
modern-monaco/core package JS (core-*.js) ~763 KB raw / ~275 KB gzip — loaded when Author JSON is first opened
vendored editor-core.mjs                ~7.93 MB raw / ~1.41 MB gzip — loaded when Author JSON is first opened
vendored editor-worker(-main).mjs       ~566 KB raw / ~119 KB gzip  — loaded on first Monaco worker use
ELK layout worker (layout.worker-*.js)  ~1.91 MB raw / ~465 KB gzip — loaded on first Graph layout
Implementation panel + Shiki (ImplementationPanel-*.js)
                                         ~375 KB raw / ~75 KB gzip  — loaded on first Implementation open
Quote Web Worker (quote.worker-*.js)       ~111 KB raw / ~32 KB gzip   — loaded when the quote Preview first evaluates (Core, the plugins and Valibot;
                                         no Vue, no renderer, no host contract); its own 0.8 KB chunk is the curated source of the file
curated raw-source chunks (per curated file, e.g. ShortAnswerRenderer-*.js)
                                         ~2-21 KB raw / ~1-6.2 KB gzip each — loaded on first
                                         selection of that file's tab
CSS (lab-*.css)                           ~342 KB raw / ~40 KB gzip — eager
                                         (was ~128 KB + ~9 KB / ~12 KB + ~3 KB before Nuxt UI; the Lab shell only: Tailwind utilities
                                         plus the theme of every Nuxt UI component, see "Nuxt UI and Tailwind". It holds `global.css` and the palette
                                         tokens too. No showcase renderer style is in it: the survey's scoped styles are in a separate chunk the
                                         frame loads lazily, see "Showcase isolation")
```

- **Eager**: the main app chunk and its CSS, and since the renderer-packs showcase the Nuxt UI runtime chunk `Switch-*.js` (~252 KB raw / ~79 KB gzip: Nuxt UI, Reka UI and Iconify code the shell and the lazy Nuxt UI pack share, so the bundler split it out of `lab-*.js`; it holds no chrome code and the shell preloads it with the entry) — `App.vue`, `Workbench.vue`, `LabStore`/`LabSession`,
  every panel *shell* (not necessarily every panel's heavy dependency, see below), the Survey, Trip budget, Quote rules, Onboarding, Legacy document repair and renderer-packs showcases (their systems, presets and sources, not their renderers) and the hidden Sandbox fixture,
  `dockview-vue`. This is unavoidable critical-path weight for a workbench app whose
  shell has to exist before any panel can render.
- **`modern-monaco/core` (package JS + vendored `editor-core.mjs`)**: not in the eager chunk —
  `import('modern-monaco/core')` in `use-monaco-editor.ts`'s `ensureMonaco()` is Vite's own code-split
  boundary for the package JS (the LSP-free submodule — the side-effectful main entry that
  force-enabled `useBuiltinLSP` and carried ~740 KB of unused LSP/grammar code is deliberately not
  imported anywhere), and
  `editor-core.mjs` is never in Vite's module graph at all (loaded by `modern-monaco` itself via the
  importmap-resolved dynamic `import()` described in "Deployment" above). Both are fetched **when the Author JSON view is
  first opened**: `AuthorPanel.vue` renders only the active view (`v-if`), and since Lab UX phase 1 the view Author opens on is
  Structure, not JSON. (Before, JSON was the default and Dockview mounts every canonical panel's content at load, so
  `MonacoJsonEditor` mounted, and both files were fetched, on every load whichever tab the user looked at; that was an accepted
  trade-off while JSON was the default surface.) The JSON tab, the problems chip and "Show problems" are the ways in; `e2e/shell.spec.ts` asserts no `.monaco-editor` before JSON is opened and the Pages spec asserts
  `editor-core.mjs` is requested once it is.
- **ELK layout worker**: eager on load because Dockview mounts every canonical panel's content at load (the reason Monaco
  was eager too until Lab UX phase 1 made Structure the first Author view; Monaco is now fetched when the JSON view is first opened), and this
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
- History: when Monaco's engine was self-hosted (`DevilTea/deviltea-labs#30`), Monaco and ELK were both fetched on initial mount, and
  self-hosting moved neither into nor out of that path (it only removed the esm.sh dependency of a fetch that already happened). Since Lab UX
  phase 1 Monaco is no longer part of it: Author opens on Structure and the editor mounts with the JSON view.
- **Implementation panel + Shiki + curated raw-source chunks (`DevilTea/deviltea-labs#25` P3)**: unlike Monaco/ELK above,
  these genuinely stay lazy — `ImplementationPanel.vue` is registered in `Workbench.vue`'s `components`
  map through `defineAsyncComponent(() => import('./panels/ImplementationPanel.vue'))`, and the panel
  itself is only ever added to Dockview (`api.addPanel({ id: 'implementation', ... })`) the first time
  `ImplementationExplorerStore.open()` is called — from Preview's "View implementation" button,
  Blueprint's selected-node detail, or the Survey tour's map-of-the-views link (step 2) — never at `onReady()` time the way
  the seven canonical panels are. Verified by loading the built app fresh and driving each of those three
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
plugin**, not Nuxt. It is the Lab chrome's only styling system: PikaCSS was removed from the Lab by the PR that
ported its ~375 style calls to Tailwind utilities with no visual change (the Lab palette is exposed as
`text-lab-*`, `bg-lab-*`, `border-lab-*`, `accent-lab-*`, `rounded-lab` and `font-lab-*` utilities).

- **Tooltips have no exit animation** (`nuxt-ui.ts`, `ui.tooltip.slots.content`). Reka keeps a closed tooltip's content mounted until its
  exit animation ends, and every mounted content listens for the "a tooltip opened" event and closes its own root, including the root of the
  tooltip that was just opened again. A late animation end (busy or throttled page) therefore sometimes killed the tooltip of a header
  button a keyboard user had just tabbed onto, and disabled buttons explain themselves only in the tooltip. Without the animation a closed
  tooltip unmounts at once. `e2e/tooltips.spec.ts` pins real Tab/Shift+Tab navigation, once with every tooltip animation stretched to ten
  minutes (deterministic) and once plainly over many rounds. Do not re-add a `data-[state=closed]:animate-*` class to tooltips.
- **Scope: Lab shell only, plus a showcase's own instance.** `main.ts` imports `src/styles/lab-ui.css` (Tailwind theme + utilities, Nuxt UI),
  installs Nuxt UI's Vue plugin and wraps `App` in `UApp` (`toaster: null` until a surface needs toasts;
  `UApp` renders no element). `preview-frame-main.ts` / `preview-frame.html` never import any of it, so the showcase
  renderers are untouched. The renderers (`showcases/survey/renderers`) are styled with a `<style scoped>` block each, in
  plain CSS over their own `--survey-*` tokens (never the Lab's `--lab-*`), never with a Tailwind class (Tailwind does not even scan them:
  `lab-ui.css` lists its `@source`s explicitly). `src/styles/styling-boundary.unit.test.ts` walks the frame entry's imports
  and fails if any reaches the chrome's pipeline (`lab-ui.css`, `nuxt-ui.ts`, `src/ui/`, `src/components/`, Dockview, Vue Flow, Monaco) or
  `@nuxt/ui`/`tailwindcss` from outside a showcase directory; `e2e/nuxt-ui.spec.ts` pins, on the same-origin
  build, that the frame document has no Tailwind/Nuxt UI CSS, no `.dark` class and no `--ui-*` tokens. The one exception is a showcase that brings **its own** Nuxt UI instance: `renderer-packs`' Nuxt UI pack mounts a nested Vue app with `@nuxt/ui/vue-plugin` and its own Tailwind entry inside the frame (see its entry above and "Extra packages"), loaded lazily and styled with its own `--ui-*` values on its own root; nothing of the chrome's pipeline reaches it (`styling-boundary.unit.test.ts`), and for that showcase `e2e/nuxt-ui.spec.ts` asserts the frame the other way round (no Tailwind or Nuxt UI CSS until the pack is chosen, then none of the chrome's `--ui-*` to Lab palette mapping and no `dark` class on `<html>`). The frame's CSS does not depend on its origin
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
  (`scripts/nuxt-ui-codegen.mjs`, which resolves `vite.config.ts` and does nothing else). Do not enable auto-import to save an import line.
- **Cascade layers.** Order, lowest to highest: `properties` (Tailwind's `@property` fallback, which must rank
  below everything that sets a `--tw-*` variable), `theme`, `base`, `components`,
  `utilities` (Tailwind utilities and the classes Nuxt UI components are made of). The statement lives inline in
  `index.html` because the first `@layer` statement the browser sees fixes the order, and Vite links the stylesheet of a chunk
  the shell shares with the frame (today `tutorial-theme-*.css`, which has no layers) before the entry's own, which holds
  Tailwind and `global.css`; the inline statement keeps the order fixed whatever an earlier sheet gains. `lab-ui.css` repeats it. Unlayered CSS (`global.css`,
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
- **Unit tests.** Mount a Nuxt UI component with `global: { plugins: testGlobalPlugins }` (`src/test-support-ui.ts`, the real Nuxt UI plugin). A component that renders a Nuxt UI icon without the plugin has no bundled icons, which is why
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

## Showcase isolation

Showcase code (`src/showcases/<id>/**` and `src/sandbox/**`) runs inside the Preview frame iframe and is completely isolated
from the Lab: it shares no stylesheet, token, store or module with the chrome. What it receives from its host is the
**showcase host contract**, `src/showcase-host/`:

- `ShowcaseHost` (`host.ts`): `locale` (`'en' | 'zh-TW'`) and `theme` (`'light' | 'dark'`) as readonly refs, provided with
  `app.provide(ShowcaseHostKey, host)` and read with `useShowcaseHost()` (it throws outside a provider). That is all a
  showcase cannot know for itself; do not widen it without a reason that holds for every showcase.
- `defineShowcaseMessages()` / `useShowcaseMessages()` (`messages.ts`): a showcase keeps its own text, one table per locale
  (every locale must have every key), and selects from it by the host locale. Showcase *content* (the survey's title,
  questions and options) is Document data in the showcase's own language and never goes through this.
- `useInspectAnchor()` (`inspect-anchor.ts`) and the `SourcesRegistry` types (`sources.ts`): the Inspect anchor projection and the
  curated Implementation sources shape.

The Preview frame entry (`src/preview-frame-main.ts`) is the adapter: it builds a `ShowcaseHost` from the Lab's own theme and
locale stores (the `presentation.update` host command still drives those) and provides it. Frame-side glue (that entry, the
tutorial spotlight and observation, `styles/preview-frame.css`, `styles/tutorial-theme.css`) may use Lab modules and
`--lab-*` tokens; showcases may not. The tutorial reaches into a showcase only through `data-tutorial-target` attributes the
showcase stamps itself (`showcases/survey/tutorial-targets.ts`).

**What a showcase file may refer to:** its own directory, `src/showcase-host`, `vue`, and `@deviltea/widget-*` packages (and, in a test,
`vitest` and `@vue/test-utils`). **What it may not:** anything else, in particular `composables/`, `i18n/`, `theme/`, `tutorial/`,
`styles/`, `components/`, `lab/`, another showcase, or a chrome library (Dockview, Vue Flow, Monaco). "Refer to" is every way a file
reaches another one: static and dynamic imports, CSS `@import` and `url()` (quoted or not), SFC `<style src>`/`<script src>`, asset
attributes and `new URL(..., import.meta.url)`. A reference the guard cannot resolve from the text (`import()` with a template or a
variable, `import.meta.glob`, `require`) fails, and so does a file whose extension is not `.ts`, `.vue`, `.css` or `.json`, because it
would not be scanned. Its CSS (a `<style>` block, a stylesheet or an inline style) may not mention `--lab-*` or `data-lab-theme`.
`src/styles/showcase-isolation.unit.test.ts` enforces this over every file under `src/showcases/` (a file directly there belongs to no
showcase directory and may reach nothing), `src/sandbox/` and `src/showcase-host/`, tests included; `showcases/registry.ts` and its test
(the Lab-side index of showcases) are the only exemption. Each ablation case is in that test.

**Extra packages.** A showcase that needs a library of its own (a future self-contained Nuxt UI/Tailwind showcase, say) declares it in
`<its directory>/allowed-packages.json`, `{ "allowedPackages": ["@nuxt/ui", "tailwindcss"] }`: those packages and their subpaths are then allowed
inside that directory only (never in the host contract), and every path it refers to must still stay inside the directory. The frame
walk in `styling-boundary.unit.test.ts` forbids the chrome's own pipeline from the frame, not Tailwind/Nuxt UI as such: `@nuxt/ui` and
`tailwindcss` are only allowed from inside a showcase directory, and a stylesheet carrying Tailwind syntax may only be referenced from
inside the showcase directory it lives in. Two showcases declare extra packages today: `quote-rules` lists `valibot` and `@valibot/to-json-schema` (a schema library through Standard Schema) and `renderer-packs` lists `@nuxt/ui`, `tailwindcss` and `@iconify/vue` (its own Nuxt UI instance, its Tailwind entry and the Iconify runtime it switches off the network with), and `showcase-isolation.unit.test.ts` pins both lists, so another one is a reviewed change.

**Both directions.** Showcase renderer code and CSS must also stay out of the shell document. `showcases/registry.ts` holds shell-safe
metadata only (system, presets, sources); the renderer of each showcase is loaded lazily, by id, in the frame only
(`src/preview-frame-renderers.ts`, imported by `preview-frame-main.ts`). `src/styles/shell-isolation.unit.test.ts` checks that `main.ts`'s
import graph holds no showcase renderer, and, on the built `dist/` (through Vite's `.vite/manifest.json`, enabled in `vite.config.ts` and not deployed), that
every loader of `preview-frame-renderers.ts` is still its own lazy chunk (a renderer with lazy chunks of its own behind it, such as the Nuxt UI pack, keeps a thin facade as its entry, see `renderer-packs/renderers/index.ts`, and the check follows those chunks and their stylesheets too) (a renderer something static also imports would be merged into that
importer's chunk), and that `index.html` links no stylesheet of those chunks and statically loads none of them. It derives the renderers from
the manifest, so any showcase is covered. It needs `pnpm build`, which `pnpm check` runs first.

**A renderer that fails to load.** A dynamic `import()` that fails stays failed for the life of that frame document (the browser caches the
rejected module), so asking the same frame again could never succeed. The frame therefore answers a renderer-load failure with the protocol
flag `discardFrame` (distinct from `runtimeTornDown`): the frame driver drops that frame, the coordinator reports that nothing runs, and
"Try again" loads a new frame document and the chunk again (`e2e/polish.spec.ts`, "a showcase renderer chunk that fails to load once").

**Styling.** A showcase owns its colour tokens. The survey declares `--survey-*` on its root element (`SurveyRootRenderer.vue`),
dark by default and light under `.survey[data-survey-theme='light']`, where `data-survey-theme` is bound to `host.theme`; question
renderers and `control-style.ts` read only those tokens. The palette values are the survey's own copy (they happen to equal the
Lab's; a visual change to either is made in that one alone). The frame document supplies only the surface the showcase is drawn
on and what it inherits (text colour, font family and size) from `preview-frame.css`; the Sandbox sets no colours of its own and
relies on that inheritance.

**Adding a showcase.** Create `src/showcases/<id>/` with its plugins, system, presets, renderers, `messages.ts` (if it has
Lab-side text), `sources.ts` and renderer styles; import the host contract for locale, theme, inspect anchors and the sources
types, and nothing else of the Lab. Declare colour tokens on the renderer root keyed off `useShowcaseHost().theme`. Register its shell-safe entry
in `showcases/registry.ts` and its renderer loader in `preview-frame-renderers.ts`. Test renderers with a plain-ref `ShowcaseHost` (`survey/renderers/test-harness.ts` shows how), and run
`pnpm exec vitest run src/styles` to check the isolation guard.

## Plugin documentation and config schemas (Core 0.3)

Core 0.3 makes a plugin's `Interfaces` type, with its JSDoc, the single source of its documentation: there is no
`.description()`, no `description` on a config, slot or Event, no `config.schema`, and the catalog, `inspectPlugin` and the
Inspector snapshot (protocol 1.0) carry names and capabilities only (`docs/site/migration/0.3.md`). So:

- **Write documentation as JSDoc on the Interfaces.** Every showcase and sandbox plugin documents its `Interfaces` type (the
  plugin), its `config` member, every slot, State member, Property, Method (with `@param`/`@returns`) and Event, and its
  authored config types (`*RawConfig`), with the tags of `apps/widget-skills/tsdoc.json` (`@minimum`, `@pattern`, `@widgetRef`,
  ...). A slot's expectation is the most precise one its `validateStructure` upholds: a plugin-type union, or a
  `WidgetContract<Shape, Types>` where the parent reads its children's members (`Onboarding.steps`, `Survey.questions`, the
  two `Quote` slots), so `createWidgetSystem` checks each child plugin against that shape; the reads themselves stay on
  `dep.widget(id)` with the existing `.validate()` refinements. `registry.unit.test.ts` fails when a plugin, config, slot or
  Event of a showcase has no documentation. `widget-skills --check` (see `apps/widget-skills/README.md`) reports 0 errors for
  every showcase (`quote-rules` also 0 warnings). `quote-rules` writes its raw config types by hand in `raw-config.ts`, with the
  field prose of its Valibot schemas' `v.description()` repeated and the schema constraints as tags; `schemas.ts`
  (`RawConfigsMatchSchemas`) asserts that each is exactly the schema's `InferInput`, so a shape drift fails `vue-tsc` (the prose
  and the tags are not checked: change both sides together).
- **The docs reach the Lab through `widgetDocs()`.** `widget-docs.ts` (`labWidgetDocs()`) configures the widget-skills Vite
  plugin for the seven showcase Systems with `tsconfig.app.json`; `vite.config.ts`, `vitest.config.ts` and the root
  `vitest.config.ts` (project `lab`) all load it, importing the plugin by relative path (`../widget-skills/src/vite`): Vite hands
  a bare `@deviltea/widget-skills/vite` to Node, which cannot load its TypeScript sources. `virtual:widget-docs/<showcase id>`
  is that showcase's docs, imported by `showcases/registry.ts` as `ShowcaseEntry.docs`. The Lab loads them with `slim: true`
  (`WidgetDocsSlim`: the summary and `@remarks` of each plugin, its config, slots and Events, and the config schema; no `types`
  section, printed types or tags), because they sit in the eager shell chunk (`tutorial-theme-*.js`: 877 KB, gzip 200 KB with the
  full docs and the hand-written schema maps; 615 KB, gzip 176 KB with the slim docs, measured with `pnpm build`). `src/virtual-widget-docs.d.ts`
  declares the modules as `WidgetDocsSlim` (the Lab has no dependency on the private package; `author/widget-docs.ts` takes the types from the
  virtual module, because importing the generator's `docs-types.ts` from a Lab source is TS6307 in this composite project).
  Generating imports each System module in a worker thread; the result is cached in `node_modules/.cache/widget-docs/` of
  this app (delete it to clear it). Documentation gaps are Vite warnings, a name mismatch between types and runtime fails the
  load. A showcase file never imports a virtual module (`showcase-isolation.unit.test.ts`); the Lab side reads `docs` through
  `author/widget-docs.ts` (`pluginDocsOf`, `docText`, `memberDocText`), which read an undocumented member as `''`.
- **The config schemas are generated too.** `ShowcaseEntry.configSchemas` maps each plugin type with a config to its Draft
  2020-12 config JSON Schema: `generatedConfigSchemas(docs)` (`showcases/registry.ts`) takes `docs.plugins[type].config.schema`,
  the full-profile schema `widgetDocs()` generates from the `config.raw` type (a `$ref` root with `$defs`, object unions as
  `anyOf`, an `anyOf` with `null` when the config may be left out). A constraint the type cannot say is a JSDoc tag on the raw
  config type (`@pattern`, `@minItems`, `@uniqueItems`, `@propertyNames`, `@integer`, ...; a string or number tag on an array or
  a dictionary applies to its items or values), and one the validator already enforces may narrow the type itself (survey
  `languages: SupportedLanguage[]`, trip-budget `roundTransfersTo: RoundStep`, the `I18nText` with a required `en`). quote-rules
  overrides the map with the JSON Schemas of its Valibot validators (`quoteConfigSchemas`; its files, which the Web Worker
  bundles, use their own structurally equal type); the sandbox has none. `lab/showcase-config-schemas.unit.test.ts` holds the
  generated schemas to the showcases' code: their properties are exactly the config checkers' key lists (`*_CONFIG_KEYS`), the
  tagged constraints are there as keywords, and every config of each default preset conforms. The Structure editor and the
  Catalog read the map; Core never sees it.

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
- persistence/versioning/migration of any kind (the `document-repair` showcase's repair rules are that showcase's own domain code and persist nothing; the shell gains none of it) — `LabSession`'s `draftSourceText`/`documentState` and
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
never `fresh`/`dirty`/`active`/`stale` labels. Methods show their name, the compiler's
`transitivelyWrites` and `transitivelyEmits` facts (read from the Inspector snapshot, where both are always present since protocol 1.0; a Method with both facts `false` is tagged `read-only`) and (audit U08) their latest diagnostics: `RuntimeMethodRow.vue` subscribes to its Method member
(`runtime.subscribeMember` with `{ type: 'method' }`, through `useRemoteRuntimeMember` like State and Property rows, so only while its panel is visible)
and `MethodDiagnosticList.vue` renders each diagnostic's `code`, `message` (verbatim, never parsed), `reason`, `path`, `dependency`, `related`, `cause` and
`args` / `result` / `received` (the same value tree and truncation marking as Runtime values). The snapshot is the diagnostics of the Method's latest call that
returned, which Preview's own use produced: an empty one is "No failure recorded" and never "succeeded" or "never called" (it cannot tell those apart, and a
call that threw leaves it unchanged); a row whose Method snapshot has not arrived yet shows no status. There is still no invocation affordance and no call
history (Core keeps none). The Runtime Inspector always follows the
Preview connection and shows its Preview revision (`runtime-inspector/source.ts`); an invalid current
Document may leave an older valid Preview running, so it is not an unavailable Runtime state by itself.
Only a session with no valid Preview has an unavailable Runtime panel. The only Lab code that calls
`inspectRuntime()` is the Preview frame's tutorial observation (`src/tutorial/inspection-reader.ts`), which
holds the same `getSnapshot()`/`subscribe()`-only discipline.

## Dependencies inspector

The canonical readonly `Dependencies` Dockview panel owns two presentation views over the same current Document Blueprint facts. `Relations` (a focus-centric dependency inspector, readable at the default tool width) is the default view since issue #230 PR 3b; `Graph` is the opt-in topology view. Switching views is presentation-only: it preserves shared Document focus and never mutates semantic state. The active view is shared per store (`use-dependencies-view.ts`) so the Explain tab's "Open dependency graph" can switch it (and focus the Graph tab); "Reset layout" returns it to Relations.

`src/graph/` implements the authoritative Lab-side dependency projections. The Graph view continues to use this pipeline:

```text
BlueprintInspection -> projectSemanticGraph() -> toElkGraph() -> ELK layout -> toVueFlow()
```

- `relations.ts` — pure `projectRelations()`: `SemanticGraph + InspectorFocus + rootNodeId` -> a framework-agnostic Relations view model. It imports neither Vue Flow nor ELK. Root/no usable focus yields an explicit empty state; member focus exposes exact incoming **Used by** and outgoing **Depends on** facts grouped by remote widget; widget focus treats all members as the selected set, keeps cross-widget incoming/outgoing separate, and lists same-widget dependencies in an internal section. Every row retains the original semantic edge/reference/path/operation; unresolved stubs remain unresolved and non-focusable. Relations shares `graphShowAbsent`, but deliberately projects with isolated members present so the Graph-only `graphShowIsolatedMembers` presentation preference can never erase a focused member from this inspector. Resolved member/widget clicks write through the existing Document-scoped focus API; they do not request ELK layout.
- `src/components/dependencies/DependenciesPanel.vue` owns the internal `Relations | Graph` switcher and view-specific toolbar. The switcher follows the WAI-ARIA tabs pattern (roving tab stop plus Arrow/Home/End keyboard navigation and labelled tabpanels). The Graph DOM stays mounted with `v-show`, preserving pan/zoom across view changes. Shared focus changes never mutate Graph expansion state or request layout/refit; cluster identity selection and the explicit expand/collapse toggle are separate actions. `RelationsView.vue` renders the dense three-column inspector and the widget/internal-dependency mode without a canvas layout engine; same-widget unresolved stubs stay in the internal section rather than leaking into cross-widget outgoing dependencies. A selected Method whose `transitivelyWrites` and `transitivelyEmits` are both `false` is tagged "read-only" next to where W and E would be (issue #230: it used to be told only by the missing badges); the compact member chips keep W and E only.
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
  for layout efficiency. Unit-testable without a worker or the real elkjs runtime. Since issue #230 ("the Graph is hard
  to read") ELK only places the cards and finds each edge's corridor: layered, top to bottom, `NETWORK_SIMPLEX`
  placement and `GREEDY_MODEL_ORDER` cycle breaking, `POLYLINE` routing with `elk.json.edgeCoords: ROOT` so every
  edge's route points come back in canvas coordinates, and the spacing in `LAYOUT_SPACING` (cards 72, layers 88,
  edge-to-card 40, edge-to-edge 20; `CLUSTER_SPACING` inside an expanded widget). The numbers keep the cards visibly apart
  and the default collapsed Survey at 0.99 Fit zoom at 1440 x 900 (0.84 at 1280 x 800; its card text is 11px or more on screen only
  above about 0.9, and 128 between layers gave 0.82) and the collapsed Trip budget about 0.39;
  `fromElkResult()` also returns every edge's route (`LayoutedGraph.edges`), keyed by `aggregateEdgeId()`, the id of
  the Vue Flow edge drawn for it.
- `edge-geometry.ts` — pure: a route becomes a chain of cubic Beziers with vertical tangents (`routePath()`: only `M`
  and `C` commands, so a two-point edge is one `C`), plus the label point and the sample points the quality tests read.
- `layout.ts` — the shared `LayoutedGraph`/`LayoutGraphFn` adapter shapes and `LayoutGraphOptions`.
- `layout-session.ts` — `createLayoutSession(layoutFn)`: framework-agnostic, generation-guarded async
  wrapper around any `LayoutGraphFn` (real or a test fake). A layout result for a superseded `request()`
  call is discarded — this is what makes Graph layout safe as an asynchronous projection that never
  blocks Blueprint/Runtime/Preview availability (see "Layout worker boundary" below).
- `vue-flow.ts` — `toVueFlow()`: the laid-out `SemanticGraph` -> plain Vue Flow `nodes`/`edges`.
  Supports hierarchical progressive disclosure:
  - Widget clusters are the top-level view by default (collapsed), preventing visual overload on
    dense topologies (the Survey is 5 clusters / 37 members).
  - Expanding a cluster reveals its internal member vertices and stubs as child nodes. The Lab expands **one widget at a time**
    (issue #254, an owner decision): the store's `graphExpandedClusterIds` holds at most one id, `expandGraphCluster()` replaces it
    (so expanding B collapses A), collapsing the expanded widget leaves none, and there is no "Expand all" (the toolbar keeps
    **Collapse all**, which collapses that one). The accepted cost: no member-level view across two expanded widgets (Relations
    lists a member's dependencies on any widget). `toVueFlow()`/`toElkGraph()` still accept any set; only the Lab limits it.
  - Inter-cluster edges between collapsed clusters aggregate into single presentation edges. The
    canvas deliberately labels these with only a compact dependency count (`1 dep` / `N deps`);
    `semanticEdges` retains every exact member-level operation/path/reference for the details surface.
  - Selecting/focusing a widget or member highlights the connected subgraph and deemphasizes
    unrelated nodes and edges (`isDimmed` / `graph-node--dimmed` / `graph-edge--dimmed`). A focused member of a collapsed widget is
    not drawn, so that widget's card is marked focused instead (`isFocused`; issue #254: with one widget expanded, a member focused
    from Relations or elsewhere is usually in a collapsed one). Focus never expands or collapses a widget.
  - **Direction** (issue #230): an edge runs from the member that declares a dependency to the member it depends on
    (owner -> target, as above) and its arrowhead is on the target: `A → B` means "A depends on B", the Relations view's
    "Depends on" for A and "Used by" for B. `data.arrow` names the colour family of the arrowhead (the operation's, `danger`
    for an invalid cycle or stub, `accent` around the focus; the canvas draws the matching `<marker>`). While a widget or
    member is focused, an edge is related when it touches the focus (decided against the focus's own members only, never
    transitively): every other edge is dimmed (`graph-edge--dimmed`, opacity 0.25), each related edge carries
    `data.relation` (`depends-on` when it leaves the focus, `used-by` when it arrives; none inside the focus itself), `data.otherEnd`
    (the other end's name: `#sessions`, `#mode.value`) and the matching `graph-edge--depends-on` / `--used-by`
    class (drawn in the accent colour). Every edge uses the one Vue Flow edge type `GRAPH_EDGE_TYPE`.
  - Vue Flow is strictly viewer-only: every node is `draggable: false`/`connectable: false` and no edge
    is `updatable`.
- `src/components/graph/GraphCanvas.vue` — the only place in this app that imports `@vue-flow/core`
  (and its structural `dist/style.css`); custom node templates for `cluster`, `member`, and `stub`,
  themed through the Lab palette tokens. Collapsed and expanded cluster identities and expanded member cards are keyboard-focusable/selectable without changing expansion state. The expand/collapse button of a card carries `aria-expanded`
  (localized names "Expand"/"Collapse", 展開/收合). A toggle requests a new layout and the canvas is not drawn while the worker lays it out
  (`flow` is null), so the pressed button leaves the DOM; `DependenciesPanel.vue` remembers the toggled card and, once the next layout is
  drawn (`layoutVersion`), focuses that card's button in its new state (`GraphCanvas.focusClusterToggle()`, retried for about a second while
  Vue Flow still hides the unmeasured card), unless focus moved outside the Graph view meanwhile; expanding B therefore leaves focus on B's
  Collapse button (`e2e/graph.spec.ts`). The collapsed cluster card makes widget type primary, widget id
  secondary, and summarizes member inventory as S/P/M counts; the expanded cluster becomes a subdued
  compound inspector shell rather than a dashed debug boundary. Member nodes keep State/Property/Method
  distinguishable by a small letter badge plus restrained accent, so kind is not encoded by color alone.
  Edge operation is encoded primarily by stroke treatment (reads thin solid, writes stronger solid,
  invokes dashed). Since PR 3c (audit U11) every edge label (the aggregate counts too) is hidden until its edge is hovered or selected, because neighbouring
  labels ran into each other; all text is 11px or more (members 12px, node footprints `VERTEX_WIDTH` 200 x 36, `COLLAPSED_CLUSTER` 240 x 88 to fit it), and `GraphKey.vue`,
  a row above the canvas that is always visible, says what S, P, M, W, E, ! and the three line styles mean, so the Legend popover is only the long form.
  Edges are drawn by `GraphDependencyEdge.vue` (registered under `GRAPH_EDGE_TYPE`): Bezier curves through ELK's route
  points, starting and ending on the card borders where ELK spread them, so several edges of one card stay apart and none
  runs behind a card; without route points it falls back to Vue Flow's own handle positions. The key's first item states
  the direction (`A → B: A depends on B`), the Legend explains it with the Relations words, and a focused widget's or
  member's edges are tagged "Depends on #other" / "Used by #other" (hidden while the edge itself is hovered, which shows its
  operation). The tags are placed together by `graph/tag-placement.ts` (`composables/use-graph-tags.ts` computes them from the edges, the cards and the zoom *bucket*, so a
  wheel tick or a pan step inside a bucket does not place again; `GraphCanvas.vue` draws them in one layer after every edge and card, the
  `zoom-pane` slot of Vue Flow, so no edge is drawn across their text, and hides the tag of the edge that is hovered or selected):
  each tag sits on its own edge in the half nearer the focused card, so it reads as being about that card, and takes the first
  spot (going away from the card) where its box lies inside the content bounds (the box around the cards and curves, which is what Fit
  fits: a tag is no part of that, so one outside would be cut off by the pane) and covers no card, no arrowhead of any edge (its own
  included, the dimmed edges' too) and no other tag; the two directions take turns, the rarer first. A tag with no such spot gets a second chance beside its edge (issue #230 follow-up), after
  every tag had its try on its own edge: its box is set 1.5, 2.5 or 4 font sizes off the edge, across the edge's direction (left or right of an edge
  that runs down, above or below one that runs across), at the same shares of the edge (so still in the half nearer the focus), and a **leader line**
  with a dot on the edge joins it to the point it is about (`TagPlacement.leader`, drawn by `GraphCanvas.vue` as `.graph-tag-leader`; the group is
  `.graph-tag--leader`). The box obeys the same rules (inside the content bounds, on no card, no arrowhead, no other tag) and covers no curve of
  an edge around the focus (it would read as that edge's); the leader crosses no card, no arrowhead, no tag and no other leader (it may cross a
  curve), and no later tag sits on an earlier leader. A tag with no spot either way is not drawn (the Trip budget's Expense has
  a dozen edges; the Legend says so), the accent colour, the dimming and the arrowheads still mark the focus's edges and
  Relations lists them all. `GraphDependencyEdge.vue` draws its labels itself (a rect and a text sized by `tagSize()`, the function
  the placement used) because Vue Flow's `EdgeText` measures its box once at mount and so boxes 11px text around text of any other size.
  `graph/zoom-scale.ts` cuts the zoom into nine buckets (1, 0.85, 0.72, 0.6, 0.5, 0.42, 0.35, 0.3, below): each has an arrowhead
  length (12 to 48 canvas px) and an edge text size (11 to 46) that keep the arrowhead 12 screen px long and the text 11 or
  more at the lowest zoom of the bucket (about 14px at the most), and tags are not drawn below 0.3 (the colour and the dimming remain). The arrowheads are
  `<marker>`s defined in `GraphCanvas.vue` (one per colour family and bucket; Vue Flow's own `arrowclosed` draws at a quarter of
  its nominal size) and `GraphDependencyEdge.vue` picks the one for the current bucket, so a wheel tick inside a bucket
  re-renders nothing. Edge strokes are solid mixes of the muted text colour and the canvas (3.7:1 in the light theme).
  **Keyboard access to the edges** (issue #230 follow-up): the edges are one roving Tab stop. A Vue Flow edge with `focusable` on
  (which `graph/vue-flow.ts` sets) gets `tabIndex: 0` as a DOM property, which Vue applies to the SVG `<g>` as `tabindex="0"` on every edge
  (verified: twelve Tab stops in the Survey), which a `tabindex` in `domAttributes` did not reliably replace; it also binds its key handler
  as `onKeyDown`, which Vue registers for an event named `key-down` that never fires. Nothing is patched in Vue Flow: `GraphCanvas.vue`
  overrides `focusable: false` on every edge it hands Vue Flow, gives back `role="group"` and a real lowercase `tabindex` through the
  per-edge `domAttributes`, and handles the keys itself, delegated on the canvas. Selection (click, Enter, Space) does not depend on `focusable`. One stop was chosen
  over "every edge is a Tab stop" (the Trip budget draws 71 edges, 111 with #hotel expanded) and over "edges only reachable from their focused card"
  (an edge would then have no route when nothing is selected, and a card's own keys are already taken by select/expand). `graph/edge-a11y.ts`
  (pure, unit-tested) orders the edges with the ones around the focused widget or member first; Arrow Down/Right, Arrow Up/Left (wrapping), Home
  and End move DOM focus along that order. Exactly one edge has `tabindex="0"`: the first of the order to begin with (the rendered attribute, so
  "select a card, then Tab to the edges" lands on that card's edges), and from then on the edge that has or last had focus. `focusin` rewrites the
  `tabindex` attributes in the DOM directly (old stop `-1`, new stop `0`), so Tab and Shift+Tab leave the group from whichever edge the arrows
  reached, moving re-renders nothing, and Vue Flow is not given a new edge list per key press; a watcher puts the stop back on the first edge of
  the order when the graph, the focus or the language changes, unless an edge has focus. A focused edge shows what a hovered one shows (its label;
  its focus tag gives way) and a solid accent band along the curve (`.graph-edge-focus-ring`, 7 screen px at any zoom through
  `vector-effect: non-scaling-stroke`, `Highlight` in forced colours), at full opacity even when the selection dims the edge; Enter or Space selects
  it as a click does and opens `GraphEdgeDetails`, Escape clears the selection (`edgeClear`) and is only consumed when there is one. The accessible
  name is a sentence, not an arrow (a screen reader reads "→" as "right arrow"): `#form.valid depends on #name.value (reads)`,
  `#form depends on #name (3 deps)`, told from the focus for an edge that arrives at it (`#name is used by #form (3 deps)`), with
  `, invalid cycle` appended, and a stub edge says `#a.p has an invalid dependency (reads)` / `... depends on a target that is absent (...)`; zh-TW
  `#form 依賴於 #name（3 個依賴）`. It is built from `data.sourceName`/`data.targetName` by `edgeName()`. Vue Flow's own `aria-describedby` text
  (English, "press delete to remove it") and `aria-roledescription="edge"` are replaced through `domAttributes` by a localized description of the
  keys and by "dependency". The edge keeps Vue Flow's `role="group"`: a composite role (`listbox`/`option`) would have to be set on Vue Flow's own
  `<svg>` containers (one per z-level, re-created by it), so it is not; a screen reader in browse mode may therefore keep the arrow keys to itself,
  and Relations stays the screen-reader route to the same facts. `e2e/graph-readability.spec.ts` drives all of it with the real keyboard.
  **Readonly keys**: `deleteKeyCode`, `selectionKeyCode` and `multiSelectionKeyCode` are `null`. Vue Flow's default `deleteKeyCode` (Backspace, a
  document-level listener) removed the selected cards and edges from this inspector; there is no Shift-drag selection box and no Ctrl/Cmd
  multi-selection either, since the details show one edge.
  The handles Vue Flow requires are invisible (an edge does not attach to them) and the canvas uses only a subtle dot
  grid: these cues must never imply that the readonly inspector is an editable node editor.
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
**Fit graph** button along with **Zoom in** / **Zoom out** and **Collapse all** controls in the toolbar (no **Expand all**: one widget is expanded at a
time, issue #254). Fit leaves 4% around the graph (it used to leave 20%, then 8%) and fits the curves as well as the cards (`fitBounds` over both),
because a long edge runs in a corridor beside the cards. Expanding or collapsing a widget refits the whole new layout (the expanded widget and the
other widgets as cards), as **Fit graph** does. Expanding every widget at once could not be made readable by layout options (issue #230, measured
with the real ELK at a 691 x 681 canvas: `COFFMAN_GRAHAM` layering with `layerBound` 2 to 5, a tighter root, `BRANDES_KOEPF` placement; the best
expanded Survey Fit was 0.306, member text about 3.7px, and the expanded Trip budget stayed between 0.047 and 0.076: 37 or 112 member cards at
once), so the Lab expands one widget at a time (issue #254). Measured the same way (real ELK, the 691 x 681 canvas of a 1440 x 900 window;
`graph-readability.unit.test.ts` "fitted size" pins the floors and that the largest widget is the lowest Fit, `e2e/graph-readability.spec.ts` reads
the same zoom in the browser: 0.416 and 0.197 for the two largest), one expanded widget fits the Survey at 0.415 to 0.651 (the largest, #sessions with 8 members, is 0.415: member text,
12px, about 5.0px on screen; #mode 0.651, about 7.8px) and the Trip budget at 0.196 to 0.389 (the largest, the Expense #hotel with 15 members, is
0.196: about 2.4px; a Person about 0.31, #settlement 0.389), against 0.27 and about 0.06 fully expanded. Fitting only the expanded widget's own box
would give #sessions 0.575 (about 6.9px) and #hotel 0.363 (about 4.4px), so member text reaches 11px only by zooming in (above about 0.92) either
way; Fit keeps the whole layout so the expanded widget's dependencies on the other cards stay in view. Fit may reach 0.05 (for a Document larger
than the showcases); afterwards the manual zoom floor (wheel, pinch, **Zoom out**) is `min(fit, max(0.1, fit / 4))`, so a small graph (the Survey
fits at 0.99, so about 0.25) cannot be wheeled down to a dot, and the Trip budget with #hotel expanded (0.196) zooms out to 0.1. The collapsed card
text is 13px (type) and 12px (id, S/P/M counts).
`src/graph/graph-readability.unit.test.ts` (real ELK on both showcases) and `e2e/graph-readability.spec.ts` pin the spacing, the
Bezier paths, the arrowheads and "no edge behind a card"; the arrowhead size, the 0.95 Fit floor of the default Survey (card text 11px or more at 1440 x 900, near 11px at 1280 x 800), the dimming and
the tags (on no card, no arrowhead and no other tag, nearer the focus, 11px or more, above every edge; a leader starts on its own edge, is short,
ends on its tag and crosses no card) are measured in the browser as well. `src/graph/tag-placement.unit.test.ts` pins the placement, leaders included, on hand-made geometry.

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

**Revert vs. Undo last change.** Revert discards the unapplied draft only (disabled when there is none). *Undo last
change* (named "Undo last apply" until Lab UX phase 1: it also takes back Structure edits and presets, which the user never "applied") (`LabSession.undoLastApply()`, `LabStore.undoLastApply()`) restores the source the Document held before its
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
curated `ShowcaseEntry.sources` Implementation Explorer registry. The names and capabilities come from Core (`system.catalog`;
the declared Events per plugin through `inspectPlugin` from `@deviltea/widget-core/inspection`, since they are not in the
catalog); the prose comes from the showcase's generated documentation (`ShowcaseEntry.docs`) and the config schema from its
`ShowcaseEntry.configSchemas`, because Core 0.3 publishes neither (see "Plugin documentation and config schemas (Core 0.3)").
`author/catalog.ts` joins them: each entry shows the plugin's description, its config description, its slot descriptions,
an `Events` section (name and description verbatim; Core publishes no Event payload schema, so the Catalog shows none) and,
when the showcase has a schema for the plugin, the schema in a collapsed `<details>`. A member without documentation shows no text.
"Copy catalog JSON" copies the whole catalog as plain JSON (`{ widgets: [{ type, description, config: { description, schema } | null,
slots: { name: description } | null, events: { name: description } | null }] }`: `config` is `null` without the config capability and
`schema` `null` without a schema, `events` `null` without the Events capability, an undocumented description `''`) so the plugin
definitions can be handed to an AI as authoring context. A generated `schema` is self-contained: it carries the `$defs` its `$ref`s
point into.
The view must not invent state/property/method schemas or member definitions that Core does not publish
through the catalog contracts; config schema metadata is authoring guidance, not Runtime validation truth.

`Structure` renders the current committed Document Blueprint inspection and uses Document-scoped focus.
Since issue #230 PR 3c (audit U15) it edits the selected widget's whole authored `config`, type-aware
(`ConfigFieldEditor.vue`, recursive, inside `AuthorStructureView.vue`): a switch for a boolean, a number box (decimal
notation only; `integer`/`minimum`/`maximum` are Core's to check), a list for an `enum`, a text box for a string, an object with its optional keys (add from a list, remove with
a button; free keys of an `additionalProperties` object are added by name) and an array with Add and Remove. The controls
come from the plugin's passive config JSON Schema (the showcase's `ShowcaseEntry.configSchemas[type]`, read by `src/lab/config-schema.ts`: `$ref`,
`type`, `enum`/`const`, `oneOf`/`anyOf` by a shallow "does the value look like this branch" test (a union of one schema and `null`, a
generated optional config or field, is read as that schema for a value that is not `null`, without the hint), `properties`, `required`,
`additionalProperties`, `items`, `minItems`/`maxItems`, `default`, `description`; `$ref` is any local JSON Pointer, with `~0`, `~1` and percent escapes decoded). That reading chooses a
control and what may be added or removed and never validates (the numeric limits are not checked in the editor, so the schema and the compiler cannot
disagree): Core's compiler stays the authority, and an edit that makes the Document
invalid shows up as Core diagnostics in Problems. A value read as one branch of a `oneOf`/`anyOf` offers that branch's values only and says so (`union-hint`: other forms are
edited in the JSON view). Without a schema (or inside a shape the module does not read, such as a `oneOf` no
branch of which fits) values are typed by what they hold; scalars still get switch/number/text controls, objects and arrays offer no add or
remove, and anything else is edited as its JSON text (Set value / Cmd or Ctrl+Enter). Switches and lists apply at once; text and number boxes apply
on Enter or **Set value**, and a refusal (not a number: `abc`, `0x10`, `Infinity`) is shown at the field and sends nothing. A config that is not an object (a string,
a list, a number) has no keys: it is edited whole, as JSON, and replacing it is the empty-path edit.

**Narrow panes (Lab UX phase 2, report item 15).** With the tutorial rail open at 1280px the Author panel is about 480px wide, and the
fields were squeezed to about 18px with Set value over the remove button. The tree column is `clamp(9rem, 32%, 220px)`; every
`ConfigFieldEditor` is a container (`@container`), and below 20rem of its own width a leaf's label goes on its own line above the control
(`@max-xs:w-full`); boxes keep at least 120px (`min-w-30`), and the box row and the add rows wrap (Set value goes below the box) instead of
overlapping. `e2e/structure-narrow.spec.ts` checks at 1280x800 with the rail open that every box is at least 120px wide, that no two
controls overlap and that nothing scrolls sideways.

The controls are never `disabled` while a command runs (a disabled control hands keyboard focus to the body at every commit); they carry `aria-disabled`
and stop reporting edits. `AuthorStructureView.vue` then keeps keyboard focus in the editor: focus that is still on a control stays, a new field or item takes it,
a removed one hands it to the control that took its place. It only ever moves focus that is on nothing (the body) or still inside the editor: focus the user moved to another
control while the command ran stays where they put it. `onEdit` drops a second trigger while a command runs synchronously (`busy` is set before the first `await`; the
controls' own `busy` prop only follows with the next render). The add controls keep what was chosen or typed until the Document holds the new key (issue #230):
an add that is not reported, or is reported and refused, keeps the choice for another try. A commit that is not applied (a dirty JSON draft, a patch error, a stale
selection) reaches only the control at the edit's path (`resync`, passed down the tree, with the outcome message): a list or a switch the user only moved is re-created and
shows what the Document holds again; a text, number or JSON box keeps the rejected input (nothing typed is lost) and says "Not applied: <why>" (`data-testid="not-applied"`,
the box's `aria-describedby`; the reason alone, the outcome line above is the live announcement), with **Use the Document value** to go back (focus returns to the box).
**While a JSON draft exists** (`isDirty`) a Structure commit would be refused (`draft-dirty`: it would discard the draft), so since Lab UX phase 1
Structure says so before anything is clicked: a notice above the editor ("The JSON view has unapplied changes. Apply or discard the JSON draft
to edit here.", `structure-draft-notice`, `role="note"`, with **Open the JSON view**, which then puts keyboard focus on the JSON tab of the
Author views, `author-view-json`) and the fields are locked (`structure-fields` `data-locked="true"`, dimmed; `ConfigFieldEditor` gets `busy`
and `locked`, so the controls keep focus and readability, carry `aria-disabled` and send nothing, and the text, number and JSON boxes are
`readonly`, so nothing can be typed that would sit unsent in a box). When the lock lifts (Apply or Revert, even without leaving Structure) every
box shows the Document's value again, including text typed before the draft appeared. The tree stays usable. The `draft-dirty` refusal and the resync/"Not applied" handling stay for a draft that appears while a
command is being sent (and serve patch errors and stale selections); `e2e/structure-editor.spec.ts` reaches them by setting the draft and
acting in the same task (`actWithDraftAppearing`). A command that went through says so in plain language ("Change applied. Use Undo to take it back."; it said "Author command applied to Document rN"); the
revision it produced is the outcome line's `data-revision`, for specs.
A later change of the Document's value at that path replaces the text and clears the note (a JSON box compares by content, so the same config re-read as a new
object changes nothing), and so does typing the Document's value back. Text typed into other fields is kept, and the root editor is keyed by the selected
widget, so nothing typed or refused for one widget is shown for another.

`EditConfigCommand` (`{ nodeId, documentRevision, configPath, edit: replace | add | remove }`; `ReplaceConfigScalarCommand` still exists for
the scalar case) carries both the current Document `InspectionNodeId` and Document revision; `src/lab/author.ts` resolves that exact
snapshot node and lowers the command to a `SourcePatch` addressed by the node's Core-computed `sourcePath` (array form, except that appending
to an array uses the JSON Pointer form `.../-`, the only way a patch can say "append"; the first key of a widget that has no `config` yet
creates it; so does a `null` config; an empty path replaces the whole config with any JSON value, or creates it). The component never constructs a patch and never targets a widget by id, which keeps duplicate authored ids and cross-revision focus
safe. A path that no longer exists, an `add` over an existing key, a stale revision and a non-JSON value are explicit `unsupported` outcomes, each with its own message;
mechanical patch failures are `patch-error`. After a commit Document focus stays on the same widget when the new Document still has it (found again
by id and type; an ambiguous or missing one goes back to the root). After a **Structure** commit the member stays too, so edits can follow
each other; after a JSON Apply, a preset or Undo only the widget is kept (the tree may have changed, and a member with it). Until Lab UX
phase 1 those commits always reset to the root, which threw the user out of the widget they were editing after every Apply. A showcase
switch builds a new focus store and starts at the root (`src/lab/focus.ts`, `focus.unit.test.ts`).
**A Structure commit keeps key order**: the edited key and its ancestors stay where they were in the source JSON (`label.en` stays before
`zh-TW`, `config` before `slots`), so the JSON view does not reshuffle after an edit. That is Core's `applyPatch` keeping a replaced member in
place (`DevilTea/widget#260`); the Lab adds nothing for it. `author.unit.test.ts` ("a Structure commit keeps the key order of the source") commits through
`LabSession.author()` and compares every object's key order before and after; it fails against a Core older than that change.

Successful Structure commands and JSON Apply share `LabSession`'s Document commit and Runtime promotion
boundary. A successful Structure commit rewrites both applied source text and the JSON draft to deterministic
pretty JSON only when the draft still equals the command's captured clean text; a concurrent Monaco edit is
preserved as dirty. Invalid Document commits advance the authored revision while retaining the prior valid
Preview revision. No persistence, authoritative history, redo, collaboration, drag/drop, or Runtime-state migration
belongs to this Phase 3 workspace (the bounded "Undo last change" stack in "Apply lifecycle" is a convenience over the
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
**Apply / Revert / Undo / Format**; and an **overflow** menu with Tutorial, Theme, **Lab language** (labelled as the Lab's own, since the survey has a language select of its own in the Preview) and a **Developer**
submenu (Implementation, Document Tools). Hidden test fixtures stay reachable only through `?showcase=`.

- *Examples menu* (`UDropdownMenu`): a Showcase group and the current showcase's Preset group (checkbox items, the
  current one checked). The trigger always names the showcase and the last loaded preset
  (`LabStore.loadedPresetId`: the showcase default on entry, then the last preset loaded), or "edited": `deriveExampleState()`
  names the loaded preset only while there is no unapplied draft and the applied source is the same document as that preset (or
  another preset of the showcase it equals, so Undo back to the default names the default again), otherwise `edited`. "The same
  document" compares JSON values (`lab/json-equal.ts` `sameJsonDocument()`: whitespace and object key order do not count, array order
  does; text that does not parse is compared as text), since Lab UX phase 2, so Format + Apply on an untouched preset still names it. `data-showcase-id`, `data-preset-id` and `data-example-kind` are the machine-readable hooks.
- *Status chips* (`deriveLabStatus()`): validity (`data-state` `valid` | `problems`, `data-problem-count`;
  "Valid" / "N problems"; a JSON syntax error of the last Apply counts as one problem, since no Document was committed
  from that text) and preview (`data-state` `current` | `stale` | `unavailable`: "Preview up to date" / "Preview shows the
  last valid version" / "No preview yet"). `data-testid` stays `document-status` / `preview-status`. Revision numbers, the Blueprint
  status and Linked / Diverged are developer details in the info popover (`status-details`; `revision-link-status` lives there).
  Both stay facts about the **committed** Document. A third fact, the **draft** (`LabStatus.draft`: `clean` | `unapplied`, from
  `LabSession.isDirty`), adds the chip "Unapplied changes" (`draft-status`) while the JSON draft differs from the Document, and the
  Preview chip, while `current`, then says "Preview shows the last applied version" instead of "Preview up to date"
  (`data-behind-draft="true"`; `data-state` stays `current`), so nothing claims the Preview shows what the user is typing. The chips
  are not live regions (no `role="status"`): nothing is announced when they change, on purpose for now, since a later phase replaces
  them with one status chip and handles announcements there. With problems, the validity chip is a **button** (`UButton`, same test id and data
  attributes) that runs `store.showProblems()`; its accessible name is "N problems: show them" (the visible text is
  part of it; it said "... in the JSON view" until Lab UX phase 2, when "Show problems" started staying in the open Author view). `e2e/header-feedback.spec.ts` pins the draft chip, the one-row header with it at 1280px (en and zh-TW, and zh-TW with the
  problems button, the draft chip and the stale Preview label all shown) and the button.
- *Edit actions*: a disabled action keeps `aria-disabled="true"` instead of `disabled` so it stays focusable and its tooltip
  can say why (nothing to apply / revert / undo, or "apply or revert your unapplied edits before undoing"); the click
  handler also refuses. Apply's tooltip shows the shortcut as key caps. Undo shows "Undo" and is
  named "Undo last change" for assistive technology (the visible text is contained in the name); specs and helpers look the Apply
  button up with `exact: true` (or its test id). zh-TW: Revert is 捨棄草稿 and Undo 復原上一步 (they were 還原 / 復原, near-synonyms for two
  different actions); every zh-TW string about reverting says 捨棄 (`i18n/ux-phase1-messages.unit.test.ts`).
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
- *Committed-edit protection* (Lab UX phase 2, report item 10). **"The document differs from what was loaded"** means: the committed
  Document's applied source is the same document as no preset of the open showcase, compared as JSON values (`hasCommittedEdits()` in
  `lab/draft-guard.ts`, `LabStore.hasCommittedEdits`; the same rule that makes the Examples menu say "edited", without the draft). A
  document that equals a preset again, for example after Undo, has nothing a preset load could not bring back; revision numbers are not
  used because they only grow. What happens then depends on whether the replacement can be undone (`replacementLoss()`):
  - A **showcase switch** starts a new session with an empty Undo stack, so it asks first: the same `DraftGuardDialog` with "Discard your
    edits?" and "You edited this document. Opening “…” replaces it, and Undo cannot bring your edits back." (Keep editing / Discard
    changes are the Cancel / Continue of the dialog pattern). With an unapplied draft as well, **one** dialog names both
    ("Discard your changes?", `data-loss="draft-and-edits"` on the body; `draft` and `edits` otherwise).
  - A **preset load** (the Examples menu) and a **tutorial start** on the tour's own showcase are ordinary commits that Undo takes back, so
    committed edits alone do not ask (a draft still does). `LabStore.applyPreset()` records, before the load, whether it replaces committed
    edits, and after a load that advanced the revision sets `replacedNotice` (`{ subject: preset label, revision }`). `ReplacedDocumentNotice.vue`,
    above the Preview next to the stale-preview notice, then says "Loaded “<preset>”. Undo to get your edits back." with **Undo** (the header's
    Undo, `aria-disabled` while it is unavailable) and **Dismiss notice**. It is inline and has no timer; it applies only while the Document is still at
    that revision (`replacedNoticeVisible`), so Undo or any later commit ends it, and a showcase switch clears it. Its wrapper is a `role="status"`
    region that stays in the page, so the message is announced. `e2e/committed-edit-protection.spec.ts` pins every case.
- `LabStore.authorView` (Catalog / Structure / JSON) starts on **Structure** (Lab UX phase 1; it was JSON) and then keeps what the user
  chose, also across showcase switches; it is not saved across reloads. Specs that need Monaco or the Problems list open it with
  `openAuthorJson()` (`e2e/fixtures.ts`). It lives in the store, not in `AuthorPanel`, so other surfaces can
  open the JSON view; `showProblems()` activates Author and sets `problemsFocusPending`, and since Lab UX phase 2 stays in the open
  Author view (from the Catalog it opens Structure); the mounted view consumes the flag (see "Problems in Structure"). `Workbench.vue` now also feeds
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
unapplied draft is still mapped (a note says the rows are "from the last change"; an unparsable draft has no ranges). The
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

### Problems in Structure (Lab UX phase 2, report item 12)

Structure shows the same problems as the JSON view, from the same source (`LabStore.problems`: the committed Document's diagnostics and the
last Apply's syntax error; no second validation path). `LabProblem.configPath` is the part of a problem's source path inside its widget's
`config` (`null` when the path does not run through `<node>.config`), and `placeStructureProblems()` splits the list for the selected widget:
- **at a field**: the selected widget's problems with a `configPath`. `ConfigFieldEditor` gets them all and each field shows the ones it
  claims (`claimsFieldProblem()`): its own path, or a path under it that no field below renders (inside a value edited as JSON, or a key
  that is not there, such as a missing required key, which shows at its object). The text is Core's code and message, verbatim, in the
  field-error style (`text-error`) under the control (`field-problems` / `field-problem`); the control is `aria-invalid` and its
  `aria-describedby` names the list (and the "Not applied" note when there is one); a group's list is focusable and describes the group.
- **at the widget header**: its other problems (dependency, structure and member diagnostics, which Core locates at the widget or a member,
  not at a field), and its config problems when the widget has no config editor here (`node-problems`, focusable).
- **in a compact list** at the top of the editor (`structure-problems`, "N problems elsewhere in the document"): other widgets' problems,
  each a button that selects that widget and focuses the problem there, and problems with no widget (a JSON syntax error, a source-level
  diagnostic), plain rows. The tree keeps its per-widget counts.

"Show problems" (the header's problems button and the stale-preview notice's) in Structure selects the first problem's widget and focuses its
field's control (or the field's or the header's problem list), or the list's first row for a problem with no widget. In JSON it moves focus to
the Problems list as before. `lab/problems.unit.test.ts` pins the placement and claiming rules, `ConfigFieldEditor.unit.test.ts` the field markup,
and `e2e/structure-problems.spec.ts` the browser behaviour (max below min at the field, a dependency diagnostic at the header, the list, "Show
problems" from Structure, the Catalog and JSON).

**Deferred: precise locations for dependency diagnostics.** The report found that the squiggle and "Go to location" for a broken
`visibleWhen.question` mark the widget's `"id"` instead of the bad value. Core's dependency diagnostics (`missing-dependency-target` and
friends) carry the widget, the member and the dependency reference (`dependency.target.widgetId`), but no source path into the config, so the
Lab has no exact location to point at; finding the value by searching the text for the id would be a guess. It stays widget-level until Core
reports a path.

### Stale-preview notice

When the Preview lags the Document the notice above it says why and offers an action: "Your last change has N problems,
so the preview still shows the last working version." with **Show problems** (`preview-show-problems`, `store.showProblems()`, which stays in
the open Author view),
or, if the Document is valid but the Preview has not caught up, a plain "does not show your latest change yet" line without
the button (a valid Document has no problems to show).
`data-testid="preview-diverged-status"`; revision numbers appear only in the header's details popover.

### Separate inspector panels with shared presentation primitives (Phase 5)

Blueprint and Runtime remain separate outer, canonical Dockview panels. `BlueprintPanel.vue` is the
current Document inspection surface for semantic status, diagnostics, recovery nodes, and Document
focus; `RuntimePanel.vue` is the Preview-revision surface for passive Runtime state/property/method
inspection and Preview focus. They must not gain a shared Blueprint/Runtime mode, shared revision state,
or cross-revision `InspectionNodeId` mapping. Preview Inspect selects the Selected widget pane when
Document/Preview revisions are linked (it selected Blueprint before) and Runtime when they diverge, and the hint next to the Inspect
button names that panel ("Click a widget to open it in Selected widget / Runtime", `inspect-hint`; it said "focus it in Blueprint"
until Lab UX phase 1, `e2e/inspect.spec.ts` pins both cases). Since Lab UX phase 2 a linked Inspect selection made while the Explain tab is
the visible one stays in Explain (and the hint names Explain): the Explain panel reports its Dockview visibility through
`use-explain-visibility.ts`, which `PreviewPanel.vue` reads (`e2e/explain.spec.ts`); Graph and Implementation retain
their existing Document-scoped entry points.

`src/components/inspector/InspectorPanelShell.vue` and `InspectorSplitLayout.vue` are intentionally
small, props/slot-only presentation primitives. The shell owns only the repeated description-bar and
column-container chrome; the split layout owns only the tree/divider/details columns. Blueprint and
Runtime continue to provide their own data, status lines, diagnostics, recovery behavior, selection
handlers, and details components. Do not use these primitives as a semantic or focus abstraction, and
do not merge the two outer panels merely to remove presentation duplication.

### Workbench layout and the Selected widget pane (issue #230 PR 3b)

**Layout.** The default layout is two Dockview groups: the tool group (Author, Explain, Selected widget, Blueprint, Runtime, Events, Dependencies;
Author active) and Preview. The tool group is about half the workbench (48%, clamped to 420-940px; it was about 29%, which clipped
Relations and the Implementation source). The layout is saved to `localStorage` (`widget-lab:layout`, value
`{ version, layout }` where `layout` is `DockviewApi.toJSON()`) 250ms after it settles and on `pagehide`, and restored by
`Workbench.vue` on load. `src/lab/layout-storage.ts` (no Vue, storage injected) owns the format: a layout is used only if it has the
current `LAYOUT_VERSION`, every canonical panel, panels that name registered components only, and a sized grid; anything else (invalid
JSON, another version, a missing panel, an unknown component) reads as "none" and the default layout is built. Dockview's
`fromJSON` can still throw for plausible data: that is caught, and the default is built. Whatever was stored and not usable is removed.
Bump `LAYOUT_VERSION` whenever a change to the panels or their components would make an old saved layout wrong (version 1 already includes the Selected widget and Events panels; neither needed a bump, because a layout saved before a canonical panel existed lacks it and the check on canonical panels discards it anyway, once). All storage access is try/catch; blocked storage means "nothing saved". Panels opened on
request (Implementation, Document Tools) are saved with the layout but stripped from the data before Dockview loads it
(`stripLazyPanels`, applied by `loadSavedLayout`), because their content depends on a request that load did not make; a group whose
active panel was one of them activates its first remaining panel, and a group that held only such panels (a lazy panel dragged into a group of its own) is
removed from the grid: its size goes to the previous sibling (the next one when it came first), a branch left with one child is replaced by it
(a leaf takes the branch's size; a branch's children are lifted into the parent, scaled to fill it, and a root left with a single branch flips its axis), and
`activeGroup`/`maximizedNode` are dropped when they pointed into the old tree, so the other dividers stay where the user put them. A grid it does not
recognise (or one with nothing but lazy panels) is still unusable (default layout). After a restore `Workbench.vue` writes Dockview's active panel to `LabStore.activeTab` (the Dockview-to-store
subscription is made later), so the store and the screen agree about the open tab. Dockview-vue also reports the restored active panel a moment later through
`onDidActivePanelChange`, so no browser spec can tell the write from that event (`e2e/layout.spec.ts` asks for Author from outside Dockview after a restore and passes either way);
`Workbench.unit.test.ts` mounts the real Workbench over a saved layout with that event silenced and fails when the write is removed. Saved sizes are proportional on restore, so a layout from a wide window fits a narrow one. Tab titles are
set when a layout is built or restored and follow a language switch. **Reset layout** (overflow menu; `WorkbenchLayoutStore` is a request
bridge like Document Tools) clears the saved layout and rebuilds the default. The selected showcase is restored separately, by
`?showcase=`.

**Tutorial rail.** `TutorialRail.vue` is a 320px flex column beside `Workbench` inside `.lab-body`. `Workbench.vue` already observes
its own size, so Dockview re-lays out when the rail opens or closes, and the rail never covers the header, the overflow menu, the
Dockview groups or the Preview frame (the survey's own Language select). With the rail open at 1280px the tool area is about 460px, narrower than the three
Relations columns need (about 680px), so `RelationsView.vue` stacks them (Used by, the focus, Depends on) and scrolls vertically below 680px of **pane** width
(a container query, so dragging the divider changes it too) instead of scrolling sideways. `e2e/layout.spec.ts` measures this at 1280, 1440 and 1920.

**One tour per showcase.** `src/tutorial/tours.ts` lists the tours (`survey`, `trip-budget`, `quote-rules`, `onboarding`, `document-repair`, `renderer-packs`): the id is the showcase's id, and each entry carries the script, the default preset a start reloads and the draft-confirmation message. `use-tutorial.ts` owns one engine per tour and an `activeTourId` that follows the open showcase while no tour runs (the showcase's own tour, or the Survey's for the hidden Sandbox); a tour that is running or paused belongs to its showcase and ends when another one opens, so the rail never describes a showcase that is not open. The Preview frame evaluates the stages of any listed tour (`preview-host/protocol.ts` accepts the ids in `TOUR_IDS`). A new showcase tour is one script, one `tours.ts` entry and its zh-TW strings (`i18n/trip-budget-messages.ts`, `i18n/quote-rules-messages.ts`, `i18n/onboarding-messages.ts` and `i18n/document-repair-messages.ts` are the models).

**A tour gives the user's place and work back (Lab UX phase 2, report item 14).** `beginTour()` records the tool tab and the Author view
(`LabStore.activeTab`, `authorView`) and the tour's **Finish** or **Skip tour** restores both (`restorePlaceBeforeTour()`; a recorded `preview` is not restored: activating the Preview group again left the Preview frame blank in the trip tour spec); pausing keeps the
tour's place, and a tour that ends because its showcase was left restores nothing (the user chose where to go). A start reloads the tour's
default preset: on the tour's own showcase that is an ordinary preset commit, so committed edits are not asked about and the store's
replaced-document notice offers Undo (see "Header, status chips and draft protection"); `decideDeterministicStart()` asks only about an
unapplied draft, or, when the start switches showcase (from the hidden Sandbox, which has no tour), about committed edits too, with its own
message (`START_DISCARDS_EDITS_MESSAGE`). `TutorialActions.activateTab(tab, authorView?)` can also open an Author view.

**The Survey tour teaches editing.** `survey-script.ts` has ten steps: the map of the views comes second (Author, Preview, Explain, Selected widget,
Events, Blueprint, Runtime, Dependencies, Implementation, each a link), and `edit-and-undo` comes after the answer steps (a committed edit
restarts the Preview, so the answers those steps build on would start over). It opens Author > Structure on `mode` (`data-tutorial-target`
`author-structure` is the Structure editor pane) and is gated on `mode.text`, the label the Preview renders in the survey language: the first
stage completes when it is neither default label (en or zh-TW), the second when it is a default again (Undo). The map says that
selecting a widget (Inspect, or the Structure tree) makes Explain show what it is and why it behaves this way; its TODO for phase 3 is
only to drop the views the IA moves into Tools.

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
to the remote Runtime, are not rendered and hold no subscription. The linked/diverged rules (`runtimeState`, the message that says why there are no values)
live in `use-selected-widget-runtime.ts` since Lab UX phase 2, shared with the Explain tab.

**The Explain tab (Lab UX phase 2, M13).** `ExplainPanel.vue` (canonical panel `explain`, tab "Explain" / 說明, right after Author) explains
one widget for a newcomer, in its final shape (the design's phase 3 keeps it; the Selected widget and Dependencies tabs stay until phase 3 moves
or removes them). It explains only a widget someone **chose**: `InspectorFocusStore.isDocumentFocusChosen()` (`LabStore.documentFocusChosen`)
is true after a `setFocus` call or a linked Inspect selection, and false for the root the focus starts at and falls back to when a commit drops
the selected widget, so Explain never explains the root by default and shows one card instead ("Click a widget in the Preview (Inspect) or in the
Structure tree..."; while the revisions diverge Inspect opens Runtime, so the card says the preview shows an older version and points to the
Structure tree only). Top to bottom, each part its own component in `components/explain/` so phase 3 can show Selected widget, Blueprint and
Runtime details through the same pieces:
1. **Identity** (`ExplainIdentity.vue`): `#id` and the type, and the plugin's generated summary (`pluginDocsOf(docs, type).summary`, line wraps
   joined), whose Markdown code spans `DocProse.vue` draws as `<code>` instead of raw backticks. There is no generic "label" for a widget (a label
   is a plugin's own config, such as the survey's `{ en, zh-TW }` objects), so the id is shown.
2. **Why it behaves this way** (`ExplainWhyList.vue`, a `<ul>`): `buildWhySentences()` (`explain/why.ts`) makes one sentence per (Property of
   the widget, other widget, operation) from the Blueprint inspection: "options reads #mode's value (now: no value)", "amountBase calls
   #currency's convert". Dependencies on the widget itself, Methods (they are not why it shows something) and absent/invalid references are left
   out. The "now" values are live: each State or Property read is an `ExplainLiveValue.vue` subscribed through `useRemoteRuntimeMember` to the
   other widget's member in the Preview (the widget is found by id and type in the linked Preview snapshot, and only when that identity is unique,
   `uniqueRemoteNodeIdForIdentity` in `lab/focus.ts`, the focus store's rule: a duplicate id shows no value), so a Property shows "not evaluated yet"
   until the Preview evaluated it, `null` reads "no value" (generic wording: the design's "not answered" is survey vocabulary), and a failed one
   "failed". Core does not say which config field produced a dependency, so the **config field is an inference**: a string value of the authored
   config equal to the other widget's id names it; a dependency path that starts with a top-level config key (`["rules", "guests"]`) limits the search
   to that field, and keys another Property's dependency on the same widget claims that way are skipped (so `sessions.options` does not borrow
   `rules`). Outside such a field a matching value counts only when the generated schema marks it as a widget reference, the sentence
   `widgetDocs()` writes for `@widgetRef` ("Must be the id of a widget of type A | B in the same document.", `widgetRefTypesOf`), preferring one
   that names the other widget's type; otherwise no field is shown, so a string that only equals the id (`{ inputType: "email" }` beside a widget
   `email`) is never taken for a reference. The survey's condition `question` carries `@widgetRef` for this (the four question types; `Numeric` for
   `greaterThan`/`lessThan`, `MultipleChoice` for `includes`/`excludes`). The field shown is the top-level key, or, inside a list of objects, the item's key (`options[1].enabledWhen.question` -> `enabledWhen`),
   with its description from the generated config schema (`describeField`, the Structure editor's reader). A plugin that finds its widgets through its
   slots (the trip's chain, quote-rules, onboarding) gets no field, which is the honest answer; so does the sandbox, which has no schemas. A widget
   whose Properties read no other widget says so. The lists are `<ul role="list">` (Tailwind's `list-none` removes the list semantics in Safari), and
   the widget buttons show `#id` with the accessible name "Select widget #id" (選取 widget #id).
3. **Current values**: `RuntimeNodeDetails` (`embedded`, `hideMethods`), the same rows as Selected widget, only while `runtimeState` is `ready`;
   otherwise the shared message.
4. **Used by / Depends on** (`ExplainRelations.vue`): the widget-focus `projectRelations()` model, one entry per other widget with its member pairs
   ("visible reads value"); a resolved widget is a button that sets the shared Document focus. "Open dependency graph" calls
   `useDependenciesView().openGraph()`, which switches the Dependencies panel to Graph, activates its tab and moves keyboard focus to the Graph view
   tab (the panel's own focus target for a view switch), so focus never falls back to the page. The view is shared per store for this (it used to be
   panel-local) and stays presentation-only; "Reset layout" puts it back to Relations (`reset()`, called by `Workbench.vue`), as the rebuilt panel
   did when it owned the view. The zh-TW headings are 被誰使用／依賴的 widget, 使用它的 widget and 它依賴的 widget: Relations' 依賴於 reads as
   unfinished as a heading on its own.
5. **Declaration details**: a collapsed `<details>` with `BlueprintNodeDetails` (`embedded`).

Which version the values come from is one line under "Why it behaves this way" (`explain-values-source`): "Current values come from the running preview,
which shows the current document (rN)", or, while diverged or without a Preview, why there are none; no value from another revision is shown (the
Selected widget rules). `data-runtime-state` on `data-testid=explain` is `none` with nothing chosen. Tests: `explain/why.unit.test.ts`,
`lib/prose.unit.test.ts`, `lab/focus.unit.test.ts` (chosen focus), `i18n/explain-messages.unit.test.ts` (every literal has zh-TW with the same
placeholders) and `e2e/explain.spec.ts` (empty card and tab order, Inspect with a live value that changes after answering, Used by moves the selection,
Open dependency graph, the diverged wording, zh-TW). A new canonical panel needed no `LAYOUT_VERSION` bump: a saved layout without it fails the
canonical-panel check and the default is built once (`layout-storage.unit.test.ts`, `e2e/layout.spec.ts`).

**Events (audit U09).** Events are visible in two places. *Declared*: `components/events/DeclaredEvents.vue` lists a plugin's Events
(name and description, verbatim and untranslated, no payload schema because Core publishes none; an Event without documentation shows its
name only) in the Catalog and in `BlueprintNodeDetails` (so also the Selected widget declaration and the Blueprint panel): the names from
`inspectPlugin` / the Blueprint inspection's `events`, the descriptions from the showcase's generated documentation (`ShowcaseEntry.docs`). *Occurring*: `EventsPanel.vue` (canonical panel `events`, tab `Events`, after Runtime) is a live log over the Inspector
protocol only (`runtime.subscribeEvent` / `runtime.eventOccurred`, never a Core Runtime; it cannot emit). `composables/use-event-log.ts` is
one shared source per store: it subscribes to every Event of every resolved widget in the current Preview connection's Blueprint
snapshot, **whenever the Lab has a Preview connection and a consumer is mounted**, not only while the Events tab is the visible one: Events are
push-only with no idle cost and Core has no replay, so a Submit pressed while another tab is open must be in the log when the tab is opened (Dockview
mounts every canonical panel at load, so the panel is a consumer from the start). It releases every subscription when the connection is replaced
(Apply, retry, remount) or the last consumer is disposed; a subscription answered after that is released at once. Entries that arrive while the panel is
not visible (`usePanelVisibility`) are counted as unseen: the Events tab (`NonClosableTab.vue`, reading `useEventLogTabState()`, which subscribes to
nothing) draws that count as a small badge and puts it in the tab's accessible name; a tab is not a live region, so nothing is announced per Event,
and the count resets when the panel is visible. The state of the listening is spelled out (`listening`: `off`, `no-preview` = no valid Preview,
`loading` = a valid Preview whose frame has not connected, `lost` = the frame was connected and is not, `no-events`, `listening`).
Entries are `{ seq, at, revision, runtimeId, nodeId, widgetId, widgetType, event, args }`; `at` is when the Lab received it (the protocol
carries no timestamp), `revision` is the Preview revision that emitted it, `args` are the Inspector's bounded `InspectableValue` DTOs shown
with the same `InspectableValueTree` and truncation marking as Runtime values. The buffer holds the last `EVENT_LOG_LIMIT` (500) entries and the
panel says how many older ones were dropped; entries survive an Apply (tagged with their revision) and are cleared by Clear and by a
showcase switch, which also ignores what the previous showcase's connection still sends until the new one has replaced it. Pause keeps the
subscriptions but records nothing and counts what it skipped (the button's label switches Pause/Resume; it has no `aria-pressed`, which would contradict it).
Filters (widget, Event name, "only the selected widget", which matches widget id and type, like selecting an entry) are the panel's own state. An entry's
widget button selects that widget in the Preview by id and type (node ids belong to the Runtime that emitted it); when the current Preview no longer has it
the button is `aria-disabled` (still focusable, activation ignored) and its reason is its description, and the row of the selected widget is `aria-current`. The live region announces Pause/Resume/Clear and a count
that settles after a quiet second, never one announcement per Event. The only Event the Survey emits is `submitted` (root `open-day`, from `submit()`);
the hidden Sandbox declares none. Tests: `events/`, `use-event-log.unit.test.ts` and `EventsPanel.unit.test.ts` run a real Core Runtime behind a real Inspector
Agent (`events/test-support.ts`); `e2e/events.spec.ts` drives the Survey.

*Method failures (audit U08).* The same log also lists Method failures, labelled "Method failure" because they are not Events (`MethodFailureEntryRow.vue`,
`kind: 'method-failure'` entries `{ …, method, diagnostics }` next to the `kind: 'event'` ones in the one 500-entry buffer). `use-event-log.ts` also subscribes to every
Method of every resolved widget (`runtime.subscribeMember`, `{ type: 'method' }`, released with the Event subscriptions) and records an entry when a `runtime.memberChanged`
carries a Method snapshot with diagnostics. What is recorded is the Method's diagnostic snapshot, a current fact and not a call log: the snapshot a Method already holds when the
subscription starts is not an occurrence and is not recorded; a repeated identical failure is another entry; a later success (an empty snapshot) records nothing and clears the
row in Selected widget / Runtime; changes inside one Runtime call (a Method that invokes others) can arrive as one entry. Pause skips them too and counts them apart
(`skippedFailuresWhilePaused`); they count as unseen. A "Show" filter (Events and Method failures / Events only / Method failures only) joins the widget and "only the selected
widget" filters, which apply to both kinds; an Event name filter never matches a failure. The counts and notes say "Events" until a failure has been recorded since the last Clear and
"entries" afterwards. The status shows how many Methods are watched and how many could not be subscribed (a refusal is counted, not fatal). The Lab does not track the negotiated
protocol minor: at protocol 1.0 the Method member and `transitivelyEmits` are always available (no minor gates them), and a peer on another protocol major, such as a `0.x` frame, cannot connect at all (`unsupported-version`), so the Lab never meets a peer without them. Tests:
`use-event-log-method-failures.unit.test.ts`, `EventsPanelMethodFailures.unit.test.ts`, `RuntimeMethodRowFailures.unit.test.ts` (real Core and Agent) and `e2e/method-failures.spec.ts`.

**Runtime values (audit U10).** State and Property rows are `RuntimeValueRow.vue`: the member name and a one-line summary that takes
the room the row has (no fixed width; its full text is the tooltip), a separate named disclosure button (`aria-expanded`,
"Value of NAME") for containers and long or cut strings, and a separate select button (focus). The open value is
`InspectableValueTree.vue`, an expandable tree over the Inspector value DTO. The limits that remove information (depth 4, 50 entries,
1000 nodes, 500 characters) belong to the Inspector snapshot, set in `packages/inspector`; the Lab does not change the protocol or work
around them and instead marks every cut where it happened ("truncated by the Inspector snapshot (nested too deeply)", "more entries
were left out", "cut"), with one note under a value that has any (`hasTruncation()`). `formatInspectableValue()` (the one-line
summary) still prints `<truncated>`. The summary can only take "the room the row has" if the panel's grid does not grow with it:
`InspectorSplitLayout.vue` (Blueprint and Runtime) uses `220px 1px minmax(0, 1fr)` with `min-w-0` columns. A plain `1fr` track has the
content's min-content width as its minimum, so one long JSON preview stretched the Runtime grid to about 1500px in a 690px panel and
`overflow: hidden` hid every value. `e2e/polish.spec.ts` ("inspector values stay inside their panel") checks that every summary in
Runtime and Selected widget lies inside its panel at 1440 and 1280, keeps its full text as the tooltip, and that neither grid scrolls sideways.

**Config (audit U25).** `ConfigView.vue` shows the resolved config by default and the authored one on request, and only when they
differ (`lib/config-compare.ts`, structural equality; it names the top-level fields that differ); equal configs are one block with a note.

### Preview failure and first paint (issue #230 PR 3c, audit U22, U23)

**Preview failure.** `previewHost.error` holds the cause of a mount that failed, and the Lab says so instead of leaving a blank pane (`data-testid=preview-error`,
the engine's message verbatim, **Try again**). Two cases are told apart (`data-frame-state`, `previewHost.runtimeSurvives`): the frame did not answer in time (`readinessTimeoutMs`, 15 s)
or its connection closed by itself, or it answered with an error after it had already taken down the Runtime it replaced (`runtimeTornDown` on the host's error reply, a Lab-internal field of the preview-host protocol, not the Inspector protocol), so nothing runs (`lost`: the connection the Lab held is dropped, the dead iframe is hidden, the header chip is `failed`,
"Preview failed to load"); or the frame answered with an error before it touched anything (a mount it refuses: session or generation mismatch, unknown showcase, invalid source) and still runs the last Preview
that mounted (`running`: the iframe stays, the copy says it still shows the last version, the chip is the ordinary `stale`). **Try again** is `LabStore.retryPreview()` ->
`LabSession.retryPreview()`: it mounts the newest valid Document if that is ahead of the Preview (a promotion that failed leaves the Document committed and
the Preview snapshot on the older revision, which would otherwise stay `stale` after a successful retry), else the Preview as it is, and only then does the Preview snapshot
become that revision; success clears the error. The coordinator learns about a
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
  chrome (HTML or the Graph's SVG labels) is under 11px (the Tailwind `text-[..px]` utilities and scoped CSS were raised; do not add a smaller one). A native checkbox
  is 16px with its label as the 24px target. The check is run by hand with a Playwright script that lists visible interactive elements under 24px and
  text nodes under 11px per surface, plus axe-core (tags wcag2a, wcag2aa, wcag21aa, wcag22aa and best-practice; both themes, 1440px) on Header, Author (JSON, Catalog,
  Structure), Selected widget, Blueprint, Runtime and Dependencies (Relations, Graph); axe is deliberately not a dependency of the repository.
  `e2e/polish.spec.ts` pins the Graph's sizes.
- **Selected tab.** The selected Dockview tab of each group has the panel background and a 2px accent bar along its top edge (an inset
  `box-shadow`, so its size does not change), in both themes and whether or not its group has focus (it used to look like its hidden
  siblings in a group without focus). The Author sub-tabs mark their selected view with a 2px bottom border and bold text, so the two
  levels never look alike. `e2e/polish.spec.ts` ("the selected workbench tab") reads the computed styles.
- **Focus.** `dockview-theme.css` draws a 2px accent ring (inside the tab) on a Dockview tab or tab action reached with the keyboard (`:focus-visible`; Dockview's own
  1px divider-colour outline is `!important`, so the Lab's rule is too, and more specific). The Graph's expand/collapse toggles, cluster buttons and member
  cards have a 2px accent outline. Graph **edges** are one Tab stop walked with the arrow keys, with an accent band as
  the focus indicator (see "Dependencies inspector"); Relations remains the dense keyboard route to the same facts, and the Graph has **Zoom in / Zoom out** buttons next to Fit graph (the wheel and pinch already zoom).
- **Language.** Navigation names are Taiwan Chinese: Author is 編寫, Explain 說明, Dependencies 相依性, Relations 關聯, Graph 關係圖, Catalog 目錄, Structure 結構 (tab titles
  follow a language switch). **Widget vocabulary stays English** (Widget, Blueprint, Runtime, Preview, Document, State, Property, Method, Event, Source), and so do
  `JSON` and the product name. Since Lab UX phase 1 every tab title is translated: a name that is navigation around a Widget word mixes the two, as 選取的 widget
  already did: the Events log is "Events 紀錄" (its own message, `Events log`, so the Catalog's bare "Events" label stays), Document Tools "Document 工具", and
  Implementation 實作 (the word "查看實作" already used). The panels opened on request follow a language switch like the canonical ones; specs reach them
  through `openDeveloperTool()`, whose labels follow the page language. Source-owned text is never translated: Core diagnostics, plugin and schema descriptions, the survey's questions and the engine messages. The
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
history semantics may be added (an "Undo last change" commit is just another observed commit, origin `undo`). Runtime/Preview behavior, revision-scoped focus, Author recovery,
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
`openDependenciesGraph` (Relations is the default Dependencies view; `loadPreset` knows the zh-TW names of the survey, trip, quote, onboarding, repair and renderer packs examples), and the `expectShowcase` /
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
