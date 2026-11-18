# widget-lab

Private, never-published Widget Lab application shell for `@deviltea/widget-core` /
`@deviltea/widget-vue` / `@deviltea/widget-inspector`: a workbench with a live JSON Source editor, an
explicit Apply lifecycle, a persistent Preview (an isolated iframe realm that owns the Runtime), and
readonly Blueprint/Runtime/Dependency Graph inspectors.

See [AGENTS.md](AGENTS.md) for the architectural boundaries this app must keep (public-entry-point-only
consumption of `@deviltea/widget-core`/`@deviltea/widget-vue`/`@deviltea/widget-inspector`, readonly inspectors, no
persistence/editor-domain state, sandbox fixtures vs. showcases).

## Stack

- **Vite + Vue 3 + TypeScript**, ESM.
- **`modern-monaco`** (pinned exact version) for the Source panel — one JSON document, no CDN
  dependency (local `tm-themes`/`tm-grammars` assets), isolated behind `use-monaco-editor.ts` /
  `MonacoJsonEditor.vue`.
- **`dockview-vue`** for the workbench layout (tabs/resize/docking) only — never the semantic model.
- **`@vue-flow/core` + `elkjs`** (both pinned exact versions) for the readonly Dependency Graph panel —
  Vue Flow is viewer-only (pan/zoom/fit/readonly selection, no editing), ELK Layered runs the automatic
  compound layout inside a persistent Vite module Worker (`src/graph/layout.worker.ts`). See "Dependency
  Graph" below and AGENTS.md's worker-boundary section.
