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
  declared first on purpose: the compiler's cycle search used to follow dependencies in declaration order, so this was
  the order in which compile recursion was as deep as the chain (declared the other way round, the same chain still
  compiled at 65 536 links under Node). The head reads `L + x`.
* `survey`: W flat widgets; `visible` reads the next widget's `value`, `value` reads its own State and its own
  `visible`; counted in widgets (two Properties each). The cold-read probes use it as authored (`visible` is a boolean,
  so writing the last widget's State never changes the head). The teardown probes use a "live" variant with the same
  dependency edges but numeric `visible` (the next widget's `value`, 0 for the last) and `value = answer + visible + 1`,
  so the head reads `W + answer of the last widget` and a write to the tail reaches it. Both read `visible` before the
  State.
* State-first variants, used only by `rewrite-all`: every Property reads a State of its own first and its dependency
  after it, so once every State is written every link is directly stale (each re-evaluation finds its own State changed
  before it reaches the next link). The chain gets States `s0 .. s{L-1}` and `p{i} = s{i} + p{i+1} + 1` (head
  `L + sum of the States`); the survey is the live variant with `value` reading `answer` before `visible` (head
  `W + sum of the answers`).

Phases, each with the step it measures and how it decides success. Every attempt needs a valid Blueprint first, builds a
fresh Runtime, and fails (stage `process`) when the process crashes, times out or ends without a result line.

| phase | what the attempt does | success |
| --- | --- | --- |
| `compile` | `createBlueprint` | the Blueprint is `valid` |
| `evaluate` | fresh Runtime, then a **cold** read of the head | the read is `ok` with the expected value |
| `warm-reread` | fresh Runtime; read every Property from the tail to the head (each read is shallow because its dependency is already cached); write the tail State; read the head | every warm read is `ok` with its expected value; the write is accepted; the head reads the expected value after the write |
| `unsubscribe` | warm bottom-up as above; subscribe a listener to the head; unsubscribe it | nothing throws, nothing is reported (below) |
| `reread-after-unsubscribe` | as `unsubscribe`, then write the tail State and read the head | as `warm-reread` for the write and the read, and the listener was not called |
| `dispose` | warm bottom-up; subscribe a listener to the head; `runtime.dispose()` | nothing throws, nothing is reported |
| `rewrite-all` | state-first variant; fresh Runtime; **cold** read of the head; then twice: write every State (to 1, then to 2), read the head | every read is `ok` with the expected value (a failure in either round fails the attempt, at stage `read-1` or `read-2`) |

The warm state of the last four phases is built bottom-up on purpose, so none of them depends on a deep cold read and each
measures only the step it is named for (a failure while warming is reported at stage `warm`, and means the bottom-up
read itself was not shallow). Core isolates the exceptions of subscriptions and listeners: they never reach the caller
and are reported by rethrowing from `queueMicrotask`. During a teardown attempt the probe therefore replaces
`globalThis.queueMicrotask` with a function that runs the callback at once and records what it throws; a recorded
exception fails the attempt (stage `<stage> (reported)`). Without that a stack overflow inside a listener or a
subscription's read would pass unseen. A wrong value read back fails with `WrongValue` (a nested read that overflowed
turns into `0` in these computes, so this is also how an overflow inside a Property shows up).

A probe that still works at the cap of the search (65 536 Properties for the chain, 32 768 widgets for the survey) is
reported as **"at least <cap>"** (`ceiling: true` in the JSON, where `maxOk` then equals the cap and is a lower bound, not
a limit); one that already fails at the first length tried (100 / 50) as "< <start>" (`maxOk: 0`). The compile probes
reach the cap since Core analyses evaluation cycles without recursion.

`--probes-only true` skips every timing workload (it implies `--stack-probe true`) and `--probe-phases a,b` restricts
the phases (default: all seven). The stack-size sweep of the CI driver
([`../ci/README.md`](../ci/README.md#stack-size-sweep)) runs exactly this, once per stack size. `info` runs also report
the engine's plain recursion depth (nested calls of an empty function until the engine throws), a calibration without
any Widget code that is printed at the top of a sweep table.

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

Other options: `--stack-size <KB>` (the engine's stack limit: `node --stack-size=<KB>`, and `qjs --stack-size <KB>k` with
an explicit `k` suffix so that it is kibibytes whichever way `qjs` reads a bare number), `--probes-only true`,
`--probe-phases a,b`, `--workloads a,b`,
`--max-seconds 60` (timed-work bound per group), `--probe-timeout 120` (seconds per probe attempt), `--bundle-out <file>`.
The benchmark code (`gen.mjs`, the workloads) always comes from the checkout that holds this script, so two checkouts
are compared with identical measuring code; only Core and `alien-signals` come from `--packages-root`. The JSON
records the engine version, the packages root, its git SHA, the Core and `alien-signals` versions and the bundle size.

`compare.mjs` prints, per workload and size, the median of the medians of each side, the min..max range, the ratio
B/A and `significant` (ranges do not overlap and the medians differ by more than 5 %), then the stack-probe numbers
(a range when repeated files differ, "at least N" for a probe that reached its cap).

## Caveats

* `qjs` uses the engine's default stack limit, `JS_DEFAULT_STACK_SIZE`, 1 MiB in quickjs-ng 0.18. `rquickjs` may configure
  another size (`Runtime::set_max_stack_size`) or build another QuickJS version, and the host thread's own stack
  matters; the probe figures are for this binary and limit, and scale roughly with the limit (`--stack-size`).
  Frame sizes also differ between engines and between modes: the same probes under Node give different numbers.
* The stack figures depend on how much stack each `compute` uses (these are small); a real document's depth is lower.
* The pinned binary, `qjs-linux-x86_64` of quickjs-ng v0.18.0, is not a build of the engine the backend ships: use the
  numbers for before/after comparison with the same binary, not as absolute predictions.
* CI runners are shared machines: compare ranges and repeat runs rather than reading a single ratio.
