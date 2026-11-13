# Handoff: performance optimization pass

Written 2026-11-13 for the agent that continues this work. Everything you need is on this branch
(`perf/benchmark-baseline`); nothing lives only in a previous session.

**Delete this `benchmarks/handoff/` directory before the work is proposed for merge.** It is a
working note, not documentation.

## Where things stand

The owner asked for the performance of the three published packages (`@deviltea/widget-core`,
`@deviltea/widget-vue`, `@deviltea/widget-inspector`) to be optimized. The work is planned in this order:

1. **Measure**: a benchmark harness, a trustworthy baseline, CPU profiles, memory figures.
2. **Decide**: rank optimization candidates from the data and agree them with the owner.
3. **Optimize**: one candidate at a time, each proven with the same harness, behavior unchanged.
4. **Deliver**: one pull request.

Step 1 (measure) is finished. Step 2 (decide) is waiting for the owner. Nothing has been optimized and
no file under `packages/` or `apps/` has been changed. The harness is commit `6d43783`, plus the
commit that carries this note and the baseline text.

Figures below were measured unless marked "inferred". Inferred figures come from reading profiles and
code; nothing was prototyped.

## Start here

```bash
git fetch origin && git switch perf/benchmark-baseline
pnpm install --frozen-lockfile
pnpm --filter "./packages/*" build      # the harness measures packages/*/dist and refuses to run without it
pnpm bench --list                       # every scenario id
pnpm bench --quick                      # smoke run of the whole suite; NOT baseline quality
pnpm bench runtime.create               # one scenario at full quality
node benchmarks/profile.mjs runtime.create --variant standard --size 4000
```

Read [`../README.md`](../README.md) next: it explains the measurement method, the output columns,
the three modes (`normal`, `jitless`, `alloc`) and how to add a scenario. Never benchmark while
tests, builds or other agents run on the same machine.

## What is on this branch

| Path | What it is |
| --- | --- |
| `benchmarks/run.mjs`, `worker.mjs`, `profile.mjs`, `compare.mjs` | The runner (one child process per scenario, sequential, every child with `NODE_ENV=production`), the child, the CPU-profile summarizer, the run comparer |
| `benchmarks/lib/` | Measurement loop and statistics, report tables, `.cpuprofile` parsing, the synthetic document generator (`gen.mjs`) |
| `benchmarks/scenarios/` | Scenario definitions: Core compile, Core runtime, Core memory, Vue, Inspector, size and load |
| `benchmarks/handoff/baseline-spec.md` | The specification the harness was built to; the definition of "baseline done" |
| `benchmarks/handoff/baseline/` | Tracked text of the baseline: `baseline-1.txt`, `baseline-2.txt` (full tables of two runs), `compare-1-2.txt` (their comparison), `profiles/*.txt` (CPU-profile summaries) |
| `benchmarks/.results/` | Untracked, machine-specific: `baseline-1.json`, `baseline-2.json` (every raw sample), their `.log` files, `profiles-raw/*.cpuprofile`. Exists only on the machine that measured |
| `package.json`, `eslint.config.js` | The `bench` script; `console` and top-level `await` allowed in `benchmarks/**/*.mjs`. No new dependency |

The synthetic "standard" widget, which most scenarios use, has a config, 3 State members,
5 Properties (one without dependencies, two on its own State, one on its parent, one on another
widget), 4 Methods and Events, in an 8-ary tree. 12.5% of the widgets are single-State `group`
widgets, so per-widget figures are a blend. `bare` has State only. See `lib/gen.mjs`.

## The baseline

**Machine**: Apple M1 Pro (8 cores reported), 32 GiB, Node 24.15.0, macOS. Background load was about
0.8 to 1.7 cores during the runs. Both runs are at git `6d43783`, dist fingerprints core
`43a418482c47`, vue `6e6cb47a01fa`, inspector `044e22503871`. A full run takes about 45 minutes.
Earlier numbers quoted for an "Apple M2" came from another machine and a harness with measurement
defects; they must not be compared with these.

