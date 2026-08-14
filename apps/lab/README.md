# widget-lab

Private, never-published Widget Lab application shell for `@deviltea/widget-core` /
`@deviltea/widget-vue`: a workbench with a live JSON Source editor, an explicit Apply lifecycle, a
persistent Preview, and readonly Blueprint/Runtime/Dependency Graph inspectors.

See [AGENTS.md](AGENTS.md) for the architectural boundaries this app must keep (public-contract-only
consumption of `@deviltea/widget-core`/`@deviltea/widget-vue`, readonly inspectors, no
persistence/editor-domain state, sandbox fixtures vs. future showcases).

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
- **PikaCSS** (`@pikacss/unplugin-pikacss`) for the Lab's own visual language; Dockview's structural
  stylesheet is themed through a small custom theme (`src/styles/dockview-theme.css`) whose CSS
  variables derive from PikaCSS tokens (`pika.config.ts`); Vue Flow's own default theme CSS is not
  imported — only its structural `dist/style.css` is, so canvas visuals stay PikaCSS-token-driven.

## Commands

```bash
pnpm --filter widget-lab dev
pnpm --filter widget-lab build
pnpm --filter widget-lab typecheck
pnpm --filter widget-lab test
```

## Sandbox

`src/sandbox/` hosts a small, Lab-private `WidgetSystem` (Text/Counter/Section/Stack/Summary plugins,
the last demonstrating a cross-widget `registerDeps` dependency) with three preset source texts: a
fully valid interactive one, one that is intentionally semantically invalid (to demo diagnostics), and
one that exercises Blueprint recovery (an unresolved node and a raw-slot placement). These are dev
fixtures for this shell, not the "Interactive Survey" / "Product Prototype" showcases planned for a
later phase.

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
