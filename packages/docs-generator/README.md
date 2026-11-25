# @deviltea/widget-docs-generator

> ESM-only build-time tooling for [`@deviltea/widget-core`](https://www.npmjs.com/package/@deviltea/widget-core) 0.4.
> Released together with Core under one version. Documentation:
> [deviltea.github.io/widget/packages/widget-docs-generator](https://deviltea.github.io/widget/packages/widget-docs-generator).

The Widget documentation generator. It reads a Widget System's TypeScript types (the shape) and each plugin's
`plugin.docs` (the descriptions written in the plugin builder; JSDoc is not read) and produces:

- a docs object per System, served by a Vite plugin as `virtual:widget-docs/<name>`;
- `ir.json`: every plugin's config, slots, State, Properties, Methods, Events and reasons with their documentation;
- `schema/document.schema.json`: JSON Schema 2020-12 of the document tree;
- `schema/document.llm.schema.json`: a conservative flat node-list schema for non-strict structured output;
- `skills/`: Agent Skills for the System.

## Installation

```bash
pnpm add -D @deviltea/widget-docs-generator @deviltea/widget-core
```

`@deviltea/widget-core` is a **peer dependency**: the generator reads a System's plugins with the System's own Core.
Install the generator at the same version as Core (a generator at `0.4.1` accepts Core `>=0.4.1 <0.5.0`). `vite` is an
optional peer (`^6.0.0 || ^7.0.0 || ^8.0.0`), needed only for the Vite plugin. Node `>=22.14.0`.

Generating **imports the System's module and runs its top-level code** (through tsx, in a worker thread) to read each
`plugin.docs` and to cross-check the types against `system.catalog` and `inspectPlugin`. Only point the generator at a
module you would run. The module must load as ESM (`"type": "module"` above it, or `.mts`).

## Command line

```bash
widget-docs-generator --module src/system.ts --export mySystem --tsconfig tsconfig.app.json --out generated/widgets
widget-docs-generator --check --module src/system.ts --export mySystem --tsconfig tsconfig.app.json
```

`--check` writes nothing, prints every documentation problem (an `undocumented` marker, a name the types, the runtime
and `plugin.docs` disagree on, conflicting docs of one type, ...) and exits with `1` when there is one.
`--source-tsconfig <path>` adds a tsconfig's `paths` for the type checker and the import, `--example <json>` adds a
document (compiled and checked first) to the authoring skill, `--root <dir>` is what printed paths are relative to, and
`--no-runtime` skips importing the System (no prose then). `--out` keeps a `.generated.json` manifest and removes only
the files a previous run wrote.

## Vite plugin

<!-- sample: readme-vite-config after -->
```ts
// vite.config.ts (an ES module config)
import { widgetDocs } from '@deviltea/widget-docs-generator/vite'

export default {
	plugins: [widgetDocs({ systems: { survey: { module: 'src/survey-system.ts', export: 'surveySystem', tsconfig: 'tsconfig.app.json' } } })],
}
```

Add `@deviltea/widget-docs-generator/virtual-widget-docs` to `compilerOptions.types`, then
`import docs from 'virtual:widget-docs/survey'` is a typed `WidgetDocs` object. `widgetDocs({ slim: true, ... })` serves
the smaller `WidgetDocsSlim` (declared by `@deviltea/widget-docs-generator/virtual-widget-docs-slim`). Results are cached
in `node_modules/.cache/widget-docs/`; in dev, an edit to a System's sources invalidates its module.

## `./runtime`: a model's output back to a document

<!-- sample: readme-runtime after -->
```ts
import type { FlatDocument, SystemIr } from '@deviltea/widget-docs-generator/runtime'
import { readFileSync } from 'node:fs'
import { createFlatConverter } from '@deviltea/widget-docs-generator/runtime'

const ir = JSON.parse(readFileSync('generated/widgets/ir.json', 'utf8')) as SystemIr
const { flatToTree } = createFlatConverter(ir)

export function toDocument(modelOutput: FlatDocument) {
	// Compile the result with your System: Blueprint diagnostics, not the schema, decide.
	return flatToTree(modelOutput)
}
```

`./runtime` is the subpath an application bundles: it imports no TypeScript, no tsx and no Node built-in.

## Subpaths

- `.`: the build-time API (extraction, emitters, `--check`, the docs cache). It loads `typescript` and `tsx`.
- `./runtime`: `createFlatConverter` and `FlatConversionError`.
- `./vite`: `widgetDocs`.
- `./docs`: the `WidgetDocs` and `WidgetDocsSlim` types and `WIDGET_DOCS_VERSION`.
- `./virtual-widget-docs`, `./virtual-widget-docs-slim`: the virtual-module declarations.

See the [documentation](https://deviltea.github.io/widget/packages/widget-docs-generator) for the schema profiles,
the cache and the known limits.
