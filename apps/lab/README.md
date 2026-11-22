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
test-only fixtures for this shell, hidden from the Examples menu. Six showcases are listed, all registered in
`src/showcases/registry.ts` (which also registers the hidden `sandbox`): "Interactive Survey" (the default),
"Trip budget splitter", "Quote rules shared by browser and backend", "Onboarding wizard with an Events log", "Legacy document repair" and "One document, two renderer packs". Open a hidden fixture with the `?showcase=<id>` URL parameter, e.g. `?showcase=sandbox`; a
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
| Read-only Methods read by a Property | `Currency.convert` (amount to base cents) and `Currency.roundTransfer` (reads State `roundStep`) | Relations: a Method tagged read-only, with no W (writes) and no E (emits) badge; Selected widget: the Methods list, where it is tagged read-only too |
| Laziness | `Expense.breakdown` and `Person.ledger` are read only while a viewer opens them | Runtime / Selected widget: `Never evaluated` until opened. The Lab cannot show who is subscribed, only whether a Property was ever evaluated and its latest result |
| `resetState` | "Reset this expense" (`widget.resetState()`) and "Start over" (`runtime.resetState()`, after which the root renderer (`TripRootRenderer.vue`) writes the interface language back so the page does not switch language), asked of the host (`renderers/reset-host.ts`) because `useWidget()` exposes no Runtime | Preview; the State values in Selected widget go back to the authored ones |
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
| The isolated-exception receiver | `VolumeDiscount` has a deliberate defect: below its first tier its `compute` throws. Core isolates the exception, and the Preview installs `setIsolatedErrorHandler` and lists it | Preset "Buggy rule": set the A5 flyers quantity to 50 (with the poster that is 52 pieces, below the first tier, 100; any flyers quantity up to 97 does it). The page keeps the last amounts and says so; "Isolated exceptions" names the rule. The Lab cannot show it: Runtime and Selected widget keep the Property's last completed value |
| Property chains and `resetState` | `Item.line` -> `Quote.subtotalCents` -> the rules' `adjustment` -> `Quote.taxableCents` -> `SalesTax.adjustment` -> `Quote.quote`; "Start over" is `runtime.resetState()` | Dependencies > Relations / Graph; the Preview |

