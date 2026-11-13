# B1 — performance baseline: a benchmark harness, numbers, and profiles

This specification was written for the session that built the harness; the shared brief and scratch directory it
refers to belonged to that session and are not part of the repository.

## Purpose

The owner wants the library's performance optimized. Nothing in the repository measures it today,
so the first step is evidence: **where does the time and memory go, and what scales worse than it
should?** You build a small benchmark harness, record a baseline, and capture profiles. You do
**not** optimize anything and you do not change any file under `packages/*/src`. An orchestrator
will read your numbers and decide what to optimize; a wrong or noisy number sends that work in the
wrong direction, so measurement quality matters more than coverage.

## What you deliver

1. A harness committed to the repository under `benchmarks/` (new top-level directory):
   plain Node ESM scripts (`.mjs`) that import the **built** packages by relative path to
   `packages/*/dist`, with no new dependency and no new workspace package (do not touch
   `pnpm-workspace.yaml` or the lockfile). A root script `pnpm bench` runs the suite; a filter
   argument runs one scenario; `--json <file>` writes machine-readable results. A short
   `benchmarks/README.md` says how to run it and how to read the output. Make sure `pnpm lint`
   still passes (follow the repository's ESLint setup; add an ignore only if a rule genuinely does
   not fit benchmark scripts, and say so). The harness must not run in `pnpm test` or CI.
2. Baseline results and profile summaries, returned in your report as tables (see "Report").

## Method (non-negotiable parts)

- Build first (`pnpm --filter "./packages/*" build`) and measure the built `dist`.
- Run scenarios **sequentially**, on an otherwise idle machine: check `uptime` before a run and do
  not run anything else in parallel (no tests, no builds). If the load average is high, wait.
- Each measurement: warm up until the timing is stable, then take enough samples to report the
  **median**, the **p95**, and the relative spread (MAD or IQR over median). A result whose spread
  exceeds about 10% is not a result: fix the measurement (more iterations, bigger batch, `gc()`
  between samples with `--expose-gc`) or flag it as unreliable.
- Fresh inputs per sample where the operation caches or mutates (a Blueprint compiled once must not
  be re-measured as a cache hit; say for each scenario what is inside and outside the timed region).
- **Scaling.** Run size-dependent scenarios at N = 100, 1 000, 4 000 widgets (and 16 000 where one
  run stays under a few seconds). Report the log-log slope between sizes; anything clearly above
  1.15 is superlinear and must be called out.
- **Two engines modes.** Run the Core scenarios under normal Node and under `node --jitless`. The
  second approximates an interpreter-only embedded engine (the library is used inside QuickJS,
  where creating a Runtime per input was measured as the dominant cost). Report both.
- **Profiles.** For every scenario that is slow in absolute terms or superlinear, capture a CPU
  profile (`node --cpu-prof`) at a representative size and summarize it mechanically: top functions
  by self time and by inclusive time, with file and line, as percentages. Write a small script for
  this in the harness (reading `.cpuprofile` JSON). Map `dist` frames back to `src` files by
  function name where you can; do not guess.
