# AGENTS.md

## Scope

`@deviltea/widget-skills` is a private prototype. It turns a Widget System's TypeScript types and JSDoc into AI-facing artifacts: an IR, two JSON Schemas, flat/tree converters, and three Agent Skills. It is not published, has no version policy, and is not part of the release scripts or `check:versions`.

The design it prototypes is recorded in `DevilTea/widget` Discussion #12 ("Interfaces are the single source of a plugin's shape and documentation (0.3.0)"): a plugin's `XxxInterfaces` type plus JSDoc is the single source of documentation. Until 0.3.0 lands, `slots` is still a string-literal union and descriptions still exist at runtime; the extractor reads both slot forms and uses runtime descriptions only as fallback text.

| File | Role |
| --- | --- |
| `src/extract.ts` | TypeScript checker walk: `typeof system` -> `plugins` tuple -> `WidgetPlugin<Type, Interfaces>` -> members and JSDoc. Produces the IR. |
| `src/runtime-facts.ts` | Reads `system.catalog` and `inspectPlugin` into plain data for the name cross-check. |
| `src/ir.ts` | The IR types and the tag lists. The IR is plain JSON; emitters never touch the compiler. |
| `src/schema.ts` | `emitFullSchema` (tree) and `emitLlmSchema` (flat, LLM profile). |
| `src/flat.ts` | `createFlatConverter(ir)`: `treeToFlat` and `flatToTree`. |
| `src/skills.ts` | The three Markdown skills. |
| `src/check.ts` | `--check`. |
| `src/validate.ts` | A small validator for the keywords the emitters produce (the repository has no Draft 2020-12 validator). |
| `src/cli.ts`, `src/generate.ts` | Command line and the file map it writes. |
| `examples/onboarding/` | Generated output for the onboarding showcase. Never hand-edit; regenerate. |

## Commands

```bash
pnpm --filter @deviltea/widget-skills generate:onboarding   # rewrites examples/onboarding
pnpm --filter @deviltea/widget-skills check:onboarding      # exits 1 while onboarding members lack JSDoc
pnpm --filter @deviltea/widget-skills test
pnpm --filter @deviltea/widget-skills typecheck
```

The CLI runs under `tsx`, because it imports the System's module for the runtime cross-check. `--tsconfig ./tsconfig.source.json` (for tsx) and `--source-tsconfig ./tsconfig.source.json` (for the type checker) resolve the workspace packages to source, so generating needs no prior build. The System's module and Core's inspection entry must come from one Core instance (Core brands its plugins per module instance); `loadRuntimeFacts` imports both from the same module graph for that reason.

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

The principle behind all of it: the schema only gets the structure roughly right, Blueprint compilation and its diagnostics are the arbiter, and effort goes into descriptions.

The full schema (`emitFullSchema`) is the tree as authored: one `$defs` entry per widget type and per named config type, recursion through `#/$defs/widget`, constraint tags as keywords, and `meta` allowed on every node as any JSON value.

## Flat and tree converters

`flatToTree(treeToFlat(tree))` must deep-equal `tree` for a well-formed tree, including `meta`, empty slot arrays, an explicit `config: null`, unrecognized widget keys and config values that do not fit the declared shape (they pass through, so Core still diagnoses them). A key the tree leaves out is left out of the node. `treeToFlat` throws `FlatConversionError` for what the flat form cannot name: a node without string `id`/`type`, a repeated id, a widget key called `parent` or `slot`.

## JSDoc tag set

TSDoc-compatible; the custom tags are declared in `tsdoc.json`. `CONSTRAINT_TAGS` and `PROSE_TAGS` in `src/ir.ts` are the lists the code uses: change all three together.

- Summary (first paragraph) and `@remarks`: every member.
- `@format`, `@pattern`, `@minLength`, `@maxLength`: strings.
- `@minimum`, `@maximum`, `@exclusiveMinimum`, `@exclusiveMaximum`, `@multipleOf`: numbers.
- `@minItems`, `@maxItems`: arrays.
- `@default`, `@examples`: JSON values.
- `@widgetRef A | B`: the string is the id of a widget of one of these types.
- `@param name - text`, `@returns`: Methods. Also accepted without a meaning for the schemas: `@see`, `@example`, `@deprecated`, `@throws`.

Tags document; `config.validate` and the State and Method validators enforce.

## `--check`

Exits 1 when any of these holds, and prints one line per problem plus the documented/total count:

- `missing-doc`: a member without a JSDoc summary. Members are: each plugin (the JSDoc of its Interfaces type), each property of the raw config shape, each slot, State member, Property, Method, Event and reason, and each named type the plugin mentions together with its properties.
- `unknown-tag`: a tag outside `CONSTRAINT_TAGS` and `PROSE_TAGS`.
- `name-mismatch`: a plugin type, slot, State member, Property or Event the types and the runtime disagree on, or a config/Methods capability present on one side only. `inspectPlugin` has no Method inventory, so Method names are not cross-checked.

Generating (without `--check`) refuses only on a name mismatch. Do not add JSDoc to the onboarding plugins to make `check:onboarding` pass: they are migrated with 0.3.0.

## What is generated and what is hand-written

- Generated from the IR: every `references/<type>.md` of the two System skills, both schemas, `example-interfaces.md`, and the type lists inside the `SKILL.md` files.
- Hand-written in `src/skills.ts` and to be kept in step with the packages by hand: the node grammar and the validate-and-repair section (from `packages/core/AGENTS.md`), the `useWidget()` accessor table and renderer rules (from `UseWidgetResult` in `packages/vue/src/types.ts`), the whole `widget-plugin-authoring` skill and the tag table.

## Known limits

- A slot's expected children are only known in the 0.3 record form; the reading of `Expected` (string-literal union, or types carrying a literal `type`) is a guess until 0.3.0 exists. In the 0.2 form every registered type is allowed in every slot.
- `reasons` is read as a record of reason to payload type, untested against a real plugin.
- Named types with type arguments are expanded inline, not named. Two different declarations with one name get a numeric suffix.
- An untyped or recursive config value is JSON text in the flat form.
- Method effects (State written, Events emitted) are not in the IR: Core's inspection does not expose `emits`.
- `validate.ts` does not evaluate `format` or `pattern`.
