# AGENTS.md

## Scope

`@deviltea/widget-docs-generator` (`packages/docs-generator`) turns a Widget System's TypeScript types (the shape) and its plugins' builder docs (the prose, `plugin.docs`) into documentation and AI-facing artifacts: an IR, a JSON docs object served by a Vite plugin, two JSON Schemas, flat/tree converters, and three Agent Skills. It is built with tsdown like the published packages, but it is `private` and not released yet: it is not part of the release scripts or `check:versions` (the Discussion #12 amendment "`@deviltea/widget-docs-generator` is a published package" makes it the fourth lockstep package).

It implements the tooling side of `DevilTea/widget` Discussion #12, "Descriptions live in the plugin builder; JSON Schema is inferred from the types (0.4.0)" (which amends "Interfaces are the single source of a plugin's shape and documentation (0.3.0)"), and the amendment "typed child reads for plugin-type slots": the shape comes from a plugin's `Interfaces` type, and every description from `plugin.docs`, the plain data Core keeps of the docs written in the builder (`.description()`, the config's field docs, each member's `description`, `.events({…})`, `.reasons({…})`, `defineTypeDocs`). JSDoc is not read. The runtime also has the semantic facts the cross-check uses: `system.catalog` (type, capabilities, slot names) and `inspectPlugin` (State with `authorWritable`, Properties, Events).

| File | Role |
| --- | --- |
| `src/index.ts` | `.`: the build-time API (extraction, emitters, `--check`, the docs cache, the runtime import). It depends on `typescript` and `tsx`. |
| `src/runtime.ts` | `./runtime`: `createFlatConverter`, `FlatConversionError` and their types, for an application to bundle. Its built chunk graph imports nothing external (`package.unit.test.ts` walks it). `.` exports the converter too. |
| `src/extract.ts` | TypeScript checker walk: `typeof system` -> `plugins` tuple -> `WidgetPlugin<Type, Interfaces>` -> the shape of every member (a `WidgetRef<Types>` is a string shape that names `Types`). Produces the IR. `readProgramConfig`, `createExtractionProgram` (injectable `createProgram`) and `extractIrFromProgram` are the steps; `extractIr` runs them, and `applyRuntimeFacts` adds the runtime facts. |
| `src/prose.ts` | `applyPluginDocs`: reads each plugin's `plugin.docs` beside the shapes, fills every description of the IR, and records what `--check` reports (`ir.docsIssues`). |
| `src/runtime-facts.ts` | Reads `system.catalog`, `inspectPlugin` and each `plugin.docs` into plain data. `importRuntimeFacts` (a worker thread per call: the Vite plugin and the CLI), `importAndCompile` (compiles the CLI's `--example` in such a worker) and `loadRuntimeFacts`/`compileWithSystem` (in this process, under a TypeScript loader; library API only). Also an internal build entry (`dist/runtime-facts.mjs`), which the built worker imports. |
| `src/runtime-worker.mjs` | The worker `importRuntimeFacts` and `importAndCompile` start: registers tsx (with the source tsconfig's `paths` when given), imports the System and Core's inspection entry in one namespace, posts the facts (or the compile outcome). Plain JavaScript, so it needs no loader to start; the build copies it into `dist` as written. It takes `collectRuntimeFacts` from the built `runtime-facts.mjs` beside it when there is one (`dist`), and otherwise from `runtime-facts.ts` through tsx (`src`). |
| `src/ir.ts` | The IR types (and the JSON form of `plugin.docs` the runtime facts carry). The IR is plain JSON; emitters never touch the compiler. |
| `src/encoding.ts` | The config value re-encoding of the LLM profile (dictionary to entry list, opaque values to JSON text), shared by the schema emitter and the converters. |
| `src/schema.ts` | `emitFullSchema` (tree), `emitLlmSchema` (flat, LLM profile) and `emitConfigSchema` (one plugin's `config.raw`, full profile). |
| `src/docs-types.ts`, `src/docs.ts` | The `WidgetDocs` and `WidgetDocsSlim` object types (no imports; the `./docs` subpath), `emitDocs(ir)` and `slimDocs(docs)`. |
| `src/docs-cache.ts` | `createDocsCache`: generate a System's docs, or read them from the disk cache. |
| `src/vite.ts` | `widgetDocs(options)`, the `./vite` subpath. A Vite or Vitest config imports it by package name (see "The Vite plugin"). |
| `virtual-widget-docs.d.ts`, `virtual-widget-docs-slim.d.ts` | `declare module 'virtual:widget-docs/*'` as `WidgetDocs` or `WidgetDocsSlim`, exported as `@deviltea/widget-docs-generator/virtual-widget-docs` and `/virtual-widget-docs-slim` (they stay at the package root, outside `dist`). |
| `src/flat.ts` | `createFlatConverter(ir)`: `treeToFlat` and `flatToTree`. |
| `src/skills.ts` | The three Markdown skills. |
| `src/check.ts` | `--check`. |
| `src/validate.ts` | A small validator for the keywords the emitters produce (the repository has no Draft 2020-12 validator). |
| `src/cli.ts`, `src/generate.ts` | The command line (the bin `widget-docs-generator`, `dist/cli.mjs`) and the file map it writes. |
| `fixtures/survey-system.ts` | The fixture System: fully documented in the builder, and it exercises every feature (config `raw` field docs whose prose states the constraints, type docs shared through `ref`, a `WidgetRef`, an omittable config, record slots in all three forms, reasons with and without payload, State with `authorWritable`, Properties, Methods, Events, descriptions with remarks). |
| `fixtures/survey-example.json` | The example document of the fixture's authoring skill, compiled by the CLI before it is published. |
| `src/fixtures/undocumented-system.ts` | The `--check` fixture: `undocumented` on a config, a slot, a State member, a Method parameter and inner fields, and a `WidgetContract` slot without `Types`. |
| `src/fixtures/shapes-system.ts` | The shape fixture for what the survey fixture does not reach: arrays and dictionaries of primitives, a named type behind an optional property and inside a written union, a recursive type documented through a `ref` thunk, aliases, a list of widget references, Core's recursive `JsonValue`, and one named type used as the raw and the resolved config. |
| `examples/survey/` | Generated output for the fixture System. Never hand-edit; regenerate. Two tests compare it with what the generator writes: in process from the sources, and through the built bin. |
| `tsdown.config.ts` | The build: the entries above plus `cli` and the internal `runtime-facts`, the worker copied as written, Core never bundled. |

The Lab's showcases write their documentation in the builder (0.4) and load it through this plugin (`apps/lab/widget-docs.ts`); the fixture System stays the example and the test subject.

## Commands

```bash
pnpm --filter @deviltea/widget-docs-generator... build          # Core, then this package (tsdown, into dist)
pnpm --filter @deviltea/widget-docs-generator generate:example   # rewrites examples/survey with the built bin
pnpm --filter @deviltea/widget-docs-generator check:example      # exits 1 on an undocumented marker, a name mismatch or a docs conflict
pnpm --filter @deviltea/widget-docs-generator test
pnpm --filter @deviltea/widget-docs-generator typecheck
```

The bin runs with plain Node (`widget-docs-generator ...`, or `node dist/cli.mjs ...` here; the `generate:example` and `check:example` scripts need a build first). It **imports and therefore executes the System's module** (and everything that module imports) to read every `plugin.docs` (all the prose), for the runtime cross-check and to compile `--example`: through tsx in a worker thread, like the Vite plugin, so it needs no loader of its own. Only point it at a module you would run; `--no-runtime` skips the import, the cross-check, `authorWritable` and the prose (the output then has the shape only, and `--check` reports `no-docs`). tsx compiles the module with the tsconfig the type checker uses (`--tsconfig`, or the nearest `tsconfig.json`); `--source-tsconfig <path>` adds a tsconfig's `paths` for the type checker and for tsx (for example to resolve workspace packages to source).

The System's module and Core's inspection entry must come from one Core instance (Core brands its plugins per module instance). `loadRuntimeFacts` (library API, in process) resolves `@deviltea/widget-core/inspection` from the System module's own `node_modules` first and as this package sees it second, and uses the first `inspectPlugin` that accepts the System's plugins. `importRuntimeFacts` (the plugin and the CLI) imports both through one tsx namespace, from the System module's location, inside a `worker_threads` Worker that is terminated after the run: nothing the module loads stays in the Vite process (the old in-process namespaces grew the heap by about 0.8 MB per regeneration), and the next run sees edited files. A run costs about 0.2 s more than an in-process import (worker start and a fresh tsx), on top of the program build of a miss.

`--example <json>` is a complete document shown in the authoring skill. The CLI refuses it unless it compiles to a `valid` Blueprint and passes the full schema. `--out` removes the files a previous run wrote and this run does not, using the `.generated.json` manifest it leaves in the output directory; it never deletes anything else.

Tests run in the root `docs-generator` Vitest project (no Lab plugins or setup) or with this package's `vitest.config.ts`; both load `widgetDocs` from the sources by relative path, with the fixture System (keep their options in step), and a test imports `virtual:widget-docs/survey` through it. The sources, not `dist`: the tests import the sources they test, and the plugin then matches them without a rebuild. They import the built `@deviltea/widget-core`, and `package.unit.test.ts` and `vite-config.unit.test.ts` run this package's built `dist` in plain Node (the subpaths, the `./runtime` chunk graph, the worker, the generator hash of the cache key, the bin): build first (`pnpm --filter @deviltea/widget-docs-generator... build`, or `pnpm build`). Only hooks and tests that build TypeScript programs have long timeouts. The plugin tests write their files under the OS temporary directory and remove them.

## The Vite plugin

```text
// vite.config.ts (the Lab: apps/lab/widget-docs.ts)
import { widgetDocs } from '@deviltea/widget-docs-generator/vite'

widgetDocs({
	systems: {
		onboarding: { module: 'src/showcases/onboarding/system.ts', export: 'onboardingSystem', tsconfig: 'tsconfig.app.json' },
	},
	// cacheDir: 'node_modules/.cache/widget-docs' (default, relative to Vite's root); false disables the disk cache
	// runtime: true (default): import the System for the cross-check
	// slim: false (default): true serves WidgetDocsSlim
})

import docs from 'virtual:widget-docs/onboarding' // WidgetDocs
```

- Import the plugin by package name (`@deviltea/widget-docs-generator/vite`). Vite leaves a config's bare imports to Node, which loads the built `dist/vite.mjs`; `vite` is an optional peer, needed only for this subpath. The config must be an ES module (a `"type": "module"` project or a `.mts` config): the package is ESM only. This package's own test configs import `./src/vite` by relative path instead, so its tests run against the sources (Vite bundles a config's relative imports). `src/vite-config.unit.test.ts` loads both spellings through Vite's `loadConfigFromFile`.
- Pass each System's `tsconfig`: the one the module is compiled with (the Lab: `tsconfig.app.json`). Without it the nearest `tsconfig.json` above the module is used, which in a project with references is a solution file (`"files": []`). `readProgramConfig` refuses a tsconfig that does not include the module or compiles without `strictNullChecks` (which erases every `| null` and would be cached silently).
- Each key of `systems` is a virtual module `virtual:widget-docs/<name>` (`<name>` matches `[\w.-]+`). Paths are relative to Vite's `root`. Its default export is a `WidgetDocs` object (`WIDGET_DOCS_VERSION` 2): every text carries the summary (the description's first paragraph) and the remarks (the rest), `tags` with `widgetRef` (`A | B`) on a member whose value is a `WidgetRef`, or a list or dictionary of them, and the keys `example`, `see`, `deprecated` and `defaultValue`, which stay empty (their JSDoc tags are retired; the keys remain so the shape does not change); per plugin type its text and `typeNames` (the named types it mentions); `config` (description, `omittable`, printed raw/resolved types, and the JSON Schema of `config.raw`, Draft 2020-12, full profile); `slots` (description, `expectedTypes` or `null` for any widget, the contract's `Shape`, the expectation as written); `state` (with `authorWritable`), `properties`, `methods` (signature, parameters, returns), `events` (labelled payload, each position with its `summary`; an added key) with descriptions and printed types; `reasons` (description and the `details` type, `null` for `void`). A section is `null` when the capability is not declared and `{}` when it is declared empty. `types` lists every named type by name: its text, the declaration as written, and the fields of an object type with their texts and `optional`.
- Generating **imports the System's module, which runs its top-level code** and that of everything it imports, through tsx in a worker thread that is terminated after the run. With `sourceTsconfig`, tsx gets the same `paths` as the type checker (a temporary tsconfig extends `tsconfig` and adds them), so types and runtime read the same files. `runtime: false` skips the import, the cross-check, `authorWritable` and the prose.
- A name mismatch between the types and the runtime fails the load with the list. Documentation problems (what `--check` reports) are a Vite warning, on a fresh generation and on a cache hit, never an error.
- It works in `vite dev`, `vite build` and Vitest. In dev the System's input files and missing import locations are added to Vite's watcher; a change to one (an edit, a created or deleted file) invalidates only the virtual modules of the Systems that read it (`watchChange`, also without HMR), and on an edit `handleHotUpdate` returns them to Vite, which updates or reloads their importers. Any other file regenerates nothing. In a build, the inputs are Rollup watch files.
- `slim: true` serves `WidgetDocsSlim` instead (`slimDocs`): per plugin the summary and remarks of the plugin, its config, slots and Events, and the config schema; no `types`, printed types, tags, State, Properties, Methods or reasons. It is for an authoring UI that bundles the docs (the Lab: the eager shell chunk). The disk cache always holds the full docs and the projection happens when the module is loaded, so the option is not part of the cache key and switching it regenerates nothing.
- Types: add `@deviltea/widget-docs-generator/virtual-widget-docs` (or, with `slim: true`, `@deviltea/widget-docs-generator/virtual-widget-docs-slim`) to `compilerOptions.types` (or a `/// <reference types>`).

### Cache

`src/docs-cache.ts` decides between generating and reading. A hit builds no TypeScript program and imports nothing (the fixture: about 1.5 s cold, under 10 ms warm).

- Key: a SHA-256 over the content of every file the TypeScript program loaded that is not under a `node_modules` directory (the System's sources, what they import, and workspace packages such as Core's built declarations, which resolve to their real paths), the run-time JavaScript next to each of those declaration files (`X.mjs` next to `X.d.mts`, `X.js` next to `X.d.ts`, `X.cjs` next to `X.d.cts`; the runtime cross-check imports it), the nearest `package.json` of each of these files, the tsconfig files the options come from (the tsconfig, what it `extends` outside `node_modules`, the source tsconfig), the hash of the nearest lockfile above the root and of the installed state of the nearest `node_modules` above the root (`.pnpm/lock.yaml`, `.modules.yaml`, `.package-lock.json`, `.yarn-state.yml`; together they stand for every file under `node_modules`, TypeScript's libraries included), the System options (module, export, tsconfig paths, `runtime`), and the generator (a hash of the `.ts` and `.mjs` files beside the running module, without tests: `src` from the sources, the built chunks and the worker from `dist`; and `WIDGET_DOCS_VERSION`).
- Files, in `node_modules/.cache/widget-docs/` under Vite's root: `<name>.manifest.json` (`{ key, fixed, files }`, the input list of the last generation) and `<key>.json` (`{ key, docs, check }`: the `--check` result is stored, so a hit reports the same documentation problems as the generation). A hit is: the manifest's `fixed` part matches, the listed files hash to its `key`, and `<key>.json` holds that key. A miss builds the program, regenerates, writes both files atomically (temporary file and rename) and removes the entry the manifest pointed at before. An unreadable, corrupt or mismatching file is a miss.
- A program with an unresolved import outside `node_modules` (a relative import of a file that does not exist yet, a `paths` alias to nothing) is never cached, since creating the file changes no hashed input. The locations TypeScript looked at are returned as `missing`; in dev the plugin watches them, and creating one invalidates the System (`watchChange`, with or without HMR). An unresolved bare import that only looked under `node_modules` does not count: installing the package changes the lockfile or the installed state.
- Writing is best effort: when the cache cannot be written (read-only file system, no permission, any error) the docs are still served and the plugin logs one warning. `WIDGET_DOCS_CACHE=off` in the environment bypasses the cache entirely (nothing read, nothing written).
- Clear it by deleting the directory (`rm -rf node_modules/.cache/widget-docs`). Nothing else reads it.
- Not covered by the key: the run-time JavaScript of a dependency under `node_modules` (an install changes the installed state, a hand edit does not), and a file that changes module resolution without being an unresolved lookup location or changing a listed file (for example a new `index.ts` that shadows a resolved `index.d.ts`).

## LLM schema profile

`emitLlmSchema` writes one conservative profile. Keep these rules; `docs-generator.unit.test.ts` walks the schema and rejects violations.

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
- A description is appended to, never replaced: the description from `plugin.docs` comes first, then the widget-reference sentence and the structural note (for a dictionary: that it is an entry list here).
- Each node type says which slots may hold it: the slots that name it (a plain union, or a contract's `Types`) and the slots that take any widget (`WidgetChild`, a contract without `Types`). Slot expectations are the plugin's intent; Core does not check them at run time, so the schema states them as prose.

The principle behind all of it: the schema only gets the structure roughly right, Blueprint compilation and its diagnostics are the arbiter, and effort goes into descriptions.

The full schema (`emitFullSchema`) is the tree as authored: one `$defs` entry per widget type and per named config type, recursion through `#/$defs/widget`, slot children restricted to the expected types, the shape only (no constraint keyword; a widget reference is a string with `x-widgetRef`, the types it names, beside the sentence in its description), and `meta` allowed on every node as any JSON value. `emitConfigSchema` is the same profile for one plugin's `config.raw`, with only the `$defs` it reaches and an `anyOf` with `null` when the config may be left out.

## Flat and tree converters

`flatToTree(treeToFlat(tree))` must deep-equal `tree` for a well-formed tree, including `meta`, empty slot arrays, an explicit `config: null`, unrecognized widget keys and config values that do not fit the declared shape (they pass through, so Core still diagnoses them). A key the tree leaves out is left out of the node. `treeToFlat` throws `FlatConversionError` for what the flat form cannot name: a node without string `id`/`type`, a repeated id, a widget key called `parent` or `slot`. `flatToTree` throws on no root, several roots, a root that names a slot, an unknown parent, a repeated id or a cycle.

A union value is encoded as the member it belongs to: the member whose literal discriminant properties equal the value's and whose required keys are all present, preferring one that declares every key of the value. A value that fits no member passes through.

## Prose from `plugin.docs`

`applyPluginDocs` (`src/prose.ts`) reads each plugin's `plugin.docs` beside the shapes the types give:

- A description is Markdown prose; its first paragraph is the `summary`, the rest (after the first blank line) the `remarks`. `undocumented` is `null` there, and reads as an empty text.
- The plugin, its config, every slot, State member, Property, Method (`params` by position, `returns`), Event (`payload` by position) and reason (`details`) take the description written beside their definition.
- A docs node's `fields` document the properties of the object types at its position (every member of a union: one entry per key, so a key several members share has one description), `items` the element of an array, `values` the value of a dictionary. An object type with an index signature and fixed keys is a dictionary, as in Core: `values` documents it, and its fixed keys take the same docs.
- A named type has one `$defs` entry, so its docs are gathered from every place that documents it: the type docs a `ref` names (`defineTypeDocs`), and the inline docs where it is used. The places must say the same (`docs-conflict` otherwise); a place that writes only a description (a dictionary of strings) is not compared. The type's own description comes from its type docs, or from a docs position that holds the type itself (`config.raw`, `config.resolved`, `items`, `values`, a reason's `details`); a field, parameter or payload description describes that position, not the type. A description written beside a `ref` at such a position is a candidate for the type's description too: one that differs from the type docs' is a `docs-conflict`. A description at such a position whose value is not one named type, and is not kept as an items or values description, can appear nowhere: `unused-doc`.
- A `ref` names type docs by name: that name must be the type's own name (`name-mismatch` otherwise), since it is the type's `$defs` entry. Type docs with one name from several plugins of one System must be identical.
- The description of an array's items or a dictionary's values (when the element is not a named type) is kept on the container shape (`itemsDoc`, `valuesDoc`, `additionalDoc`) and becomes the item or value schema's description.
- Constraints (`@minimum`, `@pattern`, ...) are retired: a constraint is prose in the description, and `validate` enforces it. The schemas have the shape only.
- A widget reference is a type: `WidgetRef<Types>` (Core's brand, read like `WidgetRefTypesOf`) is a string shape with `widgetRef`, in the order the types are written. The full profile annotates it with `x-widgetRef` and both profiles add the sentence "Must be the id of a widget of type A | B in the same document." to its description, where `@widgetRef` put it (prose for human and LLM readers; the Lab reads `x-widgetRef`, not the sentence); the docs object names it in the `tags.widgetRef` of the member whose value is a reference, or a list or dictionary of references (the sentence and `x-widgetRef` then sit on the item or value schema).

## `--check`

Prints one line per problem plus the documented/total count of descriptions, and exits 1 when there is a problem (every problem is an error).

- `undocumented`: an `undocumented` marker (`null` in `plugin.docs`), with its plugin and docs path (`Counter: state.step`).
- `missing-doc`: a field or position the types declare and documented docs leave out (only possible for an untyped plugin: Core's types require it), or a plugin without `plugin.docs`.
- `name-mismatch`: a capability declared on one side only (all six), or a plugin type, slot, State member, Property or Event the types and the runtime disagree on; and a section member (Methods included), field, parameter or payload position the types and `plugin.docs` disagree on, or a `ref` whose type docs name is not the type's name.
- `docs-conflict`: a named type documented differently in two places (two type docs with one name, inline docs that differ, or a description beside a `ref` that differs from the type docs).
- `unused-doc`: a description no output can show (at `config.raw`, `config.resolved` or a reason's `details` of a value that is not one named type).
- `no-docs`: the System was not imported (`--no-runtime`, `runtime: false`), so no prose was read.

Generating (the CLI without `--check`, and the Vite plugin) refuses only on a name mismatch between the types and the runtime.

## What is generated and what is hand-written

- Generated from the IR: every `references/<type>.md` of the two System skills (config with its fields and named types, slots with their expectations, reasons with their `details`, Events with their payload docs), both schemas, `example-interfaces.md`, the type lists and the registration chain inside the `SKILL.md` files, the example document (from `--example`), and the docs object.
- Hand-written in `src/skills.ts` and to be kept in step with the packages by hand: the node grammar, the flat-to-tree conversion rules and the validate-and-repair section; the registration notes, the `useWidget()` accessor table and the renderer rules (from the public exports of `@deviltea/widget-vue`: a State or Property ref is `T | null`, a Method call returns its value or `null`, diagnostics are typed by the declared reasons, `WidgetSlot`'s `type` is narrowed to the slot's expectation); the whole `widget-plugin-authoring` skill and its `references/plugin-docs.md`. They describe the Core 0.4 builder (Discussion #12, "Descriptions live in the plugin builder"), and they never mention JSDoc or constraint tags.
- The skills must stand alone: they never tell a reader to import this package. They must not claim that a failed Method call is rolled back; Core's batching is propagation atomicity, not a transaction (`docs/site/packages/widget-core.md`, "Runtime Methods").
- Generated TypeScript excerpts use the `text` info string: `scripts/docs-samples.unit.test.ts` walks every Markdown file, the committed examples included, and requires a sample marker on each `ts` fence.

## Known limits

- A slot expectation is read structurally: string literals are plugin types, and `WidgetContract` is recognized by its symbol name and type arguments. Any other expectation (which Core rejects at `.interfaces()`) is an extraction error, and so is the 0.2 union-of-names form.
- Named types with type arguments are expanded inline, not named. Two different declarations with one name get a numeric suffix.
- A property written as a union (`boolean | Condition`) or declared optional (`visibleWhen?: Condition`) is read from its type annotation, so the named types in it stay `$ref`s (the checker flattens such a union and would lose the names); an annotation that is not the property's type (an instantiated generic member) falls back to the checker's type. A union alias nested in another union (`Condition = LeafCondition | ...`) is still flattened into its members.
- A recursive type without a name of its own (a type from a dependency, such as Core's `JsonValue`) is untyped (`{}` in the full profile, JSON text in the flat form) instead of being expanded.
- An untyped or recursive config value is JSON text in the flat form.
- Method effects (State written, Events emitted) are not in the IR: Core's inspection does not expose `emits`.
- `validate.ts` does not evaluate `format` or `pattern`, and throws on any keyword it does not implement.
- Not handled yet: a tuple keeps only the union of its element types; an object with both declared properties and a string index signature types the other keys (`additionalProperties`) in the full profile, but the LLM profile keeps it closed and only says so in its description; the excerpt of an interface that `extends` another does not include the base; a type nested deeper than 16 levels becomes untyped without a warning.
- The authoring skill explains the flat-to-tree conversion in prose only; it ships no script.
- A named type without an object part (a literal union such as `RoundStep`, an alias of `string[]`) has no type docs: Core takes `ref` only for object types, so its `$defs` entry has no description of its own; the description of the field that uses it says what it is.
- A named type that is a member of a union at a field (`split: EqualSplitRaw | PercentSplitRaw`) gets no type-level description: a `ref` takes one type, and a description at a field describes the field, so the prose of each member sits in the field's description.
- Two declarations with one name are told apart by a numeric suffix (`Foo`, `Foo2`), but type docs keep the name they were given: `defineTypeDocs('Foo', …)` referred to from a field of the second `Foo` is a `name-mismatch` (its `$defs` entry is `Foo2`). Give the types different names.
- The types of a `WidgetRef` are put in written order from the annotation of the property that holds it; a `WidgetRef` behind a type alias of its own (`type Target = WidgetRef<'A' | 'B'>`) keeps the checker's order, which is the order the literal types were first created.
- A key that several members of a union share has one description (Core's field docs document a union key by key), so per-member wording (a different `op` per condition branch) is merged into one text; what differs per member in the type (a `WidgetRef`'s types) stays per member.
- The excerpts of named types in the skills quote the declarations as written; their descriptions are listed under them, not written into the declaration.
- Without the runtime (`--no-runtime`, `runtime: false`) there is no prose: everything else is generated, every text is empty, and `--check` reports `no-docs`.
- The runtime cross-check imports the System's module in a tsx namespace, which needs the module to load as ESM (a `package.json` with `"type": "module"` above it, or `.mts`). A CommonJS-typed `.ts` file fails with `Cannot find module ...?namespace=widget-docs`.
