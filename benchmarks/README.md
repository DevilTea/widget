# Benchmarks

Performance baseline harness for `@deviltea/widget-core`, `@deviltea/widget-vue` and
`@deviltea/widget-inspector`. It measures the **built** packages (`packages/*/dist`, imported by relative
path), needs no dependency beyond Node 24, and is not part of `pnpm test`, `pnpm check` or CI.

## Run

```bash
pnpm --filter "./packages/*" build         # the harness refuses to run without dist
pnpm bench                                 # everything (about 1 hour; see "Wall time")
pnpm bench runtime.create                  # one scenario; a prefix selects a family: `runtime.`, `blueprint.`
pnpm bench runtime.state.set --variant property-subscribed --sizes 10,1000
pnpm bench --list                          # scenario ids, which have --jitless and allocation runs
pnpm bench --json results.json             # also write machine-readable results
pnpm bench --quick                         # smoke run: few samples, numbers are NOT baseline quality
node benchmarks/profile.mjs runtime.create --variant standard --size 1000     # CPU profile summary
node benchmarks/profile.mjs --summarize some.cpuprofile                        # summarize an existing profile
```

Options: `--mode normal,jitless,alloc` (default: all three, where a scenario supports it),
`--variant <name>`, `--sizes a,b,c`, `--no-idle-check`, `--max-busy-cores <n>` (default 2.5).

## What is measured

Every scenario runs in its **own child process**, one after another (never in parallel), in up to three modes:

| mode | node flags | purpose |
| --- | --- | --- |
| `normal` | `--expose-gc` | the JIT-compiled numbers |
| `jitless` | `--expose-gc --jitless` | approximates an interpreter-only embedded engine (the library is embedded in QuickJS) |
| `alloc` | `--expose-gc --min-semi-space-size=512 --max-semi-space-size=512` | approximate bytes allocated per run: with a semi-space this large no scavenge runs inside the window, so the heap growth across a batch is what was allocated (garbage included) |

Size-dependent scenarios run at 100, 1 000, 4 000 and 16 000 widgets. A size is skipped when the previous
size's median predicts more than 3 s per run (reported as `skipped`). Document shapes come from
`lib/gen.mjs`: a deterministic generator with explicit parameters (shape `flat` / `tree` (8-ary) / `deep`
(a 60-level spine), config, State/Property/Method counts, dependency kinds `dep.self` / `dep.parent` /
`dep.widget(id)`, Events, structure validators, an aggregating Property) and named profiles `bare`,
`selfDeps`, `standard`, `crossDeps`, `validated`, `aggregated`. The Lab's showcase Systems are not used as
fixtures: they import their plugins through extension-less TypeScript paths and are not loadable by plain
Node without a transpiler.

### One measurement

1. one cold call (tells how slow the operation is);
2. warm-up until the last four samples agree within 5 % (bounded in count and time);
3. samples: each is the time of one batch of calls divided by the batch size; the batch is sized so a sample
   lasts at least about 2 ms; inputs for a whole batch are built **before** the clock starts; a full `gc()`
   runs before every sample, outside the clock;
4. the median, the p95 and the **spread** (median absolute deviation over the median) are reported; a spread
   above 10 % triggers one round of extra samples and, if it persists, the row is flagged `UNRELIABLE`.

Each scenario states what is inside and outside the timed region (`--list` shows the summary; the source
header of each scenario module has the detail). Operations the library caches per input (the inspection
facades) get a fresh input per call. The harness also asserts, once per fixture, that it is measuring the
real thing (the document is valid, a Vue write really changed the DOM, the Inspector really delivered one
event per subscription). Checked while building the harness: compiling the same source object and a fresh
`structuredClone` of it take the same time, and `createRuntime()` on a Blueprint that was used before takes
the same time as on a new one, so reusing a source or a Blueprint does not measure a cache hit.

### Reading the output

```
| widgets | median  | p95     | spread | /unit   | slope | | jitless: | median ... 
| 1000    | 6.79 ms | 8.36 ms | 5.6%   | 6.79 us | 1.07  | | ...
```

* `/unit` (shown only where it means something) is per widget, or per op when a run performs several
  (`embedded.loop`, the cold property reads). The unit is named by the variant (`K dependents`, `chain length`).
* `slope` is the log-log slope of the median between this size and the previous one: 1.00 is linear, 2.00
  quadratic. A slope above 1.15 is marked `!`. Slopes between small sizes are distorted by fixed costs.
* Rows marked `CACHE HIT` measure the warm path on purpose (they exist to show it is cheap).
* After each scenario the runner prints a warning when other processes used more than 1.5 cores while it ran.
  Numbers from such a run are suspect. Before each child starts the runner waits (up to 2 minutes) until the
  machine uses at most `--max-busy-cores` cores. A desktop with a browser open is never fully idle; the spread
  column is the honest judge.

Vue numbers come from a simulated DOM (happy-dom, resolved from `packages/vue/node_modules`, hand-written
render functions) and are only comparable to themselves. Inspector numbers include the in-process transport's
JSON clone of every message.

### Profiles

`profile.mjs` runs one variant at one size under the V8 CPU profiler (the same sampler as `node --cpu-prof`,
started through the inspector so only the measurement, not the fixture, is profiled; the `.cpuprofile` is kept
and opens in Chrome DevTools or speedscope) and prints the top functions by self time and by inclusive time
with file and line. Samples of input building and clean-up (`benchUntimedFresh` / `benchUntimedAfter`) are
dropped; garbage-collector samples cannot be attributed to a function and are reported on their own line;
`dist` frames are mapped to `packages/*/src` **by function name only** (candidates are listed when a name is
not unique, anonymous functions keep their dist location). Forced collections are off in profile mode, so
the spread of a profiled run is higher than in a normal run.

### Wall time

A full `pnpm bench` is about an hour on an Apple M2; the Core scenarios alone (`pnpm bench blueprint. runtime.
embedded. document. separated. inspection. system. plugin. memory.`) are the bulk of it. `--quick` runs the
whole suite in a few minutes and is meant for checking that nothing is broken.

## Adding a scenario

Add an entry to the `scenarios` array of a module under `scenarios/` (they are registered in
`scenarios/index.mjs`): `id`, `area`, `jitless`, `alloc`, `summary`, `inside`, `outside` and `variants`, each with
`name`, `sizes` and `setup(size)` returning a case `{ fresh?, run, after?, ops?, maxBatch?, async? }` (see the
header of `lib/harness.mjs`). Keep ids stable: they are used to compare runs before and after a change.
Scenarios of `kind: 'custom'` (memory, size, load) return their own tables.
