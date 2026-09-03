# DevilTea Widget

DevilTea Widget is a renderer-agnostic widget composition system with a Vue 3 adapter and an interactive development Lab.

| Workspace | Purpose |
| --- | --- |
| [`@deviltea/widget-core`](packages/core) | Widget plugins, systems, blueprints, documents, runtime semantics, and readonly inspection. |
| [`@deviltea/widget-vue`](packages/vue) | Thin Vue 3 renderer and reactivity integration over the core runtime. |
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

```sh
pnpm release <widget-core|widget-vue> <patch|minor|major|prerelease|version>
# after the release PR merges:
pnpm release:tag <widget-core|widget-vue>
```

Publishing uses npm Trusted Publishing from GitHub Actions. The Trusted Publisher repository must be updated to `DevilTea/widget` before the first post-split release.
