# AGENTS.md

## Scope

`@deviltea/widget-skills` is a private prototype. It turns a Widget System's TypeScript types and JSDoc into AI-facing artifacts: an IR, two JSON Schemas, flat/tree converters, and three Agent Skills. It is not published, has no version policy, and is not part of the release scripts or `check:versions`.

The design it prototypes is recorded in `DevilTea/widget` Discussion #12 ("Interfaces are the single source of a plugin's shape and documentation (0.3.0)"): a plugin's `XxxInterfaces` type plus JSDoc is the single source of documentation. Until 0.3.0 lands, `slots` is still a string-literal union and descriptions still exist at runtime; the extractor reads both slot forms and uses runtime descriptions only as fallback text.

| File | Role |
| --- | --- |
| `src/extract.ts` | TypeScript checker walk: `typeof system` -> `plugins` tuple -> `WidgetPlugin<Type, Interfaces>` -> members and JSDoc. Produces the IR. |
| `src/runtime-facts.ts` | Reads `system.catalog` and `inspectPlugin` into plain data for the name cross-check. |
| `src/ir.ts` | The IR types and the tag lists. The IR is plain JSON; emitters never touch the compiler. |
| `src/encoding.ts` | The config value re-encoding of the LLM profile (dictionary to entry list, opaque values to JSON text), shared by the schema emitter and the converters. |
| `src/schema.ts` | `emitFullSchema` (tree) and `emitLlmSchema` (flat, LLM profile). |
| `src/flat.ts` | `createFlatConverter(ir)`: `treeToFlat` and `flatToTree`. |
| `src/skills.ts` | The three Markdown skills. |
| `src/check.ts` | `--check`. |
| `src/validate.ts` | A small validator for the keywords the emitters produce (the repository has no Draft 2020-12 validator). |
| `src/cli.ts`, `src/generate.ts` | Command line and the file map it writes. |
| `fixtures/onboarding-example.json` | The example document of the onboarding authoring skill: the default preset, compiled by the CLI before it is published. |
| `examples/onboarding/` | Generated output for the onboarding showcase. Never hand-edit; regenerate. A test compares it with what the generator writes. |

## Commands

```bash
pnpm --filter @deviltea/widget-skills generate:onboarding   # rewrites examples/onboarding
pnpm --filter @deviltea/widget-skills check:onboarding      # exits 1 while onboarding members lack JSDoc
pnpm --filter @deviltea/widget-skills test
pnpm --filter @deviltea/widget-skills typecheck
```

The CLI runs under `tsx`, because it **imports and therefore executes the System's module** (and everything that module imports) for the runtime cross-check and to compile `--example`. Only point it at a module you would run; `--no-runtime` skips the import, the cross-check and `authorWritable`. `--tsconfig ./tsconfig.source.json` (for tsx) and `--source-tsconfig ./tsconfig.source.json` (for the type checker) resolve the workspace packages to source, so generating needs no prior build.

The System's module and Core's inspection entry must come from one Core instance (Core brands its plugins per module instance). `loadRuntimeFacts` resolves `@deviltea/widget-core/inspection` from the System module's own `node_modules` first and as this package sees it second, and uses the first `inspectPlugin` that accepts the System's plugins.

`--example <json>` is a complete document shown in the authoring skill. The CLI refuses it unless it compiles to a `valid` Blueprint and passes the full schema. `--out` removes the files a previous run wrote and this run does not, using the `.generated.json` manifest it leaves in the output directory; it never deletes anything else.

Tests run in the root `widget-skills` Vitest project (no Lab plugins or setup) or with this package's `vitest.config.ts`. They import the built `@deviltea/widget-core`, so run `pnpm build` first. Only the `beforeAll` that builds the TypeScript programs has a long timeout.

## LLM schema profile

`emitLlmSchema` writes one conservative profile. Keep these rules; `widget-skills.unit.test.ts` walks the schema and rejects violations.

- JSON Schema Draft 2020-12 syntax; the root is an object.
- Keywords: `type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`, `$defs`/`$ref`, `additionalProperties`, `description` (and `$schema`, `title`). Nothing else.
- `anyOf` never shares an object with `type` or `properties`.
- No recursion through `$ref`. A recursive named type becomes JSON text.
- Every object has `additionalProperties: false`.
- An optional property is left out of `required`. There is no `null` union for optionality: that is the strict-mode spelling, and it spends the provider's budget of union-typed and optional parameters (the sizes the profile is held to are 24 optional and 16 union-typed parameters; a test counts them for onboarding). The profile is meant for non-strict structured output.
- Every constraint (ranges, lengths, pattern, format, widget references) is prose in `description`, never a keyword.
- A dictionary is an array of `{ key, value }`.
- The document is a flat node list: `{ nodes: [{ id, type, parent?, slot?, config?, slots? }] }`. The root has no `parent` and no `slot`. `slots` lists slot names and is only needed for a slot without children.
- `meta` is not in the LLM schema (a model never writes it); the converters carry it.
- `$defs` keys are restricted to `[A-Za-z0-9_.-]` (`node_<Type>`, `type_<Name>`, sanitized, with a numeric suffix on collision), so no JSON Pointer needs escaping. The `type` value keeps the original name.
- A description is appended to, never replaced: the JSDoc text comes first, then the structural note (for a dictionary: that it is an entry list here). `@default` and `@examples` values are rewritten into the encoded form.
- Where a type may be placed is only stated when a slot names its expected children (the 0.3 record form). With the 0.2 string-union form the schema claims nothing per type.

The principle behind all of it: the schema only gets the structure roughly right, Blueprint compilation and its diagnostics are the arbiter, and effort goes into descriptions.