**Comparing**: a before/after comparison must be made on the same machine, against the raw JSON:

```bash
node benchmarks/compare.mjs benchmarks/.results/baseline-1.json <after.json>
```

If `benchmarks/.results/` is absent (another machine), take a new baseline there first; the tracked
text under `benchmarks/handoff/baseline/` is for reading, not for `compare.mjs`.

### Reliability

Two full runs of the same code were compared (`baseline/compare-1-2.txt`). Of 672 timing rows (normal
and `--jitless`), 519 agree within 5% and carry no flag; 101 differ by more than 5%, 61 by more than
10%. `--jitless` rows are almost all reproducible. Normal-mode rows of operations of a millisecond or
more are reproducible (compile, `runtime.create` at 4 000 and above, `embedded.loop` at 1 000 and
above, `vue.mount`, `vue.unmount`, `inspector.snapshot` within about 2%).

Normal-mode rows of sub-microsecond operations are **not** a baseline: all 22 rows of
`runtime.state.set`, most of `runtime.method.invoke` and `runtime.subscribe.churn`, and several of
`runtime.property.get`, `runtime.reset`, `runtime.diagnostics` and `document.patch` differ between
runs (up to 2x), because the JIT settles in a different state from one process to the next; more
samples in one process do not help. To use such a scenario for a before/after claim, run it in several
processes each way and compare medians of medians. The runner has no `--repeat` option yet.

### Key numbers

Median of run 1 / run 2.

| What | normal | `--jitless` | Reliable |
| --- | --- | --- | --- |
| `blueprint.compile.valid / tree.standard` 4 000 | 73.0 / 79.1 ms | 194 / 191 ms | normal no (8.4% apart), jitless yes |
| same, 16 000 | 322 / 329 ms | 870 / 869 ms | yes |
| `runtime.create / standard` 4 000 | 38.2 / 37.9 ms | 106 / 107 ms | yes |
| same, 16 000 | 193 / 196 ms | 458 / 456 ms | yes |
| `document.patch / replace-config` 4 000 | 68.8 / 70.2 ms (tail flag) | 194 / 194 ms | jitless yes |
| `document.patch / noop` 4 000 | 26.9 / 26.9 µs | 60.2 / 60.6 µs | yes |
| `blueprint.compile.invalid / duplicate-id-one` 4 000 | 1.35 / 1.38 s | 3.54 / 3.55 s | yes (slope 2.0) |
| `embedded.loop / create-per-input.overrides` 1 000, per input | 10.8 / 10.7 ms | 26.8 / 27.0 ms | yes |
| `embedded.loop / reuse.resetState` 1 000, per input | 321 / 317 µs | 648 / 648 µs | yes |
| `embedded.loop / compile-per-input` 1 000, per input | 27.9 / 28.0 ms | 71.0 / 71.5 ms | yes |
| `runtime.reset / dirty` 4 000 | 1.73 / 1.72 ms | 3.76 / 3.83 ms | yes |
| `runtime.snapshot` 4 000 | 3.22 / 3.27 ms | 7.21 / 7.02 ms | normal yes |
| `vue.mount` 4 000 (simulated DOM, production Vue) | 99.2 / 99.9 ms | not run | yes |
| `vue.unmount` 4 000 | 18.1 / 18.1 ms | not run | yes |
| `vue.swap` 4 000 | 105 / 106 ms | not run | yes |
| `inspector.snapshot` 4 000 | 91.6 / 90.9 ms | not run | yes |
| `inspector.widget / last-node` 4 000 (first-unit: 7.9 µs at every size) | 144 / 146 µs | not run | yes |

