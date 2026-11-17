# AGENTS.md

## Monorepo guide

This repository owns the DevilTea Widget project. It publishes the renderer-agnostic core from `packages/core`, the read-only Inspector protocol/client/agent boundary from `packages/inspector`, and the Vue adapter from `packages/vue`, hosts the private Widget Lab application in `apps/lab`, and builds project documentation from `docs/site`.

`@deviltea/widget-core`, `@deviltea/widget-inspector`, and `@deviltea/widget-vue` are released together under one version: all three always carry the same `version`, and one release publishes all three from one tag, even when a package has no changes. They are not independently releasable, and they live in this repository because the Vue adapter, Inspector, and Lab intentionally integrate against the exact core workspace contract. The private Lab (`apps/lab`) is not part of the release.
`@deviltea/widget-inspector` is the single published Inspector boundary (accepted in Discussion #12 C5, replacing the former private `@deviltea/widget-devtools`). It is `0.x` experimental with a protocol-major guarantee only: while on `0.x` an npm minor release (which is a release of every package) may break its TypeScript API, and cross-realm compatibility is governed by the protocol `major.minor`. `@deviltea/widget-core` is its peer dependency, and `@deviltea/widget-vue` never stamps DOM attributes.

`@deviltea/widget-vue` and `@deviltea/widget-inspector` declare `@deviltea/widget-core` as `peerDependencies` with `workspace:^` (published as `^<version>`, so a dependent at `0.1.1` accepts Core `>=0.1.1 <0.2.0`), with a workspace dev dependency for local work. Core identifies its own plugins, Blueprints and Runtimes by module-private brands, so an application must load exactly one Core instance: dependents, plugin libraries and renderer libraries must depend on Core as a peer and must never bundle it. All three packages declare `engines.node` `>=22.14.0` and `sideEffects: false`.


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

`pnpm test:unit` runs the root Vitest configuration over `packages/**/src/**/*.unit.test.ts`, `apps/**/src/**/*.unit.test.ts`, and `scripts/**/*.unit.test.ts`, as two Vitest projects (`packages`, covering `packages/` and `scripts/`, and `lab`, covering `apps/`) that share the root plugins, coverage and settings; only `lab` loads the Lab's Nuxt UI plugin and setup file. Browser and built-Pages contracts are intentionally separate CI jobs.

## Releasing

The three published packages are released together. Releases are driven locally: `pnpm release <release>` (`patch`, `minor`, `major`, `prerelease` or an explicit version) bumps `@deviltea/widget-core`, `@deviltea/widget-inspector` and `@deviltea/widget-vue` to the same new version on the branch `release/v<version>`, commits `chore: release v<version>`, pushes it and opens one release pull request (merge it yourself once the required checks pass), and `pnpm release:tag` (no argument) pushes the one annotated tag `v<version>` on merged `main`. Only the tag push triggers publishing, which happens exclusively in `publish.yml` via npm Trusted Publishing. Both commands push to `origin` and the second one publishes to npm, so never run them without an explicit instruction to release. The per-package tags up to `widget-core@0.1.0`, `widget-inspector@0.1.0` and `widget-vue@0.1.0` stay as history; no new per-package tags are made, and the release scripts treat them as "already released" for their version.

`publish.yml` runs on `v*` tags. It verifies that the tag commit is on `main` and that the tag equals the version of all three packages, runs `pnpm check`, packs the three packages (and checks each packed manifest, in particular the `^<version>` Core peer range), and publishes Core first, then the Inspector and the Vue adapter (`scripts/release-publish.ts`). A package whose exact version is already on the registry is skipped with a log line, so re-running the workflow, or its job, after a partial failure finishes the release; the registry is asked about the exact version, and an unclear answer fails the run before anything is published. A dependent is only published after Core was published or found published, and the first failure stops the run. Prerelease versions go to the `next` dist-tag, never `latest`.

Version policy: the packages share one version, and `pnpm check` (`check:versions`) fails when they differ. While `0.x`, a breaking change in any package bumps the **minor** (`0.N.0`) of all of them, and a patch release must not contain a breaking change in any package. A package without changes is still published at the new version. The dependents declare `@deviltea/widget-core` as `workspace:^`, which packs as `^<version>`: a dependent at `0.1.1` accepts Core `>=0.1.1 <0.2.0`, so upgrade the three packages together. The release scripts and `pnpm check` refuse a `0.0.x` version, where that caret would pin one exact Core patch. `@deviltea/widget-inspector` keeps its own rule (experimental, protocol-major guarantee only), see its `AGENTS.md`.

The npm Trusted Publisher configuration must name repository `DevilTea/widget` and workflow `publish.yml` for every published package (`@deviltea/widget-core`, `@deviltea/widget-inspector`, `@deviltea/widget-vue`); releases from this repository depend on it, and the workflow file name must not change. A `0.0.0` placeholder of `@deviltea/widget-inspector` is published manually only to enable Trusted Publishing; it is not a release, and real releases always go through `pnpm release`, `pnpm release:tag`, and `publish.yml`. See `docs/migration/release-cutover.md`.

## Testing policy

- Test externally observable behavior with precise assertions; coverage percentage alone is not evidence of correctness.
- Keep core and Vue conformance tests colocated with runtime source as `*.unit.test.ts`.
- Keep Widget Lab unit tests colocated under `apps/lab/src`; the Lab is private and excluded from package coverage thresholds.
- Keep Inspector protocol/agent tests colocated under `packages/inspector/src`. Browser contracts for the inspect-anchor attributes live in `apps/lab/e2e` and use real `@deviltea/widget-vue` renderers.
- Documentation code samples are tested by `scripts/docs-samples.unit.test.ts` (part of `pnpm test:unit`; run `pnpm build` first, as `pnpm check` does). Mark a sample with `<!-- sample: <name> <kind> -->` on the line directly above its `ts` fence (a unique `[\w.-]+` name; the colon is optional). `kind` is `before` (written against the published 0.0.6; only checked to be marked, never compiled), `after` (type-checked under `tsc --strict` against the built packages through their `exports`), `run` (type-checked and executed) or `skip` (not compiled). For `run`, a comment that trails a statement which prints, or sits on the lines directly below one, is its expected output and must match what is printed: the printed text, optionally followed by `: `, by `, ` and a lowercase word, or by ` (` and a remark (`// true: the Method completed`), where a label ending in `:` or `->` may be left out (`// { ok: true, value: ... }`; `...` matches any text). Put a remark on its own line above the statement, or after a blank line when it follows one. Not verified: comments on statements that print nothing (return values), and fences that are not `ts`. A `ts` fence without a marker fails, except in the documents whose count is recorded in the test's `expectations`; that count is exact, so lower it when you mark a fence. The test's `exemptComments` (empty today) can exempt a comment on a printing statement that is not output.
- Keep Playwright browser and Pages-navigation suites separate from the fast unit suite.
- The root V8 coverage report explicitly covers published runtime source in `packages/core`, `packages/inspector` (excluding its test-only `test-fixture.ts`), and `packages/vue`. Its thresholds preserve the rounded-down Widget-only baseline measured at the repository split (branches 82%, functions 95%, lines 88%, statements 89%) rather than inheriting the old cross-package 90% aggregate gate.

## Conventions

- This repository is ESM (`"type": "module"`) and uses pnpm 10 with versions managed by `pnpm-workspace.yaml` catalogs.
- `@deviltea/eslint-config` and `@deviltea/tsconfig` are external DevilTea tooling dependencies owned by `DevilTea/deviltea-labs`; do not copy their implementation into this repository.
- Follow the nearest package/app `AGENTS.md` for component-specific constraints. `CLAUDE.md` mirrors it by reference for compatible agent tooling.
- Do not hand-edit generated `dist/`, generated PikaCSS files, Playwright output, or TypeScript build-info files.
- Before handoff, run the narrowest relevant test first, then lint/typecheck/build or the full `pnpm check` when practical.
