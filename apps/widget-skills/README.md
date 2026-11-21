# @deviltea/widget-skills

Private prototype. It reads a Widget System's TypeScript types and JSDoc and writes artifacts for AI agents:

- `ir.json`: every plugin's config, slots, State, Properties, Methods and Events with their documentation.
- `schema/document.schema.json`: JSON Schema 2020-12 of the document tree.
- `schema/document.llm.schema.json`: a conservative flat node-list schema for non-strict structured output.
- `skills/`: three Agent Skills (authoring source JSON, implementing renderers, writing plugins).

```bash
pnpm --filter @deviltea/widget-skills generate:onboarding
pnpm --filter @deviltea/widget-skills check:onboarding
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

`examples/onboarding/` holds the output for the Lab's onboarding showcase. See `AGENTS.md` for the schema profile, the JSDoc tag set, `--check` and the known limits.
