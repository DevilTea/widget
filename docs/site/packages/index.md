---
title: Packages
---

# Packages

The Widget packages are developed together in this repository and released together: all four carry the same version and are published to npm in one release, Core first. `@deviltea/widget-vue`, `@deviltea/widget-inspector` and `@deviltea/widget-docs-generator` declare Core as a peer dependency published as `^<version>`, so a package at `0.1.1` accepts Core `>=0.1.1 <0.2.0`; install them at the same version.

- [`@deviltea/widget-core`](./widget-core) — renderer-agnostic composition, compilation, document, runtime, diagnostics, and inspection semantics.
- [`@deviltea/widget-inspector`](./widget-inspector) — read-only, versioned Inspector protocol, client, DOM agent, and inspect-anchor contract (`0.x` experimental).
- [`@deviltea/widget-vue`](./widget-vue) — thin Vue 3 renderer/reactivity integration over `@deviltea/widget-core`.
- [`@deviltea/widget-docs-generator`](./widget-docs-generator) — build-time documentation generator: a docs object and Vite plugin, JSON Schemas, a converter for a model's output, and Agent Skills, from a System's types and its plugins' builder docs (new in `0.4.0`).

Upgrading from `0.3`? Follow the [migration guide to 0.4](../migration/0.4). Upgrading from the published `0.0.x` packages? Start with the [migration guide to 0.1](../migration/0.1).

The private [Widget Lab](../lab/){target="_self"} exercises these packages as a real downstream application and architecture probe.
