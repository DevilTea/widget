# AGENTS.md

## Scope

`@deviltea/widget-skills` is a private prototype. It turns a Widget System's TypeScript types and JSDoc into documentation and AI-facing artifacts: an IR, a JSON docs object served by a Vite plugin, two JSON Schemas, flat/tree converters, and three Agent Skills. It is not published, has no version policy, and is not part of the release scripts or `check:versions`.

It implements the tooling side of `DevilTea/widget` Discussion #12, "Interfaces are the single source of a plugin's shape and documentation (0.3.0)" and its amendment "typed child reads for plugin-type slots": a plugin's `Interfaces` type plus JSDoc is the only documentation. Core 0.3 carries no descriptions at run time (no `.description()`, no `description` fields, no `config.schema`); the runtime still has the semantic facts the cross-check uses: `system.catalog` (type, capabilities, slot names) and `inspectPlugin` (State with `authorWritable`, Properties, Events).

| File | Role |
| --- | --- |
| `src/extract.ts` | TypeScript checker walk: `typeof system` -> `plugins` tuple -> `WidgetPlugin<Type, Interfaces>` -> members and JSDoc. Produces the IR. `readProgramConfig`, `createExtractionProgram` (injectable `createProgram`) and `extractIrFromProgram` are the steps; `extractIr` runs them. |
| `src/runtime-facts.ts` | Reads `system.catalog` and `inspectPlugin` into plain data for the cross-check. `loadRuntimeFacts` (under a loader, the CLI) and `importRuntimeFacts` (through tsx, the Vite plugin). |
| `src/ir.ts` | The IR types and the tag lists. The IR is plain JSON; emitters never touch the compiler. |
| `src/encoding.ts` | The config value re-encoding of the LLM profile (dictionary to entry list, opaque values to JSON text), shared by the schema emitter and the converters. |
| `src/schema.ts` | `emitFullSchema` (tree), `emitLlmSchema` (flat, LLM profile) and `emitConfigSchema` (one plugin's `config.raw`, full profile). |
| `src/docs-types.ts`, `src/docs.ts` | The `WidgetDocs` object type (no imports; exported as `@deviltea/widget-skills/docs`) and `emitDocs(ir)`. |
| `src/docs-cache.ts` | `createDocsCache`: generate a System's docs, or read them from the disk cache. |
| `src/vite.ts` | `widgetDocs(options)`, exported as `@deviltea/widget-skills/vite`. |
| `virtual-widget-docs.d.ts` | `declare module 'virtual:widget-docs/*'`, exported as `@deviltea/widget-skills/virtual-widget-docs`. |
| `src/flat.ts` | `createFlatConverter(ir)`: `treeToFlat` and `flatToTree`. |
| `src/skills.ts` | The three Markdown skills. |
| `src/check.ts` | `--check`. |
| `src/validate.ts` | A small validator for the keywords the emitters produce (the repository has no Draft 2020-12 validator). |
| `src/cli.ts`, `src/generate.ts` | Command line and the file map it writes. |
| `fixtures/survey-system.ts` | The 0.3 fixture System: fully documented, and it exercises every feature (config `raw` with JSDoc tags and a `@widgetRef`, an omittable config, record slots in all three forms, reasons with and without payload, State with `authorWritable`, Properties, Methods, Events). |
| `fixtures/survey-example.json` | The example document of the fixture's authoring skill, compiled by the CLI before it is published. |
| `src/fixtures/undocumented-system.ts` | The `--check` fixture: members without JSDoc, an unknown tag, and a `WidgetContract` slot without `Types`. |
| `examples/survey/` | Generated output for the fixture System. Never hand-edit; regenerate. A test compares it with what the generator writes. |

The Lab's onboarding showcase is not migrated to 0.3 yet; until it is, the fixture System is the example and the test subject.

## Commands

```bash
pnpm --filter @deviltea/widget-skills generate:example   # rewrites examples/survey
pnpm --filter @deviltea/widget-skills check:example      # exits 1 on a missing doc, an unknown tag or a name mismatch
pnpm --filter @deviltea/widget-skills test
pnpm --filter @deviltea/widget-skills typecheck
```

The CLI runs under `tsx`, because it **imports and therefore executes the System's module** (and everything that module imports) for the runtime cross-check and to compile `--example`. Only point it at a module you would run; `--no-runtime` skips the import, the cross-check and `authorWritable`. `--source-tsconfig <path>` adds a tsconfig's `paths` for the type checker (for example to resolve workspace packages to source); pass the same file to tsx with `--tsconfig` so the import resolves the same way.

The System's module and Core's inspection entry must come from one Core instance (Core brands its plugins per module instance). `loadRuntimeFacts` resolves `@deviltea/widget-core/inspection` from the System module's own `node_modules` first and as this package sees it second, and uses the first `inspectPlugin` that accepts the System's plugins. `importRuntimeFacts` imports both through one tsx namespace, from the System module's location.

`--example <json>` is a complete document shown in the authoring skill. The CLI refuses it unless it compiles to a `valid` Blueprint and passes the full schema. `--out` removes the files a previous run wrote and this run does not, using the `.generated.json` manifest it leaves in the output directory; it never deletes anything else.

Tests run in the root `widget-skills` Vitest project (no Lab plugins or setup) or with this package's `vitest.config.ts`; both load `widgetDocs` with the fixture System (keep their options in step), and a test imports `virtual:widget-docs/survey` through it. They import the built `@deviltea/widget-core` (`pnpm --filter "./packages/**" build`, or `pnpm build`). Only hooks and tests that build TypeScript programs have long timeouts. The plugin tests write their files under the OS temporary directory and remove them.

## The Vite plugin

```text
import { widgetDocs } from '@deviltea/widget-skills/vite'

widgetDocs({
	systems: {
		onboarding: { module: 'src/showcases/onboarding/system.ts', export: 'onboardingSystem', tsconfig: 'tsconfig.app.json' },
	},
	// cacheDir: 'node_modules/.cache/widget-docs' (default, relative to Vite's root); false disables the disk cache
	// runtime: true (default): import the System for the cross-check
})

import docs from 'virtual:widget-docs/onboarding' // WidgetDocs
```

- Pass each System's `tsconfig`: the one the module is compiled with (the Lab: `tsconfig.app.json`). Without it the nearest `tsconfig.json` above the module is used, which in a project with references is a solution file (`"files": []`). `readProgramConfig` refuses a tsconfig that does not include the module or compiles without `strictNullChecks` (which erases every `| null` and would be cached silently).
- Each key of `systems` is a virtual module `virtual:widget-docs/<name>` (`<name>` matches `[\w.-]+`). Paths are relative to Vite's `root`. Its default export is a `WidgetDocs` object: per plugin type its summary, remarks and tags; `config` (JSDoc, `omittable`, printed raw/resolved types, and the JSON Schema of `config.raw`, Draft 2020-12, full profile); `slots` (JSDoc, `expectedTypes` or `null` for any widget, the contract's `Shape`, the expectation as written); `state` (with `authorWritable`), `properties`, `methods` (signature, parameters, returns), `events` (labelled payload) with JSDoc and printed types; `reasons` (JSDoc and the `details` type, `null` for `void`). A section is `null` when the capability is not declared and `{}` when it is declared empty.
- Generating **imports the System's module, which runs its top-level code** and that of everything it imports, through tsx in a fresh namespace (Node keeps each namespace's modules for the life of the process). `runtime: false` skips the import, the cross-check and `authorWritable`.
- A name mismatch between the types and the runtime fails the load with the list. Documentation problems (what `--check` reports) are a Vite warning on a fresh generation, never an error.
- It works in `vite dev`, `vite build` and Vitest. In dev the System's input files are added to Vite's watcher; a change to one invalidates only the virtual modules of the Systems that read it and returns them to Vite, which updates or reloads their importers. Any other file regenerates nothing. In a build, the inputs are Rollup watch files.
- Types: add `@deviltea/widget-skills/virtual-widget-docs` to `compilerOptions.types` (or a `/// <reference types>`).

