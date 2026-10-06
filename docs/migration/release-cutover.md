# Release cutover

`@deviltea/widget-core` and `@deviltea/widget-vue` are now released from `DevilTea/widget`.

## Required external cutover

Each npm package's Trusted Publisher must name repository `DevilTea/widget`, workflow `publish.yml`, owner `DevilTea` (it originally named `DevilTea/deviltea-labs`). Do not use a long-lived npm token as a fallback.

## Release flow

1. Start from a clean, up-to-date `main`.
2. Run `pnpm release <widget-core|widget-vue> <release>` to create the release branch, commit the version bump, push it, and open a pull request.
3. Merge the pull request only after its required checks pass.
4. After the pull request merges, run `pnpm release:tag <widget-core|widget-vue>`.
5. Pushing the annotated tag triggers `.github/workflows/publish.yml`, which verifies the tag, runs `pnpm check`, packs the target package, and publishes through npm Trusted Publishing with provenance.

The preserved `0.0.1` tags predate this repository cutover and correspond to releases originally published from `DevilTea/deviltea-labs`.
