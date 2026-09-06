# AGENTS.md

## Monorepo guide

This repository owns the DevilTea Widget project. It publishes the renderer-agnostic core from `packages/core` and the Vue adapter from `packages/vue`, hosts the private experimental DevTools boundary in `packages/devtools`, hosts the private Widget Lab application in `apps/lab`, and builds project documentation from `docs/site`.

Treat `@deviltea/widget-core` and `@deviltea/widget-vue` as independently releasable packages, but keep them in this repository because the Vue adapter and Lab intentionally integrate against the exact core workspace contract.
`@deviltea/widget-devtools` is currently private and experimental; its package name and publication status are not committed public API.


The project was split from `DevilTea/deviltea-labs` after the initial `0.0.1` releases. Historical decision logs referenced by migrated source remain authoritative in the original repository: core semantics are primarily `DevilTea/deviltea-labs#10`, Vue integration is primarily `DevilTea/deviltea-labs#13`, source/document work includes `#54`, and the current Lab redesign includes `#60`. Bare historical issue references in migrated comments refer to `DevilTea/deviltea-labs` unless a later comment explicitly names this repository.

## Commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test
pnpm build
pnpm check
```

`pnpm test:unit` runs the root Vitest configuration over `packages/**/src/**/*.unit.test.ts` and `apps/**/src/**/*.unit.test.ts`. Browser and built-Pages contracts are intentionally separate CI jobs.

## Releasing

Releases are driven locally: `pnpm release <package> <release>` bumps the package and opens its release pull request with auto-merge enabled, and `pnpm release:tag <package>` pushes the annotated tag after that pull request merges. Only the tag push triggers publishing, which happens exclusively in `publish.yml` via npm Trusted Publishing. Both commands push to `origin` and the second one publishes to npm, so never run them without an explicit instruction to release.

The npm Trusted Publisher configuration must name repository `DevilTea/widget` before the first post-split release. See `docs/migration/release-cutover.md`.

## Testing policy

- Test externally observable behavior with precise assertions; coverage percentage alone is not evidence of correctness.
- Keep core and Vue conformance tests colocated with runtime source as `*.unit.test.ts`.
- Keep Widget Lab unit tests colocated under `apps/lab/src`; the Lab is private and excluded from package coverage thresholds.
- Keep experimental DevTools protocol/agent tests colocated under `packages/devtools/src`; they run in the unit suite but are excluded from the published core/Vue coverage threshold until that package boundary is intentionally promoted.
- Keep Playwright browser and Pages-navigation suites separate from the fast unit suite.
- The root V8 coverage report explicitly covers published runtime source in `packages/core` and `packages/vue`. Its thresholds preserve the rounded-down Widget-only baseline measured at the repository split (branches 82%, functions 95%, lines 88%, statements 89%) rather than inheriting the old cross-package 90% aggregate gate.

## Conventions

- This repository is ESM (`"type": "module"`) and uses pnpm 10 with versions managed by `pnpm-workspace.yaml` catalogs.
- `@deviltea/eslint-config` and `@deviltea/tsconfig` are external DevilTea tooling dependencies owned by `DevilTea/deviltea-labs`; do not copy their implementation into this repository.
- Follow the nearest package/app `AGENTS.md` for component-specific constraints. `CLAUDE.md` mirrors it by reference for compatible agent tooling.
- Do not hand-edit generated `dist/`, generated PikaCSS files, Playwright output, or TypeScript build-info files.
- Before handoff, run the narrowest relevant test first, then lint/typecheck/build or the full `pnpm check` when practical.