### Cache

`src/docs-cache.ts` decides between generating and reading. A hit builds no TypeScript program and imports nothing (the fixture: about 1.5 s cold, under 10 ms warm).

- Key: a SHA-256 over the content of every file the TypeScript program loaded that is not under a `node_modules` directory (the System's sources, what they import, and workspace packages such as Core's built declarations, which resolve to their real paths), the tsconfig files the options come from (the tsconfig, what it `extends` outside `node_modules`, the source tsconfig), the hash of the nearest lockfile above the root (standing for every declaration file under `node_modules`, TypeScript's libraries included), the System options (module, export, tsconfig paths, `runtime`), and the generator (a hash of `src/*.ts` without tests, and `WIDGET_DOCS_VERSION`).
- Files, in `node_modules/.cache/widget-docs/` under Vite's root: `<name>.manifest.json` (`{ key, fixed, files }`, the input list of the last generation) and `<key>.json` (`{ key, docs }`). A hit is: the manifest's `fixed` part matches, the listed files hash to its `key`, and `<key>.json` holds that key. A miss builds the program, regenerates, writes both files atomically (temporary file and rename) and removes the entry the manifest pointed at before. An unreadable, corrupt or mismatching file is a miss.
- Clear it by deleting the directory (`rm -rf node_modules/.cache/widget-docs`). Nothing else reads it.
- Not covered by the key: the runtime JavaScript of dependencies (a change there normally changes their declarations or the lockfile too), and a new file that changes module resolution without changing any listed file.

## LLM schema profile

`emitLlmSchema` writes one conservative profile. Keep these rules; `widget-skills.unit.test.ts` walks the schema and rejects violations.

- JSON Schema Draft 2020-12 syntax; the root is an object.
- Keywords: `type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`, `$defs`/`$ref`, `additionalProperties`, `description` (and `$schema`, `title`). Nothing else.
- `anyOf` never shares an object with `type` or `properties`.
- No recursion through `$ref`. A recursive named type becomes JSON text.
- Every object has `additionalProperties: false`.
- An optional property is left out of `required`. There is no `null` union for optionality: that is the strict-mode spelling, and it spends the provider's budget of union-typed and optional parameters (the sizes the profile is held to are 24 optional and 16 union-typed parameters; a test counts them for the fixture). The profile is meant for non-strict structured output.
- Every constraint (ranges, lengths, pattern, format, widget references) is prose in `description`, never a keyword.
- A dictionary is an array of `{ key, value }`.
- The document is a flat node list: `{ nodes: [{ id, type, parent?, slot?, config?, slots? }] }`. The root has no `parent` and no `slot`. `slots` lists slot names and is only needed for a slot without children.
- `meta` is not in the LLM schema (a model never writes it); the converters carry it.
- `$defs` keys are restricted to `[A-Za-z0-9_.-]` (`node_<Type>`, `type_<Name>`, sanitized, with a numeric suffix on collision), so no JSON Pointer needs escaping. The `type` value keeps the original name.
- A description is appended to, never replaced: the JSDoc text comes first, then the structural note (for a dictionary: that it is an entry list here). `@default` and `@examples` values are rewritten into the encoded form.
- Each node type says which slots may hold it: the slots that name it (a plain union, or a contract's `Types`) and the slots that take any widget (`WidgetChild`, a contract without `Types`). Slot expectations are the plugin's intent; Core does not check them at run time, so the schema states them as prose.

The principle behind all of it: the schema only gets the structure roughly right, Blueprint compilation and its diagnostics are the arbiter, and effort goes into descriptions.

The full schema (`emitFullSchema`) is the tree as authored: one `$defs` entry per widget type and per named config type, recursion through `#/$defs/widget`, slot children restricted to the expected types, constraint tags as keywords, and `meta` allowed on every node as any JSON value. `emitConfigSchema` is the same profile for one plugin's `config.raw`, with only the `$defs` it reaches and an `anyOf` with `null` when the config may be left out.

## Flat and tree converters

`flatToTree(treeToFlat(tree))` must deep-equal `tree` for a well-formed tree, including `meta`, empty slot arrays, an explicit `config: null`, unrecognized widget keys and config values that do not fit the declared shape (they pass through, so Core still diagnoses them). A key the tree leaves out is left out of the node. `treeToFlat` throws `FlatConversionError` for what the flat form cannot name: a node without string `id`/`type`, a repeated id, a widget key called `parent` or `slot`. `flatToTree` throws on no root, several roots, a root that names a slot, an unknown parent, a repeated id or a cycle.

A union value is encoded as the member it belongs to: the member whose literal discriminant properties equal the value's and whose required keys are all present, preferring one that declares every key of the value. A value that fits no member passes through.

## JSDoc tag set

TSDoc-compatible; the custom tags are declared in `tsdoc.json`. `CONSTRAINT_TAGS` and `PROSE_TAGS` in `src/ir.ts` are the lists the code uses: change all three together.

- Summary (first paragraph) and `@remarks`: the Interfaces type and every member.
- `@format`, `@pattern`, `@minLength`, `@maxLength`: strings.
- `@minimum`, `@maximum`, `@exclusiveMinimum`, `@exclusiveMaximum`, `@multipleOf`: numbers.
- `@minItems`, `@maxItems`: arrays.
- `@default`, `@examples`: JSON values.
- `@widgetRef A | B`: the string is the id of a widget of one of these types.
- `@param name - text`, `@returns`: Methods. Also accepted without a meaning for the schemas: the standard TSDoc tags `@see`, `@example`, `@deprecated`, `@throws`, `@defaultValue`, `@typeParam`, `@privateRemarks`, `@internal`, `@alpha`, `@beta`, `@public`, `@experimental`.

Tags document; `config.validate` and the State and Method validators enforce.

## `--check`

Prints one line per problem plus the documented/total count, and exits 1 when there is an error. Warnings never fail it.

- `missing-doc`, error: a plugin (the JSDoc of its Interfaces type), its `config` member, a slot, State member, Property, Method, Method parameter (`@param`), Event or reason without documentation; a field of an inline object type one of them uses (a reason's payload included); a named type reachable from `config.raw` or from a reason's payload, or one of its fields.
- `missing-doc`, warning: a named type (or one of its fields) reachable only from a resolved config, a State or Property value, a Method signature or an Event payload. Renderer authors read those; document authors do not write them.
- `unknown-tag`, error: a tag outside `CONSTRAINT_TAGS` and `PROSE_TAGS`.
- `name-mismatch`: a capability declared on one side only (all six), or a plugin type, slot, State member, Property or Event the types and the runtime disagree on. Neither the catalog nor `inspectPlugin` has a Method inventory, so Method names are not cross-checked.

Generating (the CLI without `--check`, and the Vite plugin) refuses only on a name mismatch.

## What is generated and what is hand-written

- Generated from the IR: every `references/<type>.md` of the two System skills (config, slots with their expectations, reasons with their `details`), both schemas, `example-interfaces.md`, the type lists and the registration chain inside the `SKILL.md` files, the example document (from `--example`), and the docs object.
- Hand-written in `src/skills.ts` and to be kept in step with the packages by hand: the node grammar, the flat-to-tree conversion rules and the validate-and-repair section; the registration notes, the `useWidget()` accessor table and the renderer rules (from the public exports of `@deviltea/widget-vue`: a State or Property ref is `T | null`, a Method call returns its value or `null`, diagnostics are typed by the declared reasons, `WidgetSlot`'s `type` is narrowed to the slot's expectation); the whole `widget-plugin-authoring` skill and the tag table. They describe the Core 0.3 API (`docs/site/migration/0.3.md`).
- The skills must stand alone: they never tell a reader to import this private package. They must not claim that a failed Method call is rolled back; Core's batching is propagation atomicity, not a transaction (`docs/site/packages/widget-core.md`, "Runtime Methods").
- Generated TypeScript excerpts use the `text` info string: `scripts/docs-samples.unit.test.ts` walks every Markdown file, the committed examples included, and requires a sample marker on each `ts` fence.

## Known limits

- A slot expectation is read structurally: string literals are plugin types, and `WidgetContract` is recognized by its symbol name and type arguments. Any other expectation (which Core rejects at `.interfaces()`) is an extraction error, and so is the 0.2 union-of-names form.
- Named types with type arguments are expanded inline, not named. Two different declarations with one name get a numeric suffix.
- An untyped or recursive config value is JSON text in the flat form.
- Method effects (State written, Events emitted) are not in the IR: Core's inspection does not expose `emits`.
- `validate.ts` does not evaluate `format` or `pattern`, and throws on any keyword it does not implement.
- Not handled yet: a tuple keeps only the union of its element types; an object with both declared properties and an index signature loses the index signature; JSDoc tags on a type alias apply to the alias, not to each use; the excerpt of an interface that `extends` another does not include the base; a type nested deeper than 16 levels becomes untyped without a warning.
- The authoring skill explains the flat-to-tree conversion in prose only; it ships no script.
