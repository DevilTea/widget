# DevilTea Widget

DevilTea Widget is a renderer-agnostic widget composition system with a Vue 3 adapter and an interactive development Lab.

| Workspace | Purpose |
| --- | --- |
| [`@deviltea/widget-core`](packages/core) | Widget plugins, systems, blueprints, documents, runtime semantics, and readonly inspection. |
| [`@deviltea/widget-vue`](packages/vue) | Thin Vue 3 renderer and reactivity integration over the core runtime. |
| [`@deviltea/widget-inspector`](packages/inspector) | Read-only, versioned Inspector protocol, client, DOM agent, transports, and the inspect-anchor attribute contract (`0.x` experimental; core is a peer dependency). |
| [`@deviltea/widget-docs-generator`](packages/docs-generator) | Build-time documentation generator: a docs object served by a Vite plugin, JSON Schemas, flat/tree converters and Agent Skills from a System's types and its plugins' builder docs (core is a peer dependency). |
| [`widget-lab`](apps/lab) | Private workbench, inspectors, source editing, dependency graph, and showcases. |

Documentation is built for `https://deviltea.github.io/widget/`, with Widget Lab served under `/widget/lab/`.

## Development

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

## History

This repository was split from [`DevilTea/deviltea-labs`](https://github.com/DevilTea/deviltea-labs) after the initial `@deviltea/widget-core@0.0.1` and `@deviltea/widget-vue@0.0.1` releases. Relevant Git history and both release tags are preserved here. Historical architectural decision logs remain in the original repository; see [`docs/migration/source-history.md`](docs/migration/source-history.md).

## Releasing

The four published packages are released together under one version.

```sh
pnpm release <patch|minor|major|prerelease|version>
# after the release PR merges:
pnpm release:tag
```

`pnpm release` bumps `@deviltea/widget-core`, `@deviltea/widget-inspector`, `@deviltea/widget-vue` and `@deviltea/widget-docs-generator` to the same version on `release/v<version>` and opens one pull request; `pnpm release:tag` pushes the annotated tag `v<version>` on merged `main`. That tag triggers `publish.yml`, which publishes Core first, then the Inspector, the Vue adapter and the documentation generator, through npm Trusted Publishing. A package whose version is already on npm is skipped, so a failed run can simply be re-run. Each package's npm Trusted Publisher must name repository `DevilTea/widget` and workflow `publish.yml`.

While the packages are `0.x`, a breaking change in any package bumps the minor version (`0.N.0`) of all of them, and a patch release contains no breaking change. `@deviltea/widget-vue`, `@deviltea/widget-inspector` and `@deviltea/widget-docs-generator` declare Core as a peer dependency (`workspace:^`, published as `^<version>`), so a dependent at `0.1.1` accepts Core `>=0.1.1 <0.2.0`: install the packages at the same version. Applications and plugin or renderer libraries must also depend on Core as a peer so exactly one Core instance exists at runtime.