- **Nuxt UI 4 + Tailwind v4** (through Nuxt UI's Vite plugin, not Nuxt) for the Lab shell only; the Preview
  frame never loads it (the showcase renderers are styled with plain scoped CSS). Dockview's structural
  stylesheet is themed through a small custom theme (`src/styles/dockview-theme.css`) whose CSS variables
  derive from the Lab palette tokens (`src/styles/lab-tokens.css`); Vue Flow's own default theme CSS is not
  imported — only its structural `dist/style.css` is, so canvas visuals stay palette-token-driven. The Lab
  theme store stays the single source
  of truth (`data-lab-theme`, mirrored onto Nuxt UI's `.dark` class, with `--ui-*` tokens mapped to the Lab
  palette), icons are bundled locally from `@iconify-json/lucide`, and components are imported explicitly (no
  generated `components.d.ts`). See AGENTS.md "Nuxt UI and Tailwind".

## Commands

```bash
pnpm --filter widget-lab dev
pnpm --filter widget-lab build
pnpm --filter widget-lab typecheck
pnpm --filter widget-lab test
pnpm --filter widget-lab test:browser
pnpm --filter widget-lab test:pages
```

## Showcases and the Sandbox fixtures

`src/sandbox/` hosts a small, Lab-private `WidgetSystem` (Text/Counter/Section/Stack/Summary plugins,
the last demonstrating a cross-widget `registerDeps` dependency) with three preset source texts: a
fully valid interactive one, one that is intentionally semantically invalid (to demo diagnostics), and
one that exercises Blueprint recovery (an unresolved node and a raw-slot placement). These are
test-only fixtures for this shell, hidden from the Examples menu. Three showcases are listed, all registered in
`src/showcases/registry.ts` (which also registers the hidden `sandbox`): "Interactive Survey" (the default),
"Trip budget splitter" and "Quote rules shared by browser and backend". Open a hidden fixture with the `?showcase=<id>` URL parameter, e.g. `?showcase=sandbox`; a
missing or unknown id falls back to the default. The parameter follows the active showcase (the Lab rewrites it with
`history.replaceState`), so reloading restores it.

Showcases are isolated from the Lab: they render in the Preview iframe and import only their own directory, the small
host contract in `src/showcase-host/` (the host's locale and theme, showcase-local messages, the Inspect anchor and the
curated sources types), `vue` and the `@deviltea/widget-*` packages. A showcase declares its own colour tokens (the survey's
`--survey-*`) and its own translations, so none of the Lab's `--lab-*` tokens, stores or i18n tables reach it;
`src/styles/showcase-isolation.unit.test.ts` enforces this, including any import, `url()`, `<style src>` or dynamic
reference that leaves the showcase's directory. The other direction holds too: the shell never loads showcase renderer code or
styles (renderers are loaded lazily, in the frame only, by `src/preview-frame-renderers.ts`;
`src/styles/shell-isolation.unit.test.ts` checks the built `index.html`). See "Showcase isolation" in `AGENTS.md`, which also says how
to add a showcase.

### Trip budget splitter

A small group plans a weekend in Lisbon: four people, five expenses in euros, dollars and pounds (equal and percentage
splits) and a settlement of who pays whom. The widgets are `Trip` (root), `Currency`, `Person`, `Expense` and
`Settlement`; the plugins are in `src/showcases/trip-budget/plugins/`. What it shows, and where in the Lab:

| Core feature | In the showcase | Where to see it |
|---|---|---|
| Property chains across widgets | `Currency.convert` -> `Expense.amountBase` -> `Expense.shares` -> `Person.owed`/`paid` -> `Person.balance` -> `Settlement.balances` -> `Settlement.transfers` | Dependencies > Relations / Graph; Selected widget (the values) |
| Read-only Methods read by a Property | `Currency.convert` (amount to base cents) and `Currency.roundTransfer` (reads State `roundStep`) | Relations: a Method with no W (writes) and no E (emits) badge; Selected widget: the Methods list |
| Laziness | `Expense.breakdown` and `Person.ledger` are read only while a viewer opens them | Runtime / Selected widget: `Never evaluated` until opened. The Lab cannot show who is subscribed, only whether a Property was ever evaluated and its latest result |
| `resetState` | "Reset this expense" (`widget.resetState()`) and "Start over" (`runtime.resetState()`, after which the host writes the interface language back so the page does not switch language), asked of the host (`renderers/reset-host.ts`) because `useWidget()` exposes no Runtime | Preview; the State values in Selected widget go back to the authored ones |
| Validation | located config and structure diagnostics (a rate of 0, percentages that add up to 90, a negative amount, an unknown payer); a negative or missing amount typed at run time is an `errors` entry and the expense is not counted | Problems list (preset "Draft with mistakes"); the expense card |
| Failure at run time | an expense in a currency with no rate: `convert` fails and so does everything that reads it | Preset "Run-time failure"; Selected widget shows `Failed` on `amountBase` and `shares` |

The presets are `trip-default`, `trip-invalid` and `trip-unsupported-currency`; there is no cycle preset because
nothing in a trip reads the settlement. The tutorial rail has a tour for the showcase; the overflow menu's Tutorial starts the
tour of whichever showcase is open (the Survey's for a showcase that has none). The showcase follows the showcase host contract (it reads only the host's light/dark theme and
the Inspect anchor) and styles itself with its own `--trip-*` tokens; its language is Widget State, not the Lab's locale.

### Quote rules shared by browser and backend

A print shop ("Corner Press") quotes a job: three printed items (quantity and paper), a volume discount, a rush surcharge, a
courier fee and a sales tax. The widgets are `Quote` (root), `Item`, `VolumeDiscount`, `RushSurcharge`, `Delivery` and
`SalesTax`; the plugins are in `src/showcases/quote-rules/plugins/`. The pricing rules are plugins, so the very same files run
in the Preview and in a Web Worker that stands in for a backend. What it shows, and where in the Lab:

| Core feature | In the showcase | Where to see it |
|---|---|---|
| JSON-in/JSON-out evaluation without a renderer | `src/showcases/quote-rules/evaluate.ts` compiles the document, writes the answers (`Quote.answers`) into a fresh Runtime and returns `Quote.quote`; `quote.worker.ts` runs it in a module Web Worker with no DOM, and only JSON text crosses | Preview: "The same rules, run twice" shows the page's quote and the worker's side by side, where each ran (the worker has no `document` or `window`) and that the two are the same JSON; change any answer and both follow |
| A schema library through Standard Schema | Valibot schemas validate every config and the State a customer writes; `guard()` (`standard-schema.ts`) turns each issue into a Core diagnostic with the library's own message | Preset "Invalid config": Problems lists six located diagnostics with Valibot's messages, verbatim; a quantity of 0 in the Preview is refused and the old value stays |
| Config JSON Schema | each plugin's `config.schema` is the same Valibot schema object's JSON Schema (`~standard.jsonSchema`) | Author > Structure: a list of tiers with Add and Remove, number boxes, a switch and a choice list; Author > Catalog: the schema |
| The isolated-exception receiver | `VolumeDiscount` has a deliberate defect: below its first tier its `compute` throws. Core isolates the exception, and the Preview installs `setIsolatedErrorHandler` and lists it | Preset "Buggy rule": set the A5 flyers quantity below 90. The page keeps the last amounts and says so; "Isolated exceptions" names the rule. The Lab cannot show it: Runtime and Selected widget keep the Property's last completed value |
| Property chains and `resetState` | `Item.line` -> `Quote.subtotalCents` -> the rules' `adjustment` -> `Quote.taxableCents` -> `SalesTax.adjustment` -> `Quote.quote`; "Start over" is `runtime.resetState()` | Dependencies > Relations / Graph; the Preview |

The presets are `quote-default`, `quote-invalid` and `quote-buggy-rule`. The tutorial rail has a tour for the showcase (en and zh-TW).
The showcase follows the showcase host contract (it reads the host's locale and light/dark theme and the Inspect anchor) and styles
itself with its own `--quote-*` tokens. It is the first showcase with extra packages (`valibot` and `@valibot/to-json-schema`, in its
`allowed-packages.json`) and the first with a Web Worker (its file is inside the showcase directory, as the isolation guard requires).

## Header, editing feedback and Undo

The header is one row from 1280px up: the **Examples** menu (showcase and preset; it always names the showcase and the
last loaded preset, or "edited" once the document changes), two plain-language status chips (the document is *Valid* or
has *N problems*; the preview is *up to date* or *shows the last valid version*, with revisions and linkage in an info
popover, which also holds the JSON draft, Source JSON compatibility, Blueprint status and recovery facts), the edit actions
**Apply / Revert / Undo / Format**, and an overflow menu with Tutorial, Theme, Language, **Reset layout** and a Developer submenu
(Implementation, Document Tools).

- **Apply** is also Cmd/Ctrl+Enter, inside the Monaco editor and from any focused tab; its tooltip shows the keys.
- **Revert** discards the unapplied editor draft. **Undo** ("Undo last apply") restores the previously applied source as a
  *new* Document revision (through the same commit path as Apply, up to 20 steps back); it is unavailable while an
  unapplied draft exists, and a tooltip says why for every disabled action.
- Loading a preset or switching showcase over an unapplied draft asks first (Keep editing / Discard changes).
- After an Apply that leaves problems, the Author JSON view lists them under the editor (Core's code and message verbatim,
  or the JSON syntax error); each row jumps to its place in the JSON, which also gets error squiggles. The preview shows a
  plain-language notice with **Show problems** while it still shows the last working version.

## Editing a widget's config (Structure) and what the Lab says when something fails

- **Author > Structure** edits the selected widget's config with controls that follow the plugin's config JSON Schema: a switch for a boolean, a
  number box (Core checks the limits), a list for an enum, a text box for a string, and Add / Remove for optional fields and list items where the schema allows
  them. Every change goes through the same Document commit as Apply (Undo, the status chips and Problems keep working; it asks you to Apply or Revert an
  unapplied JSON draft first). Without a schema, values are typed by what they hold and anything else is edited as JSON.
- Problems lists the several diagnostics Core reports for one evaluation cycle as one entry that expands to Core's own diagnostics.
- If the Preview frame cannot load, the Preview pane says so with the cause and a **Try again** button, and the header chip reads "Preview failed to load".
- Graph: an always-visible key explains the badges and line styles, edge labels appear on hover, and Zoom in / Zoom out buttons sit beside Fit graph.

## Layout, the Selected widget pane and the tutorial rail

The tool area (Author, **Selected widget**, Blueprint, Runtime, **Events**, Dependencies) takes about half the window by default. The Dockview layout
(divider position, active tab) is saved in the browser and restored on reload; a saved layout from an older Lab, or a corrupt one, is
ignored. **Reset layout** in the overflow menu goes back to the default. The tutorial rail is a docked column beside the workbench: it
never covers the header, menus or the Preview.

**Selected widget** explains one widget in one place: what the source declares for it (identity, config, slots, members,
diagnostics) next to its live State and Property values. Choose the widget with Inspect in the Preview, or in Blueprint or
Dependencies. Values open into a tree instead of being clipped; anything the Inspector snapshot left out (depth, entry or string
limits) is marked as such. Config shows the resolved value, with the authored one a click away when it differs. Dependencies opens on
Relations; the Graph is one click away.

**Events** lists what the running widgets emit, as it happens: time, Preview revision, widget, Event name and an expandable payload (the Survey emits `submitted` when you Submit valid answers). It also lists Method failures, labelled "Method failure" because they are not Events: the code, reason and message of a Method's latest failed call (a Submit with errors fails `submit()` with `invalid-method-result` / `answer-errors`), with its arguments or result in an expandable tree; Selected widget and Runtime show the same latest failure on the Method's row, and the next successful call clears it. A "Show" filter picks Events, Method failures or both. The declared Events of every widget type are in the Catalog and in the Selected widget declaration. The log records whenever the Preview is running, also while another tab is open (the Events tab shows how many entries arrived since you last looked), keeps the latest 500 entries and says when older ones were dropped; Pause, Clear, filters (widget, Event, only the selected widget) and a click on an entry's widget to select it are there too.

## Dependency Graph

`src/graph/` projects `@deviltea/widget-core/inspection` compile-time facts into a Lab-owned semantic
graph (widgets as visual clusters, State/Property/Method members as vertices, dependency
resolved/absent/invalid status as edges/reference stubs), then lays it out through ELK Layered and
renders it read-only through Vue Flow:

```text
inspection facts -> projectSemanticGraph() -> toElkGraph() -> ELK layout (Worker) -> toVueFlow()
```

Available even for an invalid Blueprint (compile-time facts only, no Runtime dependency). See
AGENTS.md's "Dependency Graph" and "Layout worker boundary" sections for the module map and the
generation-guarded async layout contract.
