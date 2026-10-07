---
title: Packages
---

# Packages

The Widget packages are independently versioned and published to npm while developed together in this repository.

- [`@deviltea/widget-core`](./widget-core) — renderer-agnostic composition, compilation, document, runtime, diagnostics, and inspection semantics.
- [`@deviltea/widget-inspector`](./widget-inspector) — read-only, versioned Inspector protocol, client, DOM agent, and inspect-anchor contract (`0.x` experimental).
- [`@deviltea/widget-vue`](./widget-vue) — thin Vue 3 renderer/reactivity integration over `@deviltea/widget-core`.

The private [Widget Lab](../lab/){target="_self"} exercises these packages as a real downstream application and architecture probe.