The presets are `quote-default`, `quote-invalid` and `quote-buggy-rule`. The tutorial rail has a tour for the showcase (en and zh-TW).
The showcase follows the showcase host contract (it reads the host's locale and light/dark theme and the Inspect anchor) and styles
itself with its own `--quote-*` tokens. It is the first showcase with extra packages (`valibot` and `@valibot/to-json-schema`, in its
`allowed-packages.json`) and the first with a Web Worker (its file is inside the showcase directory, as the isolation guard requires).

### Onboarding wizard with an Events log

A new-member onboarding for a community workshop ("Tidepool Makers"): your details, interests, a three-rule safety briefing and
an induction slot to book. The widgets are `Onboarding` (root), `AccountStep`, `InterestsStep`, `SafetyStep` and `InductionStep`;
the plugins are in `src/showcases/onboarding/plugins/`. The page around the widgets is the *host*: it listens to the widgets'
Events and does the waiting for a simulated booking office. What it shows, and where in the Lab:

| Core feature | In the showcase | Where to see it |
|---|---|---|
| Declared and emitted Events | `Onboarding` declares `stepChanged` and `completed`, `InductionStep` declares `slotRequested`, `slotConfirmed`, `slotDeclined` and `slotCancelled`; each is emitted by a Method that lists it in `emits`, with an object payload | Events tab: each Event with its widget, revision and expandable payload; Selected widget / Catalog: the declared Events with their descriptions |
| A host listener | `renderers/onboarding-host.ts` subscribes with `runtime.getWidget(id).events.<name>.subscribe()` (a widget cannot subscribe to an Event): it moves focus to the heading of the step that was entered, asks the office on `slotRequested`, and queues a welcome message on `completed` | Preview: "What this page did about the Events" lists what the host did; the Events tab lists the same Events from outside |
| Async work kept at the host | `requestSlot(date, time)` writes the request into State with a ticket and emits `slotRequested`, then returns; the host waits for the office and calls `settleBooking(ticket, outcome)`, which applies an answer only while its ticket is the newest. A callback's `emit` and `deps` stop working when it returns, so nothing inside Core could wait | Preview > Book your induction: the status says the request is with the office, the office desk lists it; the Events tab shows `slotRequested` first and `slotConfirmed` (or `slotDeclined`: the office always declines 17:00) when the host settles |
| Cancellation and a stale answer | `cancelBooking()` emits `slotCancelled`; the host recalls the request. With "The office can recall a cancelled request" switched off, the late answer still arrives and `settleBooking` ignores it (it returns `false`, writes and emits nothing). A showcase switch and an unmount cancel every pending request | Preview: the two switches on the office desk and the activity list ("ignored the answer: ticket #1 is no longer the newest") |
| Method argument validation | `goTo(index)` and `requestSlot(date, time)` check their arguments in `validateArgs` (with the config for the offered days and times): `invalid-method-arguments`, and `execute` never runs. What needs the Blueprint or another widget (`no-such-step`, `step-locked`, a request already waiting) is checked in `execute`: `invalid-method-result` | Preview: "Go to step number" (type 1.5, 9, 2) and the date box of the induction; the page's one alert shows the Core code and reason |
| Method failures and diagnostics | a refused move writes and emits nothing; its diagnostic is the Method's latest failure | Events tab: "Method failure" entries (not Events); Selected widget / Runtime: the Method's row says "Last call failed" with code, reason and message, and the next successful call clears it |
| Read-only and writing Methods | `Onboarding.canEnter(index)` neither writes State nor emits, so Core derives it as read-only (and `goTo` and `next` call it, so they lock the same steps); `next`, `back`, `goTo`, `finish` and the induction's three Methods write and emit | Dependencies > Relations: focus a Method (Runtime > a Property row, then the Method in Relations): `canEnter` has no W and no E badge, the others have both |

The presets are `onboarding-default`, `onboarding-ready-to-book` (opens on the induction with the first three steps done),
`onboarding-deep-link` (opens on the last step with nothing filled in: Finish and a jump forward are refused, going back works) and
`onboarding-invalid` (four located config and structure diagnostics). The tutorial rail has a tour for the showcase (en and zh-TW).
The showcase follows the showcase host contract (it reads the host's locale and light/dark theme and the Inspect anchor) and styles
itself with its own `--onboarding-*` tokens. The booking office is not a network request: its answer is a function of the slot and
its timing is a `Scheduler` the host is given (timers in the Preview, a hand-fired one in tests, so no test sleeps).

### Legacy document repair

A notice-board app (now at format v3) opens drafts that older versions saved. **Core does not migrate, version, repair or quarantine a stored document:
the repair is the application's policy, written in the showcase's own code, and nothing is persisted** (the drafts are in-memory fixtures; the Lab shell
gains no persistence or migration). There are two Systems in `src/showcases/document-repair/`: the repair desk (`RepairDesk` and `SavedDraft`, the Lab's own
document) and the notice board (`Board` and `Notice`, the app's format, compiled from each draft's stored source). What it shows, and where in the Lab:

| Core feature | In the showcase | Where to see it |
|---|---|---|
| Diagnostics located in a stored document | `SavedDraft.findings` compiles the stored source with the notice board System inside a Property and lists each diagnostic with `blueprint.getSourcePath(node)` (a valid `SourcePatch` path), plus the recovered nodes: unresolved ones keep their `id` and `type` as hints and an undeclared slot is a `raw-slot` placement | Preview: "The stored draft, as Core sees it"; Selected widget: the `findings` Property |
| Recovery of an invalid document | an unknown type, an undeclared slot, an unexpected widget field, a repeated id and a node without an id are all reported, and the tree stays navigable | Blueprint and Preview (stored draft details) |
| The application's repair plan | `planRepair(source, savedWith)` returns ordered steps, each a `SourcePatch` that starts with `test` guards; it is policy, computed again from the current snapshot after every commit | Preview: the plan of an open draft; Selected widget: the `plan` Property |
| `WidgetDocument` and `SourcePatch` | "Open in the app" is `createWidgetDocument` on a copy of the stored source (Core never mutates a source, but it keeps the object it is given by reference, so the app's own model must not be handed over); "Apply next step" is `applyPatch(step.patch, { expectedRevision })`, shown as `{ ok, changed }` or the failure code and operation index; a listener logs every commit | Preview: the revision, the last result and the listener log |
| `document-revision-conflict` | "Another editor saves" changes the same document without the app reading it, so the app's next step carries a stale `expectedRevision`: Core applies nothing and says `expectedRevision` and `actualRevision`; "Re-read and re-plan" continues | Preview: the page's one alert and the result line |
| All-or-nothing validity | only a valid Blueprint has `createRuntime`: the repaired `draft-v1` previews as a board (a Runtime of the notice board System in a nested widget-vue root) and exports as JSON, the `draft-poll` draft (an unknown `Poll` the app has no rule for) stays invalid and never gets a Runtime | Preview: "Preview the repaired board", "Export" |

The presets are `repair-default` (four drafts: saved with 1.x, 2.x, 3.x, and 2.x with a `Poll`) and `repair-invalid` (four located config diagnostics in the desk's own
document). The tutorial rail has a tour for the showcase (en and zh-TW). The showcase follows the showcase host contract (it reads the host's locale and light/dark
theme and the Inspect anchor) and styles itself with its own `--repair-*` tokens.

### One document, two renderer packs

A small workspace settings page: **one Document and one Runtime drawn by two renderer packs**, hand-written controls and a component library (Nuxt UI), one at a time or
side by side. The pack is a choice of the host, not widget State, so switching mounts the other pack's renderers over the same Runtime and every value stays. The
showcase lives in `src/showcases/renderer-packs/`; its Nuxt UI pack runs its **own** Nuxt UI instance (a nested Vue app, its own Tailwind entry, bundled icons, no
network) inside the Preview frame. What it shows, and where in the Lab:

| Core feature | In the showcase | Where to see it |
|---|---|---|
| One System, two renderer registries | both packs call `createWidgetVueRenderer` for the same eight plugin types and mount over the same Runtime; switching never disposes it | Preview: the renderer pack chooser; Runtime: the State, which holds no pack |
| Named providers, no nearest-ancestor lookup | a field names its `Appearance` (`config.appearance`) and reads `density` through `dep.widget(id)`; a `DangerAction` names its `Notifier`; a name that matches no widget of that type is a located structure diagnostic | Dependencies (Relations); the "Draft with mistakes" example |
| A Method that invokes another widget's Method | `DangerAction.confirm()` invokes the Notifier's `notify`, closes the question and emits `confirmed`; `notify` writes State and emits `notified` | Events tab (both Events, newest first); Relations marks `confirm` W and E |
| Refused calls as diagnostics | `confirm()` without `ask()`, `ask()` twice and `dismiss()` of an unknown id write and emit nothing and are the Method's latest diagnostic | Selected widget / Runtime: the Method's row |
| Overlays contained in the Preview | the confirmation is a native `<dialog>` (hand-written) or a `UModal` teleported into the Nuxt UI pack's own root; the Lab header stays operable while it is open and focus stays inside it | Preview: press "Archive workspace", then open the Examples menu |

The presets are `packs-default` and `packs-invalid` (four located diagnostics). The tutorial rail has a tour for the showcase (en and zh-TW). The showcase follows the
showcase host contract (it reads the host's locale and light/dark theme and the Inspect anchor, which both packs stamp) and styles itself with its own `--packs-*` tokens
(hand-written pack) and `--ui-*` values on the Nuxt UI pack's root.

## Header, editing feedback and Undo

The header is one row from 1280px up: the **Examples** menu (showcase and preset; it always names the showcase and the
last loaded preset, or "edited" once the document changes), two plain-language status chips (the document is *Valid* or
has *N problems*, a button that opens the Problems list; the preview is *up to date* or *shows the last valid version*, with
revisions and linkage in an info popover, which also holds the JSON draft, Source JSON compatibility, Blueprint status and recovery facts;
while the JSON draft has unapplied edits a third chip says *Unapplied changes* and the preview chip *shows the last applied version*),
the edit actions **Apply / Revert / Undo / Format**, and an overflow menu with Tutorial, Theme, **Lab language**, **Reset layout** and a
Developer submenu (Implementation, Document Tools).

- **Apply** is also Cmd/Ctrl+Enter, inside the Monaco editor and from any focused tab; its tooltip shows the keys.
- **Revert** discards the unapplied editor draft. **Undo** ("Undo last change") restores the previous source as a
  *new* Document revision (through the same commit path as Apply, up to 20 steps back); it is unavailable while an
  unapplied draft exists, and a tooltip says why for every disabled action.
- Loading a preset or switching showcase over an unapplied draft asks first (Keep editing / Discard changes).
- After an Apply that leaves problems, the Author JSON view lists them under the editor (Core's code and message verbatim,
  or the JSON syntax error); each row jumps to its place in the JSON, which also gets error squiggles. The preview shows a
  plain-language notice with **Show problems** while it still shows the last working version.

## Editing a widget's config (Structure) and what the Lab says when something fails

- **Author > Structure** edits the selected widget's config with controls that follow the plugin's config JSON Schema: a switch for a boolean, a
  number box (Core checks the limits), a list for an enum, a text box for a string, and Add / Remove for optional fields and list items where the schema allows
  them. Author opens on Structure. Every change goes through the same Document commit as Apply (Undo, the status chips and Problems keep working). While
  the JSON view has an unapplied draft, Structure says so above the fields and locks them until the draft is applied or discarded. Without a schema, values
  are typed by what they hold and anything else is edited as JSON.
- Problems lists the several diagnostics Core reports for one evaluation cycle as one entry that expands to Core's own diagnostics.
- If the Preview frame cannot load, the Preview pane says so with the cause and a **Try again** button, and the header chip reads "Preview failed to load".
- Graph: an always-visible key explains the badges, the line styles and the direction of an edge, edge labels appear on hover, and Zoom in / Zoom out buttons sit beside Fit graph. Cards are spread out, edges are Bezier curves that pass between the cards, and every edge ends in an arrowhead on the member it depends on (`A → B` means A depends on B: the Relations view lists B under "Depends on" for A and A under "Used by" for B). While a widget or member is selected, its edges turn blue and are tagged "Depends on #x" (they leave it) or "Used by #x" (they arrive at it), every other edge fades, and a tag with no room is left out (Relations has the full list).

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

ELK only places the cards and finds the corridor each long edge uses between the layers (generous spacing, top to
bottom); the canvas draws every edge itself as cubic Bezier curves through those points, with the arrowhead on the
member the edge's owner depends on.

Available even for an invalid Blueprint (compile-time facts only, no Runtime dependency). See
AGENTS.md's "Dependency Graph" and "Layout worker boundary" sections for the module map and the
generation-guarded async layout contract.
