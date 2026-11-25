# @deviltea/widget-docs-generator

The Widget documentation generator (built, not released yet). It reads a Widget System's TypeScript types (the shape) and each plugin's `plugin.docs` (Core 0.4: the
descriptions written in the builder; JSDoc is not read) and produces:

- a docs object per System, served by a Vite plugin as `virtual:widget-docs/<name>`;
- `ir.json`: every plugin's config, slots, State, Properties, Methods, Events and reasons with their documentation;
- `schema/document.schema.json`: JSON Schema 2020-12 of the document tree;
- `schema/document.llm.schema.json`: a conservative flat node-list schema for non-strict structured output;
- `skills/`: three Agent Skills (authoring source JSON, implementing renderers, writing plugins).

## Vite plugin

```text
// vite.config.ts (or a Vitest config)
import { widgetDocs } from '@deviltea/widget-docs-generator/vite'

export default defineConfig({
	plugins: [widgetDocs({ systems: { survey: { module: 'src/survey-system.ts', export: 'surveySystem' } } })],
})

// anywhere in the app
import docs from 'virtual:widget-docs/survey'
docs.plugins.Survey.slots.questions.summary
```

Pass each System's `tsconfig` (the one that compiles the module, for an application `tsconfig.app.json`): a tsconfig that
does not include the module, such as a solution file with `"files": []`, or one without `strictNullChecks` is refused.

`vite` is an optional peer dependency, needed only for `./vite`. The package is ESM only, so the config must be an ES module
(a `"type": "module"` project or a `.mts` config).

For the module's type, add `@deviltea/widget-docs-generator/virtual-widget-docs` to `compilerOptions.types`.

`widgetDocs({ slim: true, ... })` serves `WidgetDocsSlim` instead: the summary and remarks of each plugin, its config, slots
and Events, and the config schema, without the `types` section, printed types or tags (for an app that bundles the docs).
Its module type is `@deviltea/widget-docs-generator/virtual-widget-docs-slim`.

Generating **imports the System's module and runs its top-level code** to read each `plugin.docs` and to cross-check the types against
`system.catalog` and `inspectPlugin` (`runtime: false` turns that off, and the docs then carry no prose). The result is cached in
`node_modules/.cache/widget-docs/`; a hit builds no TypeScript program. The key covers every source file the
program read outside `node_modules` (with the JavaScript next to declaration files and the nearest `package.json`), the
tsconfig files, the lockfile, the installed state of `node_modules` and the generator itself; a program with an
unresolved relative import is not cached. Delete the directory
to clear the cache; `WIDGET_DOCS_CACHE=off` bypasses it, and a cache that cannot be written only logs a warning. See `AGENTS.md` for the details.

## Command line

The bin `widget-docs-generator` runs with plain Node; it imports the System through tsx in a worker thread.

```bash
widget-docs-generator --module <path/to/system.ts> --export <name> --tsconfig <its tsconfig> --out <dir>
widget-docs-generator --check --module <path/to/system.ts> --export <name> --tsconfig <its tsconfig>
```

`--source-tsconfig <path>` adds a tsconfig's `paths` for the type checker and the import, `--example <json>` adds a
document (compiled and checked first) to the authoring skill, `--root <dir>` is what printed paths are relative to, and
`--no-runtime` skips importing the System. In this repository (after `pnpm build`):

```bash
pnpm --filter @deviltea/widget-docs-generator generate:example   # the fixture System -> examples/survey
pnpm --filter @deviltea/widget-docs-generator check:example
```

## Subpaths

- `.`: the build-time API (extraction, emitters, `--check`, the docs cache). It loads `typescript` and `tsx`.
- `./runtime`: `createFlatConverter` and `FlatConversionError`, the run-time half an application bundles. It imports
  nothing else. `.` exports them too, so build-time code that already imports `.` needs no second import.
- `./vite`: `widgetDocs`.
- `./docs`: the `WidgetDocs` and `WidgetDocsSlim` types (and `WIDGET_DOCS_VERSION`); `./virtual-widget-docs` and
  `./virtual-widget-docs-slim`: the virtual-module declarations.

At build time:

```text
import { emitLlmSchema, extractIr, importRuntimeFacts } from '@deviltea/widget-docs-generator'

const ir = extractIr({ modulePath, exportName: 'mySystem', runtime: await importRuntimeFacts(modulePath, 'mySystem') })
const schema = emitLlmSchema(ir)
```

At run time, with the `ir.json` the generator wrote:

```text
import { createFlatConverter } from '@deviltea/widget-docs-generator/runtime'

const { flatToTree } = createFlatConverter(ir)
const blueprint = mySystem.createBlueprint(flatToTree(modelOutput))
// blueprint.status and blueprint.diagnostics decide, not the schema.
```

`examples/survey/` holds the output for the fixture System in `fixtures/survey-system.ts`. See `AGENTS.md` for the
plugin and its cache, the schema profile, where the prose comes from, `--check` and the known limits.
