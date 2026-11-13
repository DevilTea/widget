# AGENTS.md — @deviltea/widget-core

## Scope and layout

Renderer-agnostic widget composition core: `WidgetPlugin` builder, `WidgetSystem`, `WidgetSystemBlueprint` (compilation/recovery/diagnostics), and `WidgetSystemRuntime` (alien-signals-backed execution). The current normative semantic contract lives in `DevilTea/widget` Discussion #12 under the "Core composition architecture" topic, including its migrated historical decisions and any later accepted amendments. Current `DevilTea/widget` decisions supersede the historical source repository.

- `src/index.ts` — public entry; only export the public contract surface.
- `src/inspection/` — the dedicated, strictly readonly `@deviltea/widget-core/inspection` subpath
  (`inspectPlugin`, `inspectBlueprint`, `inspectRuntime`). Not re-exported from `src/index.ts`. It is a supported
  surface for any host, not only DevTools. `inspectPlugin(plugin)` is a superset of the `system.catalog` entry (`type`,
  `description`, `capabilities`, `config`, `slots`, plus the State/Property/Event member facts), so a host holding only a
  plugin can describe it. Normative contract: `DevilTea/widget` Discussion #12, Core composition architecture topic,
  including the migrated historical decisions (the "inspection exact API v1" parts 1 and 2 and the earlier
  readonly-subpath/identity/disposal inspection amendments, originally `DevilTea/deviltea-labs#10`).
- `src/integration/` — the `@deviltea/widget-core/integration` subpath, a narrow renderer-integration
  bridge that is not re-exported from `src/index.ts` (renderer adapters use it to obtain only the
  current widget's event emitter).
- `src/**/*.unit.test.ts` — colocated Vitest unit tests (run by the root config too).
- `tsdown.config.ts` — ESM build with declaration output from `tsconfig.package.json`; three entries
  (`src/index.ts`, `src/inspection/index.ts`, `src/integration/index.ts`) back the root export and the
  `./inspection` and `./integration` subpaths in the `package.json` `exports` map.

## Commands

```bash
pnpm test        # vitest run for this package
pnpm typecheck   # package + tests tsconfig
pnpm build       # tsdown (includes publint)
```

## Implementation rules

- Do not resolve implementation difficulty by silently restoring a design that Discussion #12's Core history marks discarded/superseded; a genuine durable semantic change must be recorded in the relevant current `DevilTea/widget` authority before implementation.
- `alien-signals` owns reactive graph/lazy/cache/batch mechanics; this package only implements observable semantics on top of it. Upgrading `alien-signals` requires rerunning the full conformance suite; upstream behavior change is a compatibility conflict, not permission to alter public Runtime semantics.
- Core stays minimal: editor operations, persistence envelopes/versioning/migration, metadata, and renderer/UI concerns stay out of this package.
- All framework-owned semantic callbacks are synchronous; a returned Promise/thenable is an implementation contract violation, not an Issue. For `void`-returning Methods and the structure validators (slot, plugin, system) a callback whose own inferred return type is a thenable is also a type error where it is written into the builder or the System options and the declared return is one a thenable is assignable to (`void`, `unknown`, `{}`, `object`); standalone definition types cannot infer and accept any return, and the runtime guard still throws.
- Builder phase order is `description → interfaces → config? → slots? → structure? → state? → properties? → methods? → events? → done`. `.structure(validateStructure)` is the optional plugin-level structure validator, available to every plugin and not a capability (it never appears in `plugin.capabilities`, the catalog or inspection); `.slots(definitions)` takes one argument. Section builders are sealed, definitions are captured by value, and a malformed declaration throws a `TypeError` naming plugin, section, member and field when the plugin is built.
- Callback contexts are bounded to their synchronous call: `addDiagnostic` / `hasAnyDiagnostic` close when the callback returns, and `deps.*` / `emit` callables work only while their own callback is the innermost running callback; they are also closed while foreign code runs (any listener, and plugin callbacks that own no callables: State `validate`, `validateArgs`, `default`, dependency refinements, compilation callbacks), and the one accepted gap is that a callable retained from an earlier invocation can be used by the same member's own later invocation (otherwise an uncoded `TypeError`; after dispose `WidgetSystemRuntimeDisposedError`). A Property can never write State.
- Observer exceptions are isolated, with one exception: public Event listener isolation lets the emit re-entrancy guard error (`WidgetSystemRuntimeReentrancyError`, code `emit-depth-exceeded`, thrown when emits nest deeper than the internal limit within one Runtime) and an engine stack overflow through to the outermost caller; every other listener kind isolates everything. A throwing State, Property, diagnostic, Event, disposal, inspection or `WidgetDocument` listener never reaches the writer (for a disposal listener, the `dispose()` caller) or the other listeners and is reported through `queueMicrotask`. This amends the earlier rule that a throwing public Event listener propagated to the emitter. A throwing Property `compute` never makes a writer throw; `get()` and dependency reads still rethrow.
- Source and Blueprint rules: a widget node's recognized own keys are `id`, `type`, `config`, `slots` and `meta` (`meta` is the reserved extension key); any other key is `unexpected-widget-field`. Duplicate ids are `duplicate-widget-id`. `MAX_JSON_DEPTH` (256) bounds authored source and SourcePatch operands; no entry point may throw `RangeError` for deep input. `createBlueprintFromJson(text)` is equivalent to `createBlueprint(JSON.parse(text))`, including its diagnostics.
- Property and Method success values are typed `T` (never `T | null`); only `RuntimeState.get()` and optional dependency reads keep `null`.
- Documentation (`docs/site/packages/widget-core.md`, `README.md`) carries code samples; every sample must type-check and, where it is runnable, run against the built package.
- The `src/inspection/` subpath is strictly readonly: it must never activate lazy Properties, execute Methods, mutate State, or otherwise widen the alien-signals reactive graph. It projects facts from compiler/runtime-authoritative data only — never by reconstructing status from Issues, and never by running its own SCC/write-effect analysis.
- Capability presence (`config`/`slots`/`state`/`properties`/`methods`/`events`) is required-key *declaration*, independent of the capability's own payload type (Discussion #12's migrated "declaration-presence semantics and public `WidgetPlugin.capabilities`" amendment). Use `HasWidgetCapability<Interfaces, Key>` for any presence gate; never derive presence from `[WidgetCapabilityOf<Interfaces, Key>] extends [never]` — a legitimately-present capability can itself have payload `never` (`slots: never` is the canonical explicit-empty spelling). A completed `WidgetPlugin` exposes these facts at runtime as `plugin.capabilities`.

## Unit-test standard

- Follow the conformance test matrix preserved in Discussion #12's Core topic: test public semantics and public type behavior, not internal algorithms (no SCC-algorithm, registry-shape, signal-topology, or message-wording assertions).
- Keep the regression cases the matrix marks as must-preserve (optional-only-suppresses-cardinality-0, method-only SCC validity, NaN/±0 strictness, batch non-rollback, post-dispose error surface, etc.).
