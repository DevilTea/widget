# AGENTS.md — @deviltea/widget-core

## Scope and layout

Renderer-agnostic widget composition core: `WidgetPlugin` builder, `WidgetSystem`, `WidgetSystemBlueprint` (compilation/recovery/diagnostics), and `WidgetSystemRuntime` (alien-signals-backed execution). The normative semantic contract lives in GitHub issue #10 ("Widget composition core architecture — canonical decision log"); the consolidated implementation handoff comment plus the accepted amendments are authoritative over any code comment or doc here.

- `src/index.ts` — public entry; only export the public contract surface.
- `src/**/*.unit.test.ts` — colocated Vitest unit tests (run by the root config too).
- `tsdown.config.ts` — ESM build with declaration output from `tsconfig.package.json`.

## Commands

```bash
pnpm test        # vitest run for this package
pnpm typecheck   # package + tests tsconfig
pnpm build       # tsdown (includes publint)
```

## Implementation rules

- Do not resolve implementation difficulty by silently restoring a design that issue #10 marks discarded/superseded; a genuine semantic change requires a new amendment on issue #10 first.
- `alien-signals` owns reactive graph/lazy/cache/batch mechanics; this package only implements observable semantics on top of it. Upgrading `alien-signals` requires rerunning the full conformance suite; upstream behavior change is a compatibility conflict, not permission to alter public Runtime semantics.
- Core stays minimal: editor operations, persistence envelopes/versioning/migration, metadata, and renderer/UI concerns stay out of this package.
- All framework-owned semantic callbacks are synchronous; a returned Promise/thenable is an implementation contract violation, not an Issue.

## Unit-test standard

- Follow the conformance test matrix recorded in issue #10: test public semantics and public type behavior, not internal algorithms (no SCC-algorithm, registry-shape, signal-topology, or message-wording assertions).
- Keep the regression cases the matrix marks as must-preserve (optional-only-suppresses-cardinality-0, method-only SCC validity, NaN/±0 strictness, batch non-rollback, post-dispose error surface, etc.).
