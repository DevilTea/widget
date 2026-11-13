# QuickJS benchmarks

Runs `@deviltea/widget-core` inside a real QuickJS engine (quickjs-ng's `qjs`), the engine the Rust backend embeds
through `rquickjs`. The Node harness approximates it with `node --jitless`, which still has V8's object model, GC
and bytecode; the numbers here come from the actual interpreter, so use them to confirm that an optimization helps
in the embedded workloads and to find out how deep a dependency chain the engine tolerates.

## What is measured

One self-contained script (esbuild bundles Core's `dist/index.mjs`, its `alien-signals`, `benchmarks/lib/gen.mjs` and the
code in this directory; no imports and no host API at run time except a feature-detected `print`/`console.log`,
`performance.now()` or `Date.now()`, and `queueMicrotask`) runs once per measurement group in a fresh process.
Workloads, on the standard 8-ary tree fixture (100 and 1 000 widgets by default):

| workload | inside the clock |
| --- | --- |
| `compile` | `system.createBlueprint(source)` |
| `createRuntime` | `blueprint.createRuntime()` (the Runtimes of a batch are disposed after the clock stops) |
| `embedded.create-per-input` | per input: `createRuntime({ overrideStateDefaults })`, 3 Methods, 4 Property reads, `dispose()` |
| `embedded.reuse-resetState` | per input: `resetState()`, the same values by State writes, 3 Methods, 4 Property reads |
| `resetState` | `runtime.resetState()` after 10 State writes (the writes are outside the clock) |
| `snapshotState` | `runtime.snapshotState()` |

The two `embedded.*` workloads replicate the per-input logic of the `embedded.loop` scenario in
`benchmarks/scenarios/core-runtime.mjs`, so they are comparable with the Node harness (that module cannot be imported
here). Each process first runs a guard: the document is valid, the three embedded paths give identical Method results
and Property values for the same inputs, results are `ok` and differ from one input to the next, `resetState` restores
the defaults. A bundle that silently does nothing fails instead of producing a number.

A sample times as many repetitions as it takes to last at least about 20 ms (the engine's clock may be coarse) and
reports nanoseconds per operation; after calibration and a warm-up there are `--samples` samples (default 15). Rows
carry median, min, max and MAD/median (`spread`). There is no `gc()` call: a collection that happens during a sample is
part of it.

### Stack probes

For each shape and phase the largest length that works is found by doubling, then bisection (resolution about 1 %):

* `chain`: one widget, Properties `p0 .. p{L-1}` where `p{i}` reads `p{i+1}`; counted in Properties. The head `p0` is
  declared first on purpose: the compiler's cycle search follows dependencies in declaration order, so this is the
  order in which compile recursion is as deep as the chain (declared the other way round, the same chain still compiled at
  65 536 links under Node).
* `survey`: W flat widgets; `visible` reads the next widget's `value`, `value` reads its own State and its own
  `visible`; counted in widgets (two Properties each).
* phases: `compile` (`createBlueprint` returns a valid Blueprint) and `evaluate` (`createRuntime`, then a cold read of
  the head returns `ok` with the right value).

Every attempt is a **fresh process**. QuickJS recovers from a stack overflow (quickjs-ng 0.18 throws a catchable
`RangeError: Maximum call stack size exceeded`; only `InternalError`, which is out of memory or an interrupt, is
uncatchable), but a fresh process also starts every attempt from the same shallow stack and an empty heap, and an
attempt that crashes or runs away only fails that length (recorded as such, `inconclusive` in the JSON). The first
failure's error class and message are reported.

## Run

Needs `pnpm install` (the workspace's own esbuild is used, no dependency is added) and a built Core in the checkout
under test (`pnpm --filter ./packages/core build`).

```bash
# CI (Linux x86_64): fetch the pinned binary, then measure a checkout
QJS=$(benchmarks/quickjs/install-qjs.sh "$RUNNER_TEMP/qjs")
node benchmarks/quickjs/run.mjs --packages-root "$PWD" --qjs "$QJS" --json out/a.json [--sizes 100,1000] [--samples 15] [--stack-probe true]
node benchmarks/quickjs/run.mjs --packages-root /path/to/other/checkout --qjs "$QJS" --json out/b.json
node benchmarks/quickjs/compare.mjs out/a.json out/b.json      # several files per side: a1.json,a2.json b1.json,b2.json

# Locally, without QuickJS: the same bundle under Node
node benchmarks/quickjs/run.mjs --packages-root "$PWD" --qjs node-jitless --json /tmp/a.json   # or --qjs node
```

Other options: `--stack-size <KB>` (passed to `qjs` or `node` as their stack limit), `--workloads a,b`,
`--max-seconds 60` (timed-work bound per group), `--probe-timeout 120` (seconds per probe attempt), `--bundle-out <file>`.
The benchmark code (`gen.mjs`, the workloads) always comes from the checkout that holds this script, so two checkouts
are compared with identical measuring code; only Core and `alien-signals` come from `--packages-root`. The JSON
records the engine version, the packages root, its git SHA, the Core and `alien-signals` versions and the bundle size.

`compare.mjs` prints, per workload and size, the median of the medians of each side, the min..max range, the ratio
B/A and `significant` (ranges do not overlap and the medians differ by more than 5 %), then the stack-probe numbers.

## Caveats

* `qjs` uses the engine's default stack limit, `JS_DEFAULT_STACK_SIZE`, 1 MiB in quickjs-ng 0.18. `rquickjs` may configure
  another size (`Runtime::set_max_stack_size`) or build another QuickJS version, and the host thread's own stack
  matters; the probe figures are for this binary and limit, and scale roughly with the limit (`--stack-size`).
  Frame sizes also differ between engines and between modes: the same probes under Node give different numbers.
* The stack figures depend on how much stack each `compute` uses (these are small); a real document's depth is lower.
* The pinned binary, `qjs-linux-x86_64` of quickjs-ng v0.18.0, is not a build of the engine the backend ships: use the
  numbers for before/after comparison with the same binary, not as absolute predictions.
* CI runners are shared machines: compare ranges and repeat runs rather than reading a single ratio.
