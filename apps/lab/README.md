# widget-lab

Private, never-published Widget Lab application shell for `@deviltea/widget-core` /
`@deviltea/widget-vue`: a workbench with a live JSON Source editor, an explicit Apply lifecycle, a
persistent Preview, and a readonly Blueprint Inspector.

See [AGENTS.md](AGENTS.md) for the architectural boundaries this app must keep (public-contract-only
consumption of `@deviltea/widget-core`/`@deviltea/widget-vue`, readonly inspectors, no
persistence/editor-domain state, sandbox fixtures vs. future showcases).

## Stack

- **Vite + Vue 3 + TypeScript**, ESM.
- **`modern-monaco`** (pinned exact version) for the Source panel — one JSON document, no CDN
  dependency (local `tm-themes`/`tm-grammars` assets), isolated behind `use-monaco-editor.ts` /
  `MonacoJsonEditor.vue`.
- **`dockview-vue`** for the workbench layout (tabs/resize/docking) only — never the semantic model.
- **PikaCSS** (`@pikacss/unplugin-pikacss`) for the Lab's own visual language; Dockview's structural
  stylesheet is themed through a small custom theme (`src/styles/dockview-theme.css`) whose CSS
  variables derive from PikaCSS tokens (`pika.config.ts`).

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
