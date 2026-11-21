# @deviltea/widget-skills

Private prototype. It reads a Widget System's TypeScript types and JSDoc (Core 0.3: the JSDoc on a plugin's
`Interfaces` is its only documentation) and produces:

- a docs object per System, served by a Vite plugin as `virtual:widget-docs/<name>`;
- `ir.json`: every plugin's config, slots, State, Properties, Methods, Events and reasons with their documentation;
- `schema/document.schema.json`: JSON Schema 2020-12 of the document tree;
- `schema/document.llm.schema.json`: a conservative flat node-list schema for non-strict structured output;
- `skills/`: three Agent Skills (authoring source JSON, implementing renderers, writing plugins).

## Vite plugin

```text
// vite.config.ts (or a Vitest config)
import { widgetDocs } from '@deviltea/widget-skills/vite'

export default defineConfig({
	plugins: [widgetDocs({ systems: { survey: { module: 'src/survey-system.ts', export: 'surveySystem' } } })],
})

// anywhere in the app
import docs from 'virtual:widget-docs/survey'
docs.plugins.Survey.slots.questions.summary
```

For the module's type, add `@deviltea/widget-skills/virtual-widget-docs` to `compilerOptions.types`.

Generating **imports the System's module and runs its top-level code** to cross-check the types against
`system.catalog` and `inspectPlugin` (`runtime: false` turns that off). The result is cached in
`node_modules/.cache/widget-docs/`; a hit builds no TypeScript program. The key covers every source file the
program read outside `node_modules`, the tsconfig files, the lockfile and the generator itself. Delete the directory
to clear the cache. See `AGENTS.md` for the details.

## Command line

```bash
pnpm --filter @deviltea/widget-skills generate:example   # the fixture System -> examples/survey
pnpm --filter @deviltea/widget-skills check:example
```

For another System:

```bash
tsx src/cli.ts --module <path/to/system.ts> --export <name> --tsconfig <its tsconfig> --out <dir>
tsx src/cli.ts --check --module <path/to/system.ts> --export <name> --tsconfig <its tsconfig>
```

As a library:

```text
import { createFlatConverter, emitLlmSchema, extractIr } from '@deviltea/widget-skills'

const ir = extractIr({ modulePath, exportName: 'mySystem' })
const schema = emitLlmSchema(ir)
const { flatToTree } = createFlatConverter(ir)
const blueprint = mySystem.createBlueprint(flatToTree(modelOutput))
// blueprint.status and blueprint.diagnostics decide, not the schema.
```

`examples/survey/` holds the output for the fixture System in `fixtures/survey-system.ts`. See `AGENTS.md` for the
plugin and its cache, the schema profile, the JSDoc tag set, `--check` and the known limits.
