# Release cutover

`@deviltea/widget-core`, `@deviltea/widget-inspector`, and `@deviltea/widget-vue` are released from `DevilTea/widget`.

## Required external cutover

Each npm package's Trusted Publisher must name repository `DevilTea/widget`, workflow `publish.yml`, owner `DevilTea` (the core and Vue publishers originally named `DevilTea/deviltea-labs`). Do not use a long-lived npm token as a fallback.

### `@deviltea/widget-inspector` placeholder

npm can only attach a Trusted Publisher to a package that already exists. Publish a `0.0.0` placeholder of `@deviltea/widget-inspector` manually once, solely to create the package, then configure its Trusted Publisher (repository `DevilTea/widget`, workflow `publish.yml`). The placeholder is not a release: the workspace version stays `0.0.0`, and the first real release is `0.1.0` (`pnpm release widget-inspector <release>`), published after `@deviltea/widget-core` `0.1.0`. Every later publish goes through `publish.yml` only.

## Version policy and release order

- While the packages are `0.x`, a breaking change bumps the **minor** (`0.N.0`). The unreleased Core changes since `0.0.6` are breaking, so the next `@deviltea/widget-core` release must be `0.1.0` (choose `minor`, or the explicit version, when running `pnpm release widget-core <release>`). The next release of `@deviltea/widget-vue` and the first real release of `@deviltea/widget-inspector` are both `0.1.0` as well, published after Core.
- `@deviltea/widget-vue` and `@deviltea/widget-inspector` declare `@deviltea/widget-core` as `peerDependencies` with `workspace:^`, which publishes as `^0.N.0`. A `^0.N.0` range accepts only that minor line, so a dependent can only be installed next to the Core line it was released against.
- While Core is `0.0.x`, that caret is an exact pin (`^0.0.6` is `0.0.6`), so `pnpm release` and `pnpm release:tag` refuse `widget-vue` and `widget-inspector` until the workspace Core version is at least `0.1.0`.
- Release **Core first**, then the dependents. A dependent's published peer range must never point at a Core version that is not on npm yet.
- Consumers and plugin or renderer libraries must depend on Core as a peer dependency too, so that exactly one Core instance exists in an application (Core identifies its own objects by module-private brands, and an object from a second copy is rejected as foreign).
- All three packages declare `engines.node` `>=22.14.0` and `sideEffects: false`.

## Release flow

1. Start from a clean, up-to-date `main`.
2. Run `pnpm release <widget-core|widget-inspector|widget-vue> <release>` to create the release branch, commit the version bump, push it, and open a pull request. For a multi-package release, finish Core (steps 2 to 5) before starting its dependents.
3. Merge the pull request only after its required checks pass.
4. After the pull request merges, run `pnpm release:tag <widget-core|widget-inspector|widget-vue>`.
5. Pushing the annotated tag (`widget-core@*`, `widget-inspector@*`, or `widget-vue@*`) triggers `.github/workflows/publish.yml`, which verifies the tag, runs `pnpm check`, packs the target package, and publishes through npm Trusted Publishing with provenance.

The preserved `0.0.1` tags predate this repository cutover and correspond to releases originally published from `DevilTea/deviltea-labs`.
