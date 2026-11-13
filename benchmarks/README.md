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
pnpm bench --json results.json             # also write machine-readable results (raw samples included)
node benchmarks/compare.mjs a.json b.json  # join two result files; see "Comparing two runs"
pnpm bench --quick                         # smoke run: few samples, numbers are NOT baseline quality
node benchmarks/profile.mjs runtime.create --variant standard --size 1000     # CPU profile summary
node benchmarks/profile.mjs --summarize some.cpuprofile                        # summarize an existing profile
```

Options: `--mode normal,jitless,alloc` (default: all three, where a scenario supports it; an unknown mode name is
rejected), `--variant <name>`, `--sizes a,b,c`, `--no-idle-check`, `--max-busy-cores <n>` (default 2.5).

A filter selects a scenario when it equals the id, when it ends with `.` and the id starts with it (`runtime.`), or
when the id starts with the filter followed by a `.` (`runtime.state` selects `runtime.state.set`). Several filters
select the union; no filter selects everything. A filter that selects nothing is an error, so a typo never runs an
empty suite.

Every child process runs with `NODE_ENV=production` (set by the runner and again by the worker before any scenario
module loads). Vue's development build is 1.5 to 3 times slower and buffers the devtools events of every component
in a module-level array that only a timer clears, which the measurement loop never lets run; the library code itself
is measured as applications ship it.

If a package's `src` holds a non-test file newer than the newest file of its `dist`, the runner prints a boxed
warning to stderr before starting, because the run would measure the old built code. The stale packages are also
recorded in the JSON (`info.staleDist`). Rebuild with `pnpm --filter "./packages/*" build`.

A child that fails (a thrown guard, a crash, an out-of-memory kill, no result line) does not stop the suite: the
failure is recorded in the results, printed as `FAILED [mode] id: reason`, the next scenario runs, and the runner
lists every failure at the end and exits with code 1. `compare.mjs` lists such runs separately and skips them.

### `--json`

The file holds `{ info, args, results }`, and is rewritten after every scenario, so an interrupted run keeps what it
measured (`info.complete` is `false` until the last write). `info` has the machine (CPU model, core count, memory, Node
version, platform, load at start), the git short hash and whether the working tree was dirty, a fingerprint per package
of its `dist` (SHA-256 over the `.mjs` files, first 12 hex digits), the stale-dist list, and `startedAt` / `finishedAt`.
`args` holds the options the run was given. `results` has one entry per scenario and mode; each row of a variant has the
median, p95, minimum, maximum, spread, tail, drift, the quality `flags`, the batch size, the warm-up count and **every raw
sample** (nanoseconds per call, in collection order), so any statistic can be recomputed later. Failed runs appear with
a `failed` message.

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
`selfDeps`, `standard`, `crossDeps`, `validated`, `aggregated`. Read the fixtures as follows: in the 8-ary `tree`
shape 12.5% of the widgets are `group` widgets, which carry a single State member (`level`) and no Properties,
Methods or Events, and only the `unit` leaves (87.5%) carry the profile's members (config, State, Properties,
Methods, Event), so every per-widget figure is a blend of the two kinds. `bare` units have a config and State
and nothing else (no Properties, Methods or Events). The Lab's showcase Systems are not used as
fixtures: they import their plugins through extension-less TypeScript paths and are not loadable by plain
Node without a transpiler.

### One measurement

1. one cold call (tells how slow the operation is);
2. warm-up until the last four samples agree within 5 % (bounded in count and time);
3. samples: each is the time of one batch of calls divided by the batch size; the batch is sized so a sample
   lasts at least about 2 ms; inputs for a whole batch are built **before** the clock starts; a full `gc()`
   runs before every sample, outside the clock;
4. the median, the p95 and the **spread** (median absolute deviation over the median) are reported; a spread
   above 10 % triggers one round of extra samples (the sample and time budgets double) and, if it persists,
   the row is flagged `UNRELIABLE`.

The number of samples depends on how slow the call is: at least 21, at least 9 when a call takes more than 100 ms and
at least 5 above 1 s (5 with `--quick`), up to 120 and about 1.5 s of timed work per size (15 samples and 0.3 s with
`--quick`); sampling of one size stops after a minute. The `n` column shows what was kept.

Each scenario states what is inside and outside the timed region (`--list` shows the summary; the source
header of each scenario module has the detail). Operations the library caches per input (the inspection
facades) get a fresh input per call. The harness also asserts, once per fixture, that it is measuring the
real thing (the document is valid, a Vue write really changed the DOM, the Inspector really delivered
exactly one event per write, the compared variants do the same logical work). Checked while building the harness: compiling the same source object and a fresh
`structuredClone` of it take the same time, and `createRuntime()` on a Blueprint that was used before takes
the same time as on a new one, so reusing a source or a Blueprint does not measure a cache hit.

### Reading the output

```
| widgets | n  | median  | p95     | spread | /unit   | slope | | jitless: | n  | median ...
| 1000    | 21 | 6.79 ms | 8.36 ms | 5.6%   | 6.79 us | 1.07  | | ...
```

* `n` is the number of timed samples behind the row. The p95 is the nearest-rank percentile, so **below n = 20 the p95
  column is the maximum**.
* `/unit` (shown only where it means something) is per widget, or per op when a run performs several
  (`embedded.loop`, the cold property reads). The unit is named by the variant (`K dependents`, `chain length`).
* `slope` is the log-log slope of the median between this size and the previous one: 1.00 is linear, 2.00
  quadratic. A slope above 1.15 is marked `!`. Slopes between small sizes are distorted by fixed costs.
* The spread cell carries the quality flags of the row. `UNRELIABLE` means the spread is above 10 % (after the extra
  round). MAD over the median is blind to a slow tail and to drift, so three more flags are computed from the same
  samples and printed in lower case after it:
  * `tail`: n is at least 20 and p95 / median is above 1.25 (an occasional slow sample the MAD ignores);
  * `drift`: n is at least 10 and the median of the second half of the samples (in collection order) differs from the
    median of the first half by more than 5 % of the median (the numbers move during the run: a warming or
    degrading heap, background load, a cache that fills);
  * `few`: fewer samples than the sampler wanted (the time or the one-minute limit ran out first).
  A row with any flag is a weaker result than its median suggests; `--json` keeps the raw samples for a closer look.
* Rows marked `CACHE HIT` measure the warm path on purpose (they exist to show it is cheap).
* After each scenario the runner prints a warning when other processes used more than 1.5 cores while it ran.
  Numbers from such a run are suspect. Before each child starts the runner waits (up to 2 minutes) until the
  machine uses at most `--max-busy-cores` cores. A desktop with a browser open is never fully idle; the spread
  column is the honest judge.

Vue numbers come from a simulated DOM (happy-dom, resolved from `packages/vue/node_modules`, hand-written
render functions) and are only comparable to themselves. The Vue scenarios run the **production build of Vue**
(`NODE_ENV=production`, asserted at start-up), as applications ship it: the development build is 1.5 to 3 times
slower, and it also buffers the devtools events of every component, each holding the component instance and
so the whole vnode/DOM tree and Runtime, in a module-level array that only a `setTimeout` clears. The
measurement loop never yields to timers, so with the development build every mounted tree stays reachable and
the process runs out of memory. Inspector numbers include the in-process transport's
JSON clone of every message.

### Comparing two runs

```bash
node benchmarks/compare.mjs a.json b.json [--threshold 5] [--mode normal,jitless,alloc]
```

It joins two `--json` files by mode, scenario id, variant name and size, and prints per mode one table of the two medians
(bytes per run for `alloc`), their B/A ratio, the spread of each, the flags of either run, and a marker (`slower` / `faster`,
`more` / `less` for allocation) where the medians differ by more than the threshold (default 5 %), then the geometric mean of
the ratios. Rows present in only one file, rows skipped or not measured in either, and failed runs are listed separately;
custom tables (memory, size, load) are not compared. A summary shows the git hash, dist fingerprints, machine and times of
both files and the options each run was given, and prints a `WARNING` when the machines or Node versions differ, when either
run used a stale dist, is a `--quick` run or is incomplete, or when only one of them is `--quick`.

Two uses: with two runs of the **same** code, the comparison checks that the harness reproduces itself (nothing, or almost
nothing, should be over the threshold; rows that are, and the flagged rows, show where this machine is too noisy to detect a
change of that size); with a run before and a run after a change, the markers show what moved, and the two dist
fingerprints confirm that the two runs really measured different code.

### Profiles

`profile.mjs` runs one variant at one size under the V8 CPU profiler (the same sampler as `node --cpu-prof`,
started through the inspector so only the measurement, not the fixture, is profiled; the `.cpuprofile` is kept
and opens in Chrome DevTools or speedscope) and prints the top functions by self time and by inclusive time
with file and line. Samples of input building and clean-up (`benchUntimedFresh` / `benchUntimedAfter`) are
dropped. Only frames whose file is inside `benchmarks/` count as the harness loop: they are never listed, and self time in
them is the `(harness loop)` row. Builtin and native frames keep their own names, marked `(builtin)` (`JSON.parse`,
`Map.prototype.set`). Garbage-collector samples cannot be attributed to a function and are reported on their own line, in
milliseconds and as a share of the kept samples; forced collections are off in profile mode, so that line is only the
collection work the measured code's own garbage triggers, and the spread of a profiled run is higher than in a normal run.
`dist` frames are mapped to `src` of the **same package** **by function name only**: up to 8 candidates are listed when a name
is not unique (with a count of the rest), a name with no match says so, and anonymous functions keep their dist location.
Inclusive times come from sampled stacks, and V8 may inline a callee into its caller, so a wrapper's inclusive time can come out
lower than that of the function it calls.

### Wall time

A full `pnpm bench` takes on the order of an hour on a recent laptop-class machine (it varies with the machine and
with what else is running); the Core scenarios alone (`pnpm bench blueprint. runtime.
embedded. document. separated. inspection. system. plugin. memory.`) are the bulk of it. `--quick` runs the
whole suite in a few minutes and is meant for checking that nothing is broken.

## Adding a scenario

Add an entry to the `scenarios` array of a module under `scenarios/` (they are registered in
`scenarios/index.mjs`): `id`, `area`, `jitless`, `alloc`, `summary`, `inside`, `outside` and `variants`, each with
`name`, `sizes` and `setup(size)` returning a case `{ fresh?, run, after?, ops?, maxBatch?, async?, warmPass?,
dispose? }` (see the header of `lib/harness.mjs`): `fresh` builds the untimed input of one call, `run` is the timed
region, `after` releases what a call produced (it runs for every call, with or without `fresh`), and `dispose` runs
once after the last sample, also when the measurement throws (use it to release what `setup` left alive: Runtimes, mounted apps, Agents).
`warmPass: true` makes the harness call `run()` once, untimed, after the forced garbage collection and right before
the clock starts, so a pure read over a large live heap is not timed on its first, cache-cold pass after the
collection. It is only valid on a case without `fresh` and only for a `run` that is harmless to call one more
time. Keep ids and variant names stable: they are used to compare runs before and after a change. Put a
guard in `setup` that the case does the work it claims (the document is valid, a write changed something, the
variants agree), and prefix the note of a deliberately warm row with `CACHE HIT:`.
Some rows deserve a note on what they are:

* `document.patch / noop` replaces a config value with an equal one: the patch is applied but nothing is recompiled.
  It is the proxy for the cost of applying a patch. The public API does not allow separating patch application from
  the recompile in the other variants, and the difference of `replace-config` and `baseline.compile` is far below
  the noise, so it is not a measurement of the patch-only share.
* `inspection.runtime / walk` reads the `s0` snapshot of every `unit` (groups are not visited). The first, cold call
  creates the State facades, which the Inspection keeps in Maps; the samples are a repeated walk over cached
  facades and are memory-bound at large N. The `/unit` column divides by the widget count.
* `inspector.widget` is one `runtime.getWidgetSnapshot` request for one widget. The Agent resolves the reference with a
  linear scan of the Blueprint nodes that stops at the first match, so the scenario shows how that scan grows with the
  document: `first-node` (the root, a `group`, so a smaller response) and `first-unit` match early, `last-node` scans
  everything, and `rotating` visits every unit once per cycle in a strided order (the mean cost for a client that inspects
  many widgets). The references come from the Blueprint snapshot response, as a client gets them. It has no `/unit`
  column: the operation is logically constant, and the growth with N is the result.
* `runtime.subscribe.churn / property` includes one Property re-evaluation per iteration (the last subscriber
  leaving marks the Property dirty); `property.watched` keeps a second subscriber so the row is the subscription cost
  alone.

Scenarios of `kind: 'custom'` (memory, size, load) return their own tables.