**Memory** (identical in both runs): a standard widget retains 7.4 KB in the Blueprint and 21.2 KB in
the Runtime (+1.4 KB once every Property is evaluated); a bare widget 2.2 KB and 6.0 KB. Nothing is
retained after `dispose()` once references are dropped; while the handle is held, `dispose()` frees
essentially nothing. A compile allocates about 47 to 50 KB per widget and `createRuntime` about 32 KB
per widget.

**Size and load**: `@deviltea/widget-core` is 22.1 KB minified and gzipped (closure of the entry,
`alien-signals` not included); a cold import takes 4.3 ms.

**Slopes**: warm Property reads and the inspection walk are superlinear above 1 000 widgets even with a
warm pass. Reading one object costs 18 ns at every size; distinct objects cost 67 / 201 / 365 ns at
1 000 / 4 000 / 16 000. This is memory locality of a 21 KB-per-widget Runtime, not an algorithm.

### Known defects of the tooling

- **Profile attribution.** When a scenario has an expensive `fresh()`, V8 inlines the `benchUntimedFresh`
  wrapper, so set-up samples are counted as timed. Seen in `vue.unmount` (about 34% of its "timed"
  samples are mount and Runtime creation) and `inspection.blueprint / cold` (22.6% is compile code).
  Timing numbers are not affected (they come from the clock). Read those two summaries with that in
  mind, or filter the raw profile by call stack. A fix would bound the timed region by timestamps
  instead of by a wrapper function name.
- `--jitless` profiles put about 14% of self time on wrapper and call lines.
- No `--repeat` option (see "Reliability").
- No scenario measures the Inspector's pointer-event path, a first-touch inspection walk, or anything
  inside a real QuickJS engine; `--jitless` Node keeps V8's object model.

### The out-of-memory failure of the Vue scenarios (not a library leak)

With `NODE_ENV` unset, Vue's development build is loaded. It pushes every component's devtools events,
each holding the component instance (hence the vnode/DOM tree and the Runtime), into a module-level
`buffer` that only a `setTimeout(…, 3000)` scheduled with the first renderer clears
(`@vue/runtime-core` `runtime-core.cjs.js`, `emit$1` / `setDevtoolsHook$1`). The measurement loop
awaits only microtasks, so the timer never runs.

Evidence at 1 000 widgets, heap after forced GC per mount/unmount cycle: +45.8 MB per cycle with the
development build; flat (16 KB per cycle) when the 3 s timer is allowed to run first; flat with
`NODE_ENV=production`, where WeakRefs to the Runtime, the app, the root instance and the host element
are all collected. `@deviltea/widget-vue` leaks nothing: with one long-lived Runtime, 40 mount/unmount
cycles keep the heap at 49.2 to 49.4 MB, 40 `runtime`-prop swaps at 87.1 to 87.5 MB, and the count of
live subscriptions on the Runtime (from a heap snapshot) is 350 while mounted and 0 after unmount.
Every child process runs with `NODE_ENV=production`.

## Optimization candidates

Ranked. All gains are inferred from profiles; ids are those used in the analysis.

### Internal, no observable behavior change found (tests that pin behavior were checked)

1. **R1**: `resetState()` restores only the States written since the last reset (dirty bitset in
   creation order; `packages/core/src/runtime/state.ts` `restoreInitialState`, `attemptSet`,
   `captureInitial`). Reset is 95% of the reuse loop and visits all ~11 000 States although ~12 changed.
   Expected: reuse per input −85 to −95% and nearly independent of size. Must restore in ascending
   registry order (notification order; `reset-state.unit.test.ts`). About 40 lines.
2. **C1**: graph analysis on integer member ids instead of string keys, Tarjan only from members with
   outgoing edges, cycle lookup tables only when a cycle exists (`packages/core/src/blueprint/graph.ts`,
   `deps.ts`). `runGraphAnalysis` is 44.9% of compile (normal), 25.6% (jitless). Expected: compile and
   every `document.patch` −25 to −35% normal, −15 to −20% jitless. About 150 lines; `related` order and
   `invalidCycles` member order are pinned by tests.
