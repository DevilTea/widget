# DevilTea Widget

DevilTea Widget is a renderer-agnostic widget composition system with a Vue 3 adapter and an interactive development Lab.

| Workspace | Purpose |
| --- | --- |
| [`@deviltea/widget-core`](packages/core) | Widget plugins, systems, blueprints, documents, runtime semantics, and readonly inspection. |
| [`@deviltea/widget-vue`](packages/vue) | Thin Vue 3 renderer and reactivity integration over the core runtime. |
| [`@deviltea/widget-inspector`](packages/inspector) | Read-only, versioned Inspector protocol, client, DOM agent, transports, and the inspect-anchor attribute contract (`0.x` experimental; core is a peer dependency). |
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
pnpm release <widget-core|widget-inspector|widget-vue> <patch|minor|major|prerelease|version>
# after the release PR merges:
pnpm release:tag <widget-core|widget-inspector|widget-vue>
```

Publishing uses npm Trusted Publishing from GitHub Actions. Each package's npm Trusted Publisher must name repository `DevilTea/widget` and workflow `publish.yml`.

While the packages are `0.x`, a breaking change bumps the minor version (`0.N.0`), and the next `@deviltea/widget-core` release must be `0.1.0`, and `@deviltea/widget-vue` and `@deviltea/widget-inspector` are released as `0.1.0` as well. Release Core first, then `@deviltea/widget-vue` and `@deviltea/widget-inspector`, which declare Core as a peer dependency (`workspace:^`, published as `^0.N.0`). The release scripts refuse to release `@deviltea/widget-vue` or `@deviltea/widget-inspector` while Core is below `0.1.0`, because a `^0.0.N` peer range pins one exact Core patch. Applications and plugin or renderer libraries must also depend on Core as a peer so exactly one Core instance exists at runtime.