- **Memory.** Retained heap per widget for a Blueprint and for a Runtime (`--expose-gc`,
  `process.memoryUsage().heapUsed` after `gc()`, difference over N, at two sizes to confirm it is
  per-widget), and allocation churn for the hottest operations if you can measure it cleanly
  (`--trace-gc` counts or `performance.eventLoopUtilization` are not needed; a simple "bytes
  allocated per operation" via heap delta without GC is enough, flagged as approximate).

## Workloads

Build a synthetic document generator with explicit parameters (widget count, tree depth and
fan-out, plugins used, config present or not, State/Property/Method members per widget, how many
members have dependencies and of which kind — `dep.self`, `dep.parent`, `dep.widget(id)` — and
Events) plus a matching small plugin set. Keep the generator deterministic. If one of the Lab's
showcase Systems can be imported without Vue (look under `apps/lab/src/showcases/*`), add it as a
realistic fixture; if not, say why and move on.

Scenarios (name them stably; they will be re-run after each optimization):

Core — authoring and compile
- `system.create`: `createWidgetSystem` with P plugins.
- `blueprint.compile.valid`: `system.createBlueprint(source)` for a valid document; variants: flat
  and deep trees, with and without dependencies, with structure validators.
- `blueprint.compile.json`: `createBlueprintFromJson(text)` against `JSON.parse` +
  `createBlueprint`.
- `blueprint.compile.invalid`: documents with many diagnostics; one variant with many nodes
  sharing an id (this path is known to be quadratic in the number of nodes sharing one id —
  quantify it).
- `document.patch`: one small edit (`replace` of a config value, `add`/`remove` of one widget) on
  an N-widget `WidgetDocument` — the editor-keystroke path. Separate the patch application from the
  recompile if you can.
- `separated.roundtrip`: `separateWidgetSource` / `normalizeSeparatedWidgetSource` on N widgets.
- `inspection.blueprint` / `inspection.runtime`: the `./inspection` facades over N widgets.

Core — runtime
- `runtime.create`: `blueprint.createRuntime()` for N widgets, with and without
  `overrideStateDefaults`.
- `runtime.dispose`.
- `runtime.state.set`: one State write with K dependent Properties subscribed (K = 0, 10, 1 000),
  and with nobody subscribed.
- `runtime.property.get`: cold and warm reads; a chain of dependent Properties of length L.
- `runtime.method.invoke`: a Method with no dependencies, with several dependency reads and
  writes, and one that emits an Event to listeners.
- `runtime.subscribe.churn`: subscribe + unsubscribe of State / Property / diagnostics listeners.
- `runtime.diagnostics`: `getDiagnostics()` and a root `subscribeDiagnostics` listener while
  members fail and recover, on N widgets.
- `runtime.reset` and `runtime.snapshot`: `resetState()`, `snapshotState()` on N widgets.
- `embedded.loop`: the embedded-host pattern — compile once, then for each of M inputs either
  create a Runtime (with overrides), invoke a few Methods, read a few Properties and dispose, or
  reuse one Runtime through `resetState()`. Report cost per input for both.

Vue (`@deviltea/widget-vue`), in Node with the DOM implementation the package's own tests use
- `vue.mount`: mount N widgets through `WidgetRenderer`; `vue.unmount`.
- `vue.update`: one State write that changes what K rendered widgets display, to a flushed DOM.
- `vue.swap`: replace the `runtime` prop (a remount).
State clearly that these numbers come from a simulated DOM and are only comparable to themselves.

Inspector (`@deviltea/widget-inspector`)
- `inspector.snapshot`: `blueprint.getSnapshot` request for N nodes, end to end over the in-memory
  transport.
- `inspector.subscribe`: member-change fan-out to a subscribed client under a burst of writes.
- `inspector.value`: encoding a large value into `InspectableValue`.

Size and load
- Bytes of each published entry point: raw, minified and gzipped if a minifier already exists in
  the workspace's `node_modules` (do not add one), otherwise raw and gzipped only.
- Cold module load time of `@deviltea/widget-core` in a fresh Node process.

If a scenario cannot be measured meaningfully, say so and why rather than producing a number.

## Report (as text — do not write a report file)

1. Worktree, branch, `git log --oneline feat/disposal-hook-and-0.1-docs..HEAD`, the machine
   (`node --version`, CPU model, load average during the runs).
2. One table per area with, per scenario and size: median, p95, spread, per-widget or
   per-operation cost, and the scaling slope; normal Node and `--jitless` side by side for Core.
3. The superlinear and the slow: a ranked list, each with its numbers and its profile summary
   (top self-time and inclusive-time functions with source locations).
4. Memory: bytes per widget for Blueprint and Runtime, and anything surprising.
5. Sizes and load time.
6. What you could not measure, and every number you consider unreliable.
7. Observations only where the data supports them ("X% of `runtime.create` is spent in Y"). No
   optimization proposals beyond naming the function a profile points at.

## Verification

`pnpm lint` and `pnpm typecheck` still pass; `pnpm bench` runs end to end from a clean build; the
suite's total wall time and how to run a subset. Commit: `chore: add a benchmark harness` (one or
two commits). Do not push.
