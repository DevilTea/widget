# AGENTS.md

## Monorepo guide

This repository owns the DevilTea Widget project. It publishes the renderer-agnostic core from `packages/core`, the read-only Inspector protocol/client/agent boundary from `packages/inspector`, and the Vue adapter from `packages/vue`, hosts the private Widget Lab application in `apps/lab`, and builds project documentation from `docs/site`.

Treat `@deviltea/widget-core`, `@deviltea/widget-inspector`, and `@deviltea/widget-vue` as independently releasable packages, but keep them in this repository because the Vue adapter, Inspector, and Lab intentionally integrate against the exact core workspace contract.
`@deviltea/widget-inspector` is the single published Inspector boundary (accepted in Discussion #12 C5, replacing the former private `@deviltea/widget-devtools`). It is `0.x` experimental with a protocol-major guarantee only: while on `0.x` an npm minor release may break the TypeScript API, and cross-realm compatibility is governed by the protocol `major.minor`. `@deviltea/widget-core` is its peer dependency, and `@deviltea/widget-vue` never stamps DOM attributes.


The project was split from `DevilTea/deviltea-labs` after the initial `0.0.1` releases. Current long-lived Widget architecture is owned by `DevilTea/widget` Discussion #12 ("Widget: canonical design discussion"), which migrated the relevant historical `deviltea-labs` decision logs into this repository. Treat `deviltea-labs` as historical provenance only; do not open or record new Widget architecture decisions there.

Bare historical issue/comment references inside migrated source and Discussion #12 replies may still refer to their original `DevilTea/deviltea-labs` numbers. Resolve current authority through Discussion #12 and current `DevilTea/widget` Issues/Discussions before making semantic changes.

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

Releases are driven locally: `pnpm release <package> <release>` bumps the package and opens its release pull request (merge it yourself once the required checks pass), and `pnpm release:tag <package>` pushes the annotated tag after that pull request merges. Only the tag push triggers publishing, which happens exclusively in `publish.yml` via npm Trusted Publishing. Both commands push to `origin` and the second one publishes to npm, so never run them without an explicit instruction to release.

The npm Trusted Publisher configuration must name repository `DevilTea/widget` and workflow `publish.yml` for every published package (`@deviltea/widget-core`, `@deviltea/widget-inspector`, `@deviltea/widget-vue`); releases from this repository depend on it. A `0.0.0` placeholder of `@deviltea/widget-inspector` is published manually only to enable Trusted Publishing; it is not a release, and real releases always go through `pnpm release`, `pnpm release:tag`, and `publish.yml`. See `docs/migration/release-cutover.md`.

## Testing policy

- Test externally observable behavior with precise assertions; coverage percentage alone is not evidence of correctness.
- Keep core and Vue conformance tests colocated with runtime source as `*.unit.test.ts`.
- Keep Widget Lab unit tests colocated under `apps/lab/src`; the Lab is private and excluded from package coverage thresholds.
- Keep Inspector protocol/agent tests colocated under `packages/inspector/src`. Browser contracts for the inspect-anchor attributes live in `apps/lab/e2e` and use real `@deviltea/widget-vue` renderers.
- Keep Playwright browser and Pages-navigation suites separate from the fast unit suite.
- The root V8 coverage report explicitly covers published runtime source in `packages/core`, `packages/inspector` (excluding its test-only `test-fixture.ts`), and `packages/vue`. Its thresholds preserve the rounded-down Widget-only baseline measured at the repository split (branches 82%, functions 95%, lines 88%, statements 89%) rather than inheriting the old cross-package 90% aggregate gate.

## Conventions

- This repository is ESM (`"type": "module"`) and uses pnpm 10 with versions managed by `pnpm-workspace.yaml` catalogs.
- `@deviltea/eslint-config` and `@deviltea/tsconfig` are external DevilTea tooling dependencies owned by `DevilTea/deviltea-labs`; do not copy their implementation into this repository.
- Follow the nearest package/app `AGENTS.md` for component-specific constraints. `CLAUDE.md` mirrors it by reference for compatible agent tooling.
- Do not hand-edit generated `dist/`, generated PikaCSS files, Playwright output, or TypeScript build-info files.
- Before handoff, run the narrowest relevant test first, then lint/typecheck/build or the full `pnpm check` when practical.