3. **R2**: materialize a member's dependency callables on first evaluate/invoke instead of at creation
   (`runtime/deps.ts`, `property.ts`, `method.ts`). 22% of `createRuntime`, 4.4 KB per widget.
   Expected: create −20 to −25% in both modes, retained −15%; the cost moves to first use
   (`chain.cold` +30 to +45%).
4. **I1**: the Inspector Agent resolves a widget with Core's constant-time lookups instead of
   `blueprint.nodes.find(...)` (`packages/inspector/src/agent.ts` `resolveNodeId`, `nodeForAnchor`).
   The scan is about 93% of `last-node` at 4 000. Expected: −81% at 1 000, −94% at 4 000. About
   15 lines; add a test for "matching id, wrong type".
5. **C4**: write-effect analysis as a reverse breadth-first search instead of a fixed point
   (`graph.ts` `computeWritefulMethods`). Quadratic on Method-to-Method chains: 8.3 ms at 250 links,
   1 360 ms at 4 000 (measured). About 25 lines.
6. **R6**: `snapshotState()` assigns instead of `defineProperty` unless the key exists on
   `Object.prototype` (`runtime/index.ts`). `defineProperty` is 82.5% of its self time. Expected −65 to
   −80% normal, −30 to −45% jitless. About 5 lines.
7. **Small ones**: C2a skip the dependency builder when a member has no `registerDeps` (7 000 of 31 500
   builders unused); C5 build the structure-validator facade only when a validator exists (bare
   documents −12 to −20%); R5 iterate Maps with `.values()` (jitless create −6 to −10%); R7 write-path
   allocations (jitless State write −10 to −20%); R8 skip `owned.delete` during `dispose` (−10 to
   −20%); R9 one config fragment per node; C3 computed brand key last in object literals (jitless
   compile −7 to −10% in V8's interpreter, QuickJS unknown); C9, C8, C10; I2 memoize
   `capabilitiesForMinor`; I3 `smallestKeys` (−92% on descending keys, unlimited).

### Need the owner's decision (something observable changes)

- **C6** duplicate ids: share one frozen location object per node and stop re-freezing
  (`recovery.ts` `emitDuplicateIdDiagnostics`, `blueprint/index.ts`). Expected 10 to 30x; content and
  order unchanged, but a location object becomes shared across diagnostics (`===`); the output itself
  stays quadratic in size.
- **R3** build a RuntimeWidget on first `getWidget(id)`; **R4** create Property/Method/Event
  primitives on first need. Identity is kept through a cache, but cost moves to first access
  (`cold.all-units-ps0` +50 to +60% for R3) and `vue.mount` must be re-measured; R4 is structural
  (6+ files) and must keep diagnostics aggregate order.
- **C2b** lazy `dep.self` / `dep.root` / `dep.parent`, **V1** lazy `emit` surface in `useWidget()`: a
  data property becomes a cached accessor.
- **V2** `Object.preventExtensions` plus one `Object.create(null, descriptors)` in the Vue bridge:
  2 to 6% of mount CPU, uncertain.
- **I4** compact dependency arrays in `blueprint.getSnapshot`: protocol-visible, needs a new protocol
  minor.
- **D1** incremental recompile: at best 10 to 12% (it cannot skip `registerDeps` or
  `validateStructure`, which see the whole document) and touches node identity, `getSourcePath`,
  diagnostics order and "Editing is recompiling". Not recommended.

The adapter's own share of the Vue scenarios is small (mount 25%, swap 23%, unmount 3%, update under 2%
of CPU at 1 000 widgets), so Vue candidates are worth a few percent at most.

## Defects found on the way (not performance; for the owner)

- Compiling a Property dependency chain of 5 000 links throws `RangeError: Maximum call stack size
  exceeded` from the recursive `strongConnect` in `packages/core/src/blueprint/graph.ts` (4 000 links
  compile; reproduced on the built dist). The threshold depends on the engine's stack and is unknown
  for QuickJS. An iterative Tarjan removes it but changes error behavior, so it is the owner's call.
