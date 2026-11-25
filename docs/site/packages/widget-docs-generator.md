---
title: '@deviltea/widget-docs-generator'
---

# @deviltea/widget-docs-generator

> **New in 0.4.0.** The generator was the private `@deviltea/widget-skills` before; see the
> [migration guide to 0.4](../migration/0.4#tooling).

`@deviltea/widget-docs-generator` is the build-time tooling of Widget. It reads a Widget System and writes what people
and models need to work with that System: a documentation object for an application, JSON Schemas of the documents the
System accepts, converters for a model's output, and Agent Skills. It is released together with
[`@deviltea/widget-core`](./widget-core), [`@deviltea/widget-inspector`](./widget-inspector) and
[`@deviltea/widget-vue`](./widget-vue) under one version.

For installation and a short tour, see the
[package README](https://github.com/DevilTea/widget/tree/main/packages/docs-generator#readme). The maintainer notes
(the cache key, the schema profile rules, every `--check` problem, the known limits) are in its
[`AGENTS.md`](https://github.com/DevilTea/widget/blob/main/packages/docs-generator/AGENTS.md).

## What it reads

A System has two sources of truth, and the generator reads each from where it lives:

- **The shape** comes from the TypeScript types. The generator builds a TypeScript program over the module that
  exports the System and walks `typeof system`: its plugins, each plugin's `Interfaces` (config, slots, State,
  Properties, Methods, Events, reasons) and every named type they mention. A `WidgetRef<Types>` is read as a widget
  reference that names `Types`.
- **The prose** comes from `plugin.docs`, the descriptions written in the plugin builder (`.description()`, the
  config's field docs, each member's `description`, `.events({…})`, `.reasons({…})`, `defineTypeDocs`). JSDoc is not
  read. To get `plugin.docs`, the generator **imports the System's module**, which runs its top-level code and that of
  everything it imports. Only point it at a module you would run.

Importing the module also gives the run-time facts the generator cross-checks against the types: `system.catalog`
(plugin types, capabilities, slot names) and `inspectPlugin` (State with `authorWritable`, Properties, Events). A name
that the types and the runtime disagree on stops a generation. The import happens in a worker thread through
[tsx](https://tsx.is), with the tsconfig the type checker uses, so no TypeScript loader is needed in your process and
nothing the module loads stays behind. The module and Core's inspection entry come from one Core instance, which is why
the generator declares Core as a peer dependency.

The module must load as ESM: a `package.json` with `"type": "module"` above it, or an `.mts` file.

## What it writes

| Output | For |
| --- | --- |
| The docs object (`WidgetDocs`, or the smaller `WidgetDocsSlim`) | An application that shows documentation: an authoring UI, a property panel. Served by the Vite plugin. |
| `ir.json` | The intermediate representation every other output is built from, and the input of the run-time converter. |
| `schema/document.schema.json` | The JSON Schema (Draft 2020-12) of a document tree, as an author writes it. |
| `schema/document.llm.schema.json` | A flat, conservative schema for a model's structured output. |
| `skills/` | Agent Skills for this System (see [Agent Skills](#agent-skills)). |

Every schema states the **shape only**. Constraints (ranges, lengths, patterns) are prose in the descriptions, the
plugin's `validate` enforces them, and compiling the document into a Blueprint is the arbiter: a document that fits
the schema can still be invalid, and its diagnostics say why.

## Command line

The package installs the bin `widget-docs-generator`. It runs with plain Node (`>=22.14.0`).

```bash
pnpm add -D @deviltea/widget-docs-generator

widget-docs-generator --module src/system.ts --export mySystem --tsconfig tsconfig.app.json --out generated/widgets
widget-docs-generator --check --module src/system.ts --export mySystem --tsconfig tsconfig.app.json
```

- `--module` and `--export` name the System. `--tsconfig` is the tsconfig the module is compiled with (by default the
  nearest `tsconfig.json` above the module). It must include the module and enable `strictNullChecks`; a solution
  tsconfig with `"files": []` is refused. `--source-tsconfig` adds another tsconfig's `paths`, for the type checker
  and the import alike.
- `--out <dir>` writes the files listed above and a `.generated.json` manifest. The next run removes the files the
  previous run wrote and this one does not; it never deletes anything else.
- `--example <json>` adds a complete example document to the authoring skill. It is compiled with the System first,
  and the run fails unless it is a `valid` Blueprint that also fits the full schema.
- `--root <dir>` is what the paths printed in the output are relative to.
- `--no-runtime` skips the import. The output then has the shape only, with every description empty.

### `--check`

`--check` writes nothing. It prints one line per documentation problem and the count of documented descriptions,
and exits with `1` when there is a problem:

- `undocumented`: an `undocumented` marker in the builder docs, with its plugin and docs path (`Counter: state.step`);
- `missing-doc`: docs a plugin left out (possible only for an untyped plugin), or a plugin without `plugin.docs`;
- `name-mismatch`: a plugin type, capability, slot, member, field, parameter or payload position that the types, the
  runtime and `plugin.docs` do not agree on;
- `docs-conflict`: a named type documented differently in two places;
- `unused-doc`: a description no output can show;
- `no-docs`: the System was not imported (`--no-runtime`).

Run it in CI next to your type check: a plugin whose prose has gaps fails the build before any generated output
ships without descriptions.

## Vite plugin

`@deviltea/widget-docs-generator/vite` exports `widgetDocs`, a Vite plugin that serves the docs object of each System
as a virtual module. Import it by package name in an ES module config:

<!-- sample: docs-generator-vite-config after -->
```ts
import { widgetDocs } from '@deviltea/widget-docs-generator/vite'

export default {
	plugins: [
		widgetDocs({
			systems: {
				survey: { module: 'src/survey/system.ts', export: 'surveySystem', tsconfig: 'tsconfig.app.json' },
			},
			// slim: true serves WidgetDocsSlim; cacheDir: false turns the disk cache off; runtime: false skips the import
		}),
	],
}
```

Each key of `systems` becomes `virtual:widget-docs/<name>`; paths are relative to Vite's `root`. Declare the module's
type with `@deviltea/widget-docs-generator/virtual-widget-docs` in `compilerOptions.types`, or with a reference:

<!-- sample: docs-generator-virtual-module after -->
```ts
/// <reference types="@deviltea/widget-docs-generator/virtual-widget-docs" />
import docs from 'virtual:widget-docs/survey'

export function describeWidget(type: string): string {
	const plugin = Object.hasOwn(docs.plugins, type) ? docs.plugins[type] : undefined
	if (plugin === undefined)
		return ''
	return [plugin.summary, plugin.remarks].filter(Boolean)
		.join('\n\n')
}
```

- **What the module holds.** A `WidgetDocs` object (`docsVersion` is `WIDGET_DOCS_VERSION`, `2`): per plugin type its
  summary and remarks, the config with its JSON Schema, the slots with the types they expect, State (with
  `authorWritable`), Properties, Methods, Events and reasons, with descriptions and printed types; and `types`, every
  named type by name. A section is `null` when the plugin does not declare the capability. The types are exported
  from `@deviltea/widget-docs-generator/docs`, which imports nothing.
- **Slim docs.** `widgetDocs({ slim: true, … })` serves `WidgetDocsSlim`: per plugin the summary and remarks of the
  plugin, its config, slots and Events, and the config schema. It is meant for an application that bundles the docs.
  Declare it with `@deviltea/widget-docs-generator/virtual-widget-docs-slim` instead (a project references one of the
  two declarations, since both type `virtual:widget-docs/*`).
- **Dev, build and Vitest.** The plugin works in all three. In dev, an edit to a file a System's program read, or the
  creation of a file one of its imports was looking for, invalidates that System's virtual module, and its importers
  update.
- **Cache.** Generated docs are cached under `node_modules/.cache/widget-docs/`. A hit builds no TypeScript program and
  imports nothing. The key covers the System's sources and everything else they read outside `node_modules`, the
  tsconfig files, the lockfile and installed state, and the generator itself. Delete the directory to clear it;
  `WIDGET_DOCS_CACHE=off` bypasses it.
- **Problems.** A name mismatch between the types and the runtime fails the load. Documentation problems (what
  `--check` reports) are a Vite warning.
- **Vite versions.** `vite` is an optional peer dependency, needed only for this subpath: `^6.0.0 || ^7.0.0 || ^8.0.0`.

## Converting a model's output: `./runtime`

The LLM schema describes a flat node list, `{ nodes: [{ id, type, parent?, slot?, config?, slots? }] }`, because a
flat list is easier for a model to produce than a recursive tree. `@deviltea/widget-docs-generator/runtime` converts
it back to the document tree Core compiles, with the `ir.json` the generator wrote. This is the one subpath an
application bundles: it imports nothing outside the package (no TypeScript, no tsx, no Node built-in), and CI checks
that on the packed package.

<!-- sample: docs-generator-runtime after -->
```ts
import type { FlatDocument, SystemIr } from '@deviltea/widget-docs-generator/runtime'
import { readFileSync } from 'node:fs'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { createFlatConverter, FlatConversionError } from '@deviltea/widget-docs-generator/runtime'

const note = createWidgetPlugin('Note')
	.description('A short note.')
	.interfaces()
	.done()
const system = createWidgetSystem({ plugins: [note] })

const ir = JSON.parse(readFileSync('generated/widgets/ir.json', 'utf8')) as SystemIr
const { flatToTree, treeToFlat } = createFlatConverter(ir)

export function compileModelOutput(output: FlatDocument) {
	try {
		// Blueprint compilation, not the schema, decides whether the document is valid.
		return system.createBlueprint(flatToTree(output))
	}
	catch (error) {
		if (error instanceof FlatConversionError) // no root, several roots, an unknown parent, a cycle, ...
			return null
		throw error
	}
}

export const exampleForPrompt = treeToFlat({ id: 'note', type: 'Note' })
```

`flatToTree(treeToFlat(tree))` deep-equals `tree` for a well-formed tree, `meta` and unknown keys included. Config
values that do not fit the declared shape pass through unchanged, so Core still reports them. The flat form encodes a
dictionary as a list of `{ key, value }` entries and an untyped or recursive value as JSON text; the converters undo
both.

## Build-time API

The root entry, `@deviltea/widget-docs-generator`, is the library behind the bin and the plugin: extraction
(`extractIr`, `importRuntimeFacts`), the emitters (`emitDocs`, `slimDocs`, `emitFullSchema`, `emitLlmSchema`,
`emitConfigSchema`, `emitSkills`, `generateFiles`), `checkIr` and `formatCheck` (`--check`), and the docs cache
(`createDocsCache`). It loads `typescript` and `tsx`, so it belongs in build scripts, never in an application bundle.

<!-- sample: docs-generator-build-time after -->
```ts
import { checkIr, emitLlmSchema, extractIr, formatCheck, importRuntimeFacts } from '@deviltea/widget-docs-generator'

const modulePath = 'src/survey/system.ts'
const tsconfigPath = 'tsconfig.app.json'

const runtime = await importRuntimeFacts(modulePath, 'surveySystem', { tsconfig: tsconfigPath })
const ir = extractIr({ modulePath, exportName: 'surveySystem', tsconfigPath, runtime })
const check = checkIr(ir)
if (!check.ok)
	throw new Error(formatCheck(check))
export const llmSchema = emitLlmSchema(ir)
```

The docs object types need no generator code at run time:

<!-- sample: docs-generator-docs-types run -->
```ts
import type { WidgetDocsSlim } from '@deviltea/widget-docs-generator/docs'
import { WIDGET_DOCS_VERSION } from '@deviltea/widget-docs-generator/docs'

const docs: WidgetDocsSlim = {
	docsVersion: WIDGET_DOCS_VERSION,
	system: 'surveySystem',
	plugins: {
		Rating: { summary: 'A rating question.', remarks: 'The scale is configurable.', config: null, slots: null, events: null },
	},
}

console.log(docs.docsVersion) // 2
console.log(Object.keys(docs.plugins)) // [ 'Rating' ]
```

## Schema profiles

- **Full** (`schema/document.schema.json`, and each plugin's config schema in the docs object): the document tree as
  an author writes it. One `$defs` entry per widget type and per named config type, slot children restricted to the
  types the slot expects, a widget reference as a string with `x-widgetRef` (the types it names), `meta` allowed on
  every node.
- **LLM** (`schema/document.llm.schema.json`): the flat node list, held to what structured-output providers accept in
  non-strict mode. Only `type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`, `$defs`/`$ref`,
  `additionalProperties` and `description`; no recursion through `$ref` (a recursive type becomes JSON text); every
  object closed; an optional property is left out of `required` rather than made nullable; a dictionary is a list of
  `{ key, value }`. Each node type's description says which slots may hold it.

In both profiles a description from `plugin.docs` comes first, and the generator only appends to it (the
widget-reference sentence, a structural note).

## Agent Skills

The generated System skills are written under `<out>/skills/`.

## Known limits

- Named types with type arguments are expanded inline, not named, and two declarations with one name are told apart
  by a numeric suffix (`Foo`, `Foo2`). Give shared types distinct names.
- A recursive type without a name of its own (such as Core's `JsonValue`) is untyped in the full profile and JSON text
  in the flat form.
- A tuple keeps only the union of its element types; the excerpt of an interface that `extends` another does not
  include the base; a type nested deeper than 16 levels becomes untyped.
- Method effects (State written, Events emitted) are not in the output: Core's inspection does not expose them.
- Without the runtime (`--no-runtime`, `runtime: false`) there is no prose.

The full list is in the package's
[`AGENTS.md`](https://github.com/DevilTea/widget/blob/main/packages/docs-generator/AGENTS.md#known-limits).
