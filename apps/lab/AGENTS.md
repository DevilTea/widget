# AGENTS.md — widget-lab

## Scope and layout

Private, never-published workspace application: the interactive Widget Lab shell — workbench, live
JSON source editing with an explicit Apply lifecycle, Preview, and a readonly Blueprint Inspector —
over `@deviltea/widget-core` / `@deviltea/widget-vue`. Normative source: GitHub issue #13's Widget Lab
Phase 4 comments (package/app boundaries, implementation stack, default workbench layout, Blueprint
Inspector model, inspector panel interaction contract, Source Apply lifecycle, readonly-inspector
consumer updates). Issue #10 (core) and issue #13's earlier Vue-integration checkpoints remain the
semantic authority this app never reinterprets.

- `src/lab/` — framework-agnostic, unit-tested Apply lifecycle logic: `LabSession` (draft/active
  snapshot state machine, `types.ts`) and the shared cross-inspector focus store (`focus.ts`). No Vue
  import here on purpose — this is the regression-worthy core, independently testable.
- `src/composables/use-lab-store.ts` — the one place that bridges `LabSession`/focus store into Vue
  `computed()` refs and supplies the `LabSessionHooks` seam (`detachPreview`/`mountPreview`) that
  guarantees unmount-before-dispose ordering via `nextTick()`.
- `src/composables/use-monaco-editor.ts` + `src/components/editor/MonacoJsonEditor.vue` — the entire
  `modern-monaco` integration surface. Nothing else in this app imports `modern-monaco`.
- `src/components/` — the app shell: `LabHeader.vue` (compact header: preset, status, Apply),
  `Workbench.vue` (`dockview-vue` two-column default layout), `panels/*` (Source/Blueprint/
  Runtime/Graph tabs), `preview/PreviewPanel.vue`, `blueprint/*` (the Blueprint Inspector's tree +
  selected-node detail + issue list).
- `src/sandbox/` — small, Lab-private dev fixtures (plugins, a `WidgetSystem`, a
  `createWidgetVueRenderer` registry, and preset source texts). **Not** the "Interactive Survey" /
  "Product Prototype" showcases named in issue #13 Checkpoint A — those are a later phase. Sandbox
  fixtures exist only to exercise this shell and must stay small.
- `pika.config.ts` — the Lab's small PikaCSS token set (`variables.definitions`, safe-listed so the
  hand-authored `src/styles/dockview-theme.css` can reference them via plain `var()`).
- `src/**/*.unit.test.ts` — colocated Vitest unit tests for `src/lab/` and `src/sandbox/` (run by both
  this app's own `vitest.config.ts` and the root config). UI/editor/workbench components are not unit
  tested this phase (see "Testing" below).

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
gate already protects. `src/lab/` and `src/sandbox/` — the actual regression-worthy logic — are
unit-tested regardless; that value does not depend on being counted by the coverage gate.
