# Release cutover

`@deviltea/widget-core` and `@deviltea/widget-vue` are now released from `DevilTea/widget`.

## Required external cutover

Before the first post-split release, update each npm package's Trusted Publisher from repository `DevilTea/deviltea-labs` to repository `DevilTea/widget`, workflow `publish.yml`, owner `DevilTea`. Do not use a long-lived npm token as a fallback.

## Release flow

1. Start from a clean, up-to-date `main`.
2. Run `pnpm release <widget-core|widget-vue> <release>` to create the release branch, commit the version bump, push it, open a pull request, and enable auto-merge.
3. After the pull request merges, run `pnpm release:tag <widget-core|widget-vue>`.
4. Pushing the annotated tag triggers `.github/workflows/publish.yml`, which verifies the tag, runs `pnpm check`, packs the target package, and publishes through npm Trusted Publishing with provenance.

The preserved `0.0.1` tags predate this repository cutover and correspond to releases originally published from `DevilTea/deviltea-labs`.
