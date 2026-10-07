# Release cutover

`@deviltea/widget-core`, `@deviltea/widget-inspector`, and `@deviltea/widget-vue` are released from `DevilTea/widget`.

## Required external cutover

Each npm package's Trusted Publisher must name repository `DevilTea/widget`, workflow `publish.yml`, owner `DevilTea` (the core and Vue publishers originally named `DevilTea/deviltea-labs`). Do not use a long-lived npm token as a fallback.

### `@deviltea/widget-inspector` placeholder

npm can only attach a Trusted Publisher to a package that already exists. Publish a `0.0.0` placeholder of `@deviltea/widget-inspector` manually once, solely to create the package, then configure its Trusted Publisher (repository `DevilTea/widget`, workflow `publish.yml`). The placeholder is not a release: the workspace version stays `0.0.0`, and the first real release is chosen at release time (`pnpm release widget-inspector <release>`), as core and Vue started at `0.0.1`. Every later publish goes through `publish.yml` only.

## Release flow

1. Start from a clean, up-to-date `main`.
2. Run `pnpm release <widget-core|widget-inspector|widget-vue> <release>` to create the release branch, commit the version bump, push it, and open a pull request.
3. Merge the pull request only after its required checks pass.
4. After the pull request merges, run `pnpm release:tag <widget-core|widget-inspector|widget-vue>`.
5. Pushing the annotated tag (`widget-core@*`, `widget-inspector@*`, or `widget-vue@*`) triggers `.github/workflows/publish.yml`, which verifies the tag, runs `pnpm check`, packs the target package, and publishes through npm Trusted Publishing with provenance.

The preserved `0.0.1` tags predate this repository cutover and correspond to releases originally published from `DevilTea/deviltea-labs`.