- The Lab `survey` showcase's `ConditionalSection.visible` reads another widget's raw State, so a mutual
  visibility condition compiles as valid and a hidden question's answer still counts. Reading a derived
  "effective value" Property makes the compiler report `property-evaluation-cycle` (verified with a
  scratch script).
- The Inspector and the Lab look nodes up by linear scan although Core offers constant-time lookups
  (see I1).

## What remains, in order

1. **Owner decisions** on the candidate list and on which workload matters most (editor keystrokes,
   embedded batch evaluation, first render of large documents). Bring the numbers above.
2. **Fix the tooling first** where a chosen candidate needs it: the profile attribution defect, and a
   repeat-processes option if the candidate targets a sub-microsecond scenario.
3. **Optimize**, one optimization per commit, with before/after numbers from this harness on the same
   machine in the commit message or the pull request, `--jitless` included (an optimization that helps
   the JIT can hurt an interpreter). The existing tests are the definition of unchanged behavior. Do
   not edit a test to make an optimization pass; if a test pins something an optimization must change,
   that is a behavior change and goes to the owner.
4. **Deliver** one pull request for the whole pass. Before opening it: delete `benchmarks/handoff/`,
   make sure `pnpm check` passes, and say in the description which machine the numbers come from.

## Rules that apply to this work

Read the root `AGENTS.md` and the `AGENTS.md` of each package you touch. The points below are the
ones that are easy to get wrong.

**Authority and design boundaries**

- The canonical design record is `DevilTea/widget` Discussion #12. Its `CURRENT / ACCEPTED` replies
  are decisions. Check it before changing anything semantic.
- Three boundaries are deliberate and were re-confirmed by the owner in November 2026. Do not
  propose crossing them as an optimization:
  - Core is synchronous. No async primitive, no Promise in Core, no public `batch()`.
  - Validity is all-or-nothing. No partial Runtime, no quarantine, no pruning in Core.
  - Core stays minimal and uses no host global except `queueMicrotask`. That rules out
    `performance.now`, timers, `structuredClone` and similar inside `packages/core/src`; an
    embedded engine may not have them.
- The reactive engine is `alien-signals`. Core must not grow a second batching or scheduling
  mechanism around it.
- `@deviltea/widget-vue` and `@deviltea/widget-inspector` depend on Core as a peer. Nothing may
  make them bundle Core or reach into Core internals.

**Release and git**

- The `0.1.0` releases are the owner's to run. Never run `pnpm release` or `pnpm release:tag`.
- Do not merge pull requests. Commit and push only as the owner instructs.
- The owner's delivery preference: parallel local branches merged locally into one branch, then
  one pull request.
- The pre-commit hook runs `pnpm lint-staged`; fix what it reports, never bypass it.

**Verification traps**

- Run `pnpm docs:build:pages` only **after** `pnpm --filter widget-lab test:browser`. The Pages
  build rebuilds the Lab under another base path, and a browser run started after it fails on about
  ninety tests for unrelated reasons.
- Give `rg` an explicit path (`rg pattern .`). Without one it reads standard input when it is not a
  terminal and waits forever.
- The unit tests run with `--expose-gc` (root and Core vitest configuration); a few tests observe
  garbage collection.
- Never benchmark while tests, builds or other agents are running on the same machine.
- If you delegate to subagents in isolated worktrees: those worktrees start from `main`, not from
  the branch you are on; the first step in each brief must be to fast-forward to your branch.

**Working with the owner**

- The owner writes in Taiwan Traditional Chinese and expects replies in it, with technical
  identifiers left as they are. Repository files are English.
- The owner's standing instruction in the previous session was to lead with the answer, to
  distinguish measured facts from inference, and to ask only for decisions that are genuinely
  theirs.

