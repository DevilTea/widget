# Release cutover

`@deviltea/widget-core`, `@deviltea/widget-inspector`, `@deviltea/widget-vue`, and `@deviltea/widget-docs-generator` are released from `DevilTea/widget`, all four together under one version. The documentation generator joined the release in `0.4.0` (Discussion #12 amendment "`@deviltea/widget-docs-generator` is a published package"); before that it was the private `@deviltea/widget-skills`.

## Required external cutover

Each npm package's Trusted Publisher must name repository `DevilTea/widget`, workflow `publish.yml`, owner `DevilTea` (the core and Vue publishers originally named `DevilTea/deviltea-labs`). Do not use a long-lived npm token as a fallback.

### `@deviltea/widget-inspector` placeholder

npm can only attach a Trusted Publisher to a package that already exists. Publish a `0.0.0` placeholder of `@deviltea/widget-inspector` manually once, solely to create the package, then configure its Trusted Publisher (repository `DevilTea/widget`, workflow `publish.yml`). The placeholder is not a release: it was published manually before the first real release. The first real releases were `0.0.3` and `0.0.4` (tags `widget-inspector@0.0.3` and `widget-inspector@0.0.4`), the next one was `0.1.0` (tag `widget-inspector@0.1.0`), and npm also holds `0.0.0-stage` and `0.0.0`. Every real release goes through `publish.yml` only.

### `@deviltea/widget-docs-generator` placeholder

The same applies to the documentation generator. Before the first release that contains it (`0.4.0`), the owner publishes a `0.0.0` placeholder of `@deviltea/widget-docs-generator` manually once, solely to create the package, and configures its Trusted Publisher (repository `DevilTea/widget`, workflow `publish.yml`). The placeholder is not a release. Without it, the publish run of `v0.4.0` stops before it publishes anything: before the first `npm publish`, `scripts/release-publish.ts` asks the registry about all four packages, and a package that does not exist at all (its package document answers `404`) fails the run with an error that names it and points here, because Trusted Publishing cannot create a package. Publish the placeholder, configure the Trusted Publisher, then re-run the workflow. The registry caches package documents, so a re-run right after the placeholder appears may still see the old `404` and stop again; wait a few minutes and re-run.

## Version policy and release order

- The four packages always carry the same version. `@deviltea/widget-core`, `@deviltea/widget-inspector`, and `@deviltea/widget-vue` were released one package at a time up to `0.1.0` (three release pull requests, three tags, three publish runs); from the release after `0.1.0` they are released together, and `@deviltea/widget-docs-generator` joins them from `0.4.0`. A package without changes is still published at the new version. `pnpm check` fails when the four `version` fields differ, and the private Lab (`apps/lab`) is not part of the release.
- While the packages are `0.x`, a breaking change in any package bumps the **minor** (`0.N.0`) of all of them, and a patch release must not contain a breaking change in any package. `@deviltea/widget-inspector` is additionally experimental with a protocol-major guarantee only (see its `AGENTS.md`).
- `@deviltea/widget-vue`, `@deviltea/widget-inspector`, and `@deviltea/widget-docs-generator` declare `@deviltea/widget-core` as `peerDependencies` with `workspace:^`, which publishes as `^<version>`. Under one version that means a dependent at `0.1.1` accepts Core `>=0.1.1 <0.2.0`: it works with Core's later patches, not with Core `0.1.0`, so the packages are upgraded together.
- A caret on a `0.0.x` Core is an exact pin (`^0.0.6` is `0.0.6`), so the release scripts and `pnpm check` refuse a `0.0.x` version.
- Core is published **first**, then the Inspector, the Vue adapter and the documentation generator, so a dependent's published peer range never points at a Core version that is not on npm yet. The publish workflow enforces the order, so there is no manual wait between packages.
- Consumers and plugin or renderer libraries must depend on Core as a peer dependency too, so that exactly one Core instance exists in an application (Core identifies its own objects by module-private brands, and an object from a second copy is rejected as foreign).
- All four packages declare `engines.node` `>=22.14.0` and `sideEffects: false`.

## Release flow

1. Start from a clean, up-to-date `main`.
2. Run `pnpm release <patch|minor|major|prerelease|version>`. It checks that the four packages share one version, bumps all of them to the same new version on `release/v<version>`, commits `chore: release v<version>`, pushes the branch, and opens one pull request.
3. Merge the pull request only after its required checks pass.
4. After the pull request merges, run `pnpm release:tag`. It pushes the annotated tag `v<version>` on merged `main`, and refuses when `v<version>` or the old per-package tags of that version already exist on `origin`.
5. Pushing the tag triggers `.github/workflows/publish.yml`. It verifies that the tag commit is on `main` and that the tag equals the version of all four packages, runs `pnpm check`, packs the four packages (checking each packed manifest), and publishes them through npm Trusted Publishing with provenance in the order Core, Inspector, Vue, documentation generator (`scripts/release-publish.ts`). Prerelease versions go to the `next` dist-tag, never `latest`.

If a publish run fails part-way, fix the cause and re-run the workflow (or the failed job) from the Actions page. A package whose exact version is already on the registry is skipped with a log line, so the re-run publishes only what is missing; a dependent is never published before Core. If the registry gives an unclear answer, or a package does not exist on the registry at all, the run fails before publishing anything.

Tags of the earlier per-package releases (`widget-core@0.1.0` and before, and the same for `widget-inspector` and `widget-vue`) stay as history; the unified releases are tagged `v<version>` only. `@deviltea/widget-docs-generator` never had a per-package tag.

The preserved `0.0.1` tags predate this repository cutover and correspond to releases originally published from `DevilTea/deviltea-labs`.