The full schema (`emitFullSchema`) is the tree as authored: one `$defs` entry per widget type and per named config type, recursion through `#/$defs/widget`, constraint tags as keywords, and `meta` allowed on every node as any JSON value.

## Flat and tree converters

`flatToTree(treeToFlat(tree))` must deep-equal `tree` for a well-formed tree, including `meta`, empty slot arrays, an explicit `config: null`, unrecognized widget keys and config values that do not fit the declared shape (they pass through, so Core still diagnoses them). A key the tree leaves out is left out of the node. `treeToFlat` throws `FlatConversionError` for what the flat form cannot name: a node without string `id`/`type`, a repeated id, a widget key called `parent` or `slot`. `flatToTree` throws on no root, several roots, a root that names a slot, an unknown parent, a repeated id or a cycle.

A union value is encoded as the member it belongs to: the member whose literal discriminant properties equal the value's and whose required keys are all present, preferring one that declares every key of the value. A value that fits no member passes through.

## JSDoc tag set

TSDoc-compatible; the custom tags are declared in `tsdoc.json`. `CONSTRAINT_TAGS` and `PROSE_TAGS` in `src/ir.ts` are the lists the code uses: change all three together.

- Summary (first paragraph) and `@remarks`: every member.
- `@format`, `@pattern`, `@minLength`, `@maxLength`: strings.
- `@minimum`, `@maximum`, `@exclusiveMinimum`, `@exclusiveMaximum`, `@multipleOf`: numbers.
- `@minItems`, `@maxItems`: arrays.
- `@default`, `@examples`: JSON values.
- `@widgetRef A | B`: the string is the id of a widget of one of these types.
- `@param name - text`, `@returns`: Methods. Also accepted without a meaning for the schemas: the standard TSDoc tags `@see`, `@example`, `@deprecated`, `@throws`, `@defaultValue`, `@typeParam`, `@privateRemarks`, `@internal`, `@alpha`, `@beta`, `@public`, `@experimental`.

Tags document; `config.validate` and the State and Method validators enforce.

## `--check`

Prints one line per problem plus the documented/total count, and exits 1 when there is an error. Warnings never fail it.

- `missing-doc`, error: a plugin (the JSDoc of its Interfaces type), a slot, State member, Property, Method, Method parameter (`@param`), Event or reason without documentation; a field of an inline object type one of them uses; a named type reachable from `config.raw`, or one of its fields.
- `missing-doc`, warning: a named type (or one of its fields) reachable only from a resolved config, a State or Property value, a Method signature or an Event payload. Renderer authors read those; document authors do not write them.
- Until 0.3.0 the runtime still carries descriptions, so a plugin, an Event and a slot of the string-union form (which has no place for JSDoc) count as documented when their runtime description is non-empty. A slot of the record form needs JSDoc.
- `unknown-tag`, error: a tag outside `CONSTRAINT_TAGS` and `PROSE_TAGS`.
- `name-mismatch`: a plugin type, slot, State member, Property or Event the types and the runtime disagree on, or a config/Methods capability present on one side only. `inspectPlugin` has no Method inventory, so Method names are not cross-checked.

Generating (without `--check`) refuses only on a name mismatch. Do not add JSDoc to the onboarding plugins to make `check:onboarding` pass: they are migrated with 0.3.0.

## What is generated and what is hand-written

- Generated from the IR: every `references/<type>.md` of the two System skills, both schemas, `example-interfaces.md`, the type lists and the registration chain inside the `SKILL.md` files, and the example document (from `--example`).
- Hand-written in `src/skills.ts` and to be kept in step with the packages by hand: the node grammar, the flat-to-tree conversion rules and the validate-and-repair section; the registration notes, the `useWidget()` accessor table and the renderer rules (from the public exports of `@deviltea/widget-vue`: a State or Property ref is `T | null`, a Method call returns its value or `null`); the whole `widget-plugin-authoring` skill and the tag table. These describe the API on `main` (required `description` on config, slots and Events; no `reasons`); the 0.3 changes are in a marked "Upcoming" section.
- The skills must stand alone: they never tell a reader to import this private package. They must not claim that a failed Method call is rolled back; Core's batching is propagation atomicity, not a transaction (`docs/site/packages/widget-core.md`, "Runtime Methods").
- Generated TypeScript excerpts use the `text` info string: `scripts/docs-samples.unit.test.ts` walks every Markdown file, the committed examples included, and requires a sample marker on each `ts` fence.

## Known limits

- A slot's expected children are only known in the 0.3 record form; the reading of `Expected` (string-literal union, or types carrying a literal `type`) is a guess until 0.3.0 exists. In the 0.2 form every registered type is allowed in every slot.
- `reasons` is read as a record of reason to payload type, untested against a real plugin.
- Named types with type arguments are expanded inline, not named. Two different declarations with one name get a numeric suffix.
- An untyped or recursive config value is JSON text in the flat form.
- Method effects (State written, Events emitted) are not in the IR: Core's inspection does not expose `emits`.
- `validate.ts` does not evaluate `format` or `pattern`, and throws on any keyword it does not implement.
- A wide `slots: string` is read as an open slot set whose names come from the runtime. Core's builder refuses that type, so it only arises from a cast; the fixture does exactly that.
- Not handled yet: a tuple keeps only the union of its element types; an object with both declared properties and an index signature loses the index signature; JSDoc tags on a type alias apply to the alias, not to each use; the excerpt of an interface that `extends` another does not include the base; a type nested deeper than 16 levels becomes untyped without a warning.
- The authoring skill explains the flat-to-tree conversion in prose only; it ships no script.
