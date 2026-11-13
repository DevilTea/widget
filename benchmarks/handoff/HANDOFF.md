# Handoff: performance optimization pass

Written 2026-11-13 for the agent that continues this work. Everything you need is on this branch
(`perf/benchmark-baseline`); nothing lives only in the previous session.

**Delete this `benchmarks/handoff/` directory before the work is proposed for merge.** It is a
working note, not documentation.

## Where things stand

The owner asked for the performance of the three published packages (`@deviltea/widget-core`,
`@deviltea/widget-vue`, `@deviltea/widget-inspector`) to be optimized. Nothing in the repository
measured performance, so the work was planned in this order:

1. **Measure**: a benchmark harness, a trustworthy baseline, CPU profiles, memory figures.
2. **Decide**: rank optimization candidates from the data and agree them with the owner.
3. **Optimize**: one candidate at a time, each proven with the same harness, behavior unchanged.
4. **Deliver**: one pull request.

The work stopped in the middle of step 1, when the agent building the harness hit a usage limit.

| Step | State |
| --- | --- |
| Harness (`benchmarks/`, `pnpm bench`) | Written, committed here as work in progress, not reviewed. Core scenarios run; the Vue scenarios run out of memory and stop the suite (see "Known defect"). |
| Baseline numbers | **Preliminary only.** One full-quality run covered every Core scenario but was taken on a busy machine; Vue, Inspector, size and load have only smoke-quality numbers. |
| CPU profiles | None captured. |
| Optimization | **Nothing has been optimized. No file under `packages/` or `apps/` has been changed.** |
| Owner decisions about what to optimize | None yet. |

The branch is based on `main` at `38cff3c`. The preliminary numbers were taken at commit `532439e`,
whose tree is identical to `38cff3c`.

## Start here

```bash
git fetch origin && git switch perf/benchmark-baseline
pnpm install --frozen-lockfile
pnpm --filter "./packages/*" build      # the harness measures packages/*/dist and refuses to run without it
pnpm bench --list                       # every scenario id
pnpm bench --quick                      # smoke run of the whole suite, a few minutes; NOT baseline quality
pnpm bench runtime.create               # one scenario at full quality
node benchmarks/profile.mjs runtime.create --variant standard --size 4000
```

Read [`../README.md`](../README.md) next: it explains the measurement method, the output columns,
the three modes (`normal`, `jitless`, `alloc`) and how to add a scenario.

## What is on this branch

| Path | What it is |
| --- | --- |
| `benchmarks/run.mjs`, `worker.mjs`, `profile.mjs` | The runner (one child process per scenario, sequential), the child, and the CPU-profile summarizer |
| `benchmarks/lib/` | Measurement loop and statistics, report tables, `.cpuprofile` parsing, the synthetic document generator (`gen.mjs`) |
| `benchmarks/scenarios/` | Scenario definitions: Core compile, Core runtime, Core memory, Vue, Inspector, size and load |
| `package.json` | Adds the `bench` script. No new dependency, no workspace package, lockfile untouched |
| `eslint.config.js` | Allows `console` and top-level `await` in `benchmarks/**/*.mjs` |
| `benchmarks/handoff/baseline-spec.md` | The specification the harness was built to. Its paths under `/private/tmp/...` were session scratch space and no longer exist; the content is still the definition of "baseline done" |
| `benchmarks/handoff/preliminary-full-run.txt` | Output of the full-quality run (Core scenarios, memory) |
| `benchmarks/handoff/preliminary-full-run.log.txt` | Its progress log: load average and interference per scenario, sample counts |
| `benchmarks/handoff/preliminary-quick-run.txt` | Output of an earlier `--quick` run that completed the whole suite, including Vue, Inspector, size and load |
| `benchmarks/handoff/handoff-quick-run.txt`, `handoff-quick-run.log.txt` | Output and the end of the log of the `--quick` run made at handoff, which failed in `vue.unmount` |

The synthetic "standard" widget, which most scenarios use, has a config, 3 State members,
5 Properties (one without dependencies, two on its own State, one on its parent, one on another
widget), 4 Methods and Events, in an 8-ary tree. `bare` has State only. See `lib/gen.mjs`.

### Checked at handoff

- `pnpm bench --list` lists 29 scenarios.
- `pnpm bench system.create --quick` and `pnpm bench vue.mount --quick` complete when run alone.
- `pnpm exec eslint benchmarks package.json eslint.config.js` reports nothing.
- `pnpm bench --quick` (the whole suite) **does not complete**: see the next section.

### Known defect: the Vue scenarios run out of memory

The suite currently cannot be run end to end. Two runs died with
`FATAL ERROR: ... JavaScript heap out of memory` in a Vue scenario, and the runner stops the whole
suite when a child fails, so nothing after that point ran.

| Run | Died in | Evidence |
| --- | --- | --- |
| Full-quality run | `vue.mount [normal]` | `preliminary-full-run.log.txt`, from line 842 |
| Quick run at handoff | `vue.unmount [normal]` at 4 000 widgets, after 100 and 1 000 completed; heap at 3.9 GB | `handoff-quick-run.log.txt` |

An earlier quick run on the same day completed both scenarios (`preliminary-quick-run.txt`), so it
is either intermittent or was introduced by a later edit to the harness.

The cause is not diagnosed. Find out which of these it is before anything else, because the third
would be the most important finding of the whole pass:

1. The harness keeps too much alive: it builds the inputs of a whole batch before the clock starts,
   which for `vue.unmount` means many mounted 4 000-widget trees at once.
2. The simulated DOM (happy-dom) retains detached nodes.
3. `@deviltea/widget-vue` leaks on unmount (a subscription or a component instance that is never
   released). `memory.retained` shows Core itself releases everything after `dispose()`; nothing
   yet checks the same for a mounted and unmounted renderer.

`handoff-quick-run.txt` holds the output of that run up to the failure: every Core scenario,
`memory.retained` and `vue.mount`. `vue.unmount`, `vue.update`, `vue.swap`, the Inspector
scenarios, `size.bytes` and `load.cold` did not run in it.

### Not checked, treat as open

- The harness code has not been reviewed by anyone. The previous agent was in the middle of an
  edit when it stopped; I do not know which one. Read the scenario modules before trusting a
  number, in particular what is inside the timed region of each.
- The full-quality Vue, Inspector, size and load scenarios have never finished. Their only numbers
  are from the earlier quick run.
- Whether the runner should continue with the remaining scenarios when one child fails. Today it
  stops, which is why one out-of-memory failure hides everything after it.
- `pnpm typecheck` was not run against this branch. The harness is plain `.mjs` and should not be
  in any `tsconfig`, but confirm it.
- The README says a full run takes about an hour on an Apple M2.

## Preliminary numbers

Machine: Apple M2, 8 cores, Node 24.15.0. **The machine was not idle**: the load average was 4.3 when
the run started, other processes used 1.5 to 2.8 cores during several scenarios, and 36 rows are
flagged `UNRELIABLE` (spread above 10%). Use these to decide where to look, not as the baseline to
compare optimizations against. `--jitless` approximates an interpreter-only engine: the library is
embedded in QuickJS by at least one host, and the design record (Discussion #12, C0R159) says that
creating a Runtime per input dominated that host's cost.

"Standard" 8-ary tree unless stated; normal Node / `--jitless`.

| What | 1 000 widgets | 4 000 widgets | 16 000 widgets | Notes |
| --- | --- | --- | --- | --- |
| `blueprint.compile.valid` | 20.9 ms / 38.9 ms | 85.5 ms / 175 ms | 321 ms / 800 ms | About 20 µs per widget (40 to 50 µs jitless), linear |
| `runtime.create` | 6.35 ms / 19.3 ms | 41.8 ms / 101 ms | 203 ms / 442 ms | 6 µs per widget at 1 000, 13 µs at 16 000: slope 1.36 between 1 000 and 4 000 |
| `document.patch` (replace one config value) | 17.3 ms / 39.5 ms | 62.5 ms / 178 ms | 315 ms / 793 ms | Equal to a full compile of the document |
| `document.patch` (no-op patch) | 26 µs / 53 µs | 28 µs / 56 µs | 36 µs / 74 µs | No recompile |
| `blueprint.compile.invalid`, every node sharing one id | 66 ms / 198 ms | 1.24 s / 3.27 s | not run (exhausts a 4 GB heap) | Slope 2.0: quadratic |

Embedded-host loop, cost **per input** (apply a few State values, invoke 3 Methods, read
4 Properties), on a Blueprint compiled once:

| Variant | 100 widgets | 1 000 widgets | 4 000 widgets |
| --- | --- | --- | --- |
| Create a Runtime per input (`overrideStateDefaults`), then dispose | 0.86 ms / 1.86 ms | 10.2 ms / 30.1 ms | 49.0 ms / 117 ms |
| Reuse one Runtime through `resetState()` | 35 µs / 87 µs | 264 µs / 592 µs | 1.09 ms / 2.77 ms |
| Compile and create per input (no reuse) | 2.34 ms / 6.57 ms | 26.7 ms / 80.8 ms | 125 ms / 351 ms |

Memory, "standard" profile, per widget (stable from 1 000 to 16 000 widgets):

| | Retained | Allocated while building (approximate) |
| --- | --- | --- |
| Blueprint | 7.4 KB | about 50 KB |
| Runtime | 21.2 KB (+1.4 KB once every Property has been evaluated) | about 32 KB |

A `bare` widget (State only) retains 2.2 KB in the Blueprint and 6.0 KB in the Runtime. Nothing is
retained after `dispose()` once the references are dropped.

From the quick run only (smoke quality): `@deviltea/widget-core` is 22.1 KB minified and gzipped
(158 KB raw entry file); a cold import takes about 4 ms; `vue.mount` is about 39 µs per widget in a
simulated DOM.

Every row with a scaling slope above 1.15 in the full run (`!` in the output) is in
`preliminary-full-run.txt`. Besides the ones above: `runtime.property.get / warm` and
`inspection.runtime / walk` show a slope near 2 between 1 000 and 4 000 widgets on operations that
should be constant per widget, and `runtime.reset`, `runtime.snapshot` and `inspection.blueprint`
sit between 1.2 and 1.4.

## What the numbers suggest

These are leads, not findings. None has a profile behind it yet.

1. **Runtime creation is the largest lever.** It costs 6 to 13 µs and about 32 KB of allocation per
   widget, grows faster than linearly, and is two to three times slower without a JIT. The embedded loop
   shows what it means in practice: creating a Runtime per input is about 40 times more expensive
   than reusing one through `resetState()`. Find out what is built eagerly per member at creation
   that could be built on first use.
2. **Compilation allocates about seven times what it retains** (50 KB allocated, 7.4 KB kept per
   widget). Allocation churn is the first thing to look for in its profile.
3. **Every effective edit recompiles the whole document.** `document.patch` equals a full compile:
   17 ms at 1 000 widgets, 63 ms at 4 000, 315 ms at 16 000, per keystroke in an editor. Reusing
   the compiled result of unchanged subtrees would be the big win here, and it is also the riskiest
   change on this list: the guide states "Editing is recompiling, not mutating", and node identity
   across compiles, diagnostics order and `getSourcePath` all depend on a full compile today. Treat
   it as a design proposal for the owner, not as an internal optimization.
4. **Duplicate ids are quadratic.** Confirmed: 1.24 s for 4 000 nodes sharing one id. Only
   pathological input hits it and the fix is probably local (`emitDuplicateIdDiagnostics`), so it
   is cheap to do but will not make ordinary documents faster.
5. **Slope near 2 on warm Property reads and on the inspection walk** between 1 000 and 4 000
   widgets. This may be cache behavior of a large `Map` rather than an algorithm; a profile and a
   run at intermediate sizes will tell.

## What remains, in order

### 1. Finish the baseline

- Diagnose and fix the out-of-memory failure of the Vue scenarios (see "Known defect"). If it is a
  leak in `@deviltea/widget-vue`, stop and report it to the owner: that is a defect, not a
  benchmark problem.
- Run the full suite on a machine that is as idle as you can make it and keep the JSON:
  `pnpm bench --json baseline.json`. Close other work first; the runner waits for the machine to
  calm down and prints a warning per scenario when it did not. A row flagged `UNRELIABLE` is not a
  baseline.
- Capture CPU profiles (`node benchmarks/profile.mjs <scenario> --variant <name> --size <n>`) for
  at least: `blueprint.compile.valid` (`tree.standard`, 4 000), `runtime.create` (`standard`,
  4 000), `embedded.loop` (`create-per-input.overrides`, 1 000), `document.patch`
  (`replace-config`, 4 000), `blueprint.compile.invalid` (`duplicate-id-one`, 2 000),
  `runtime.property.get` (`warm.all-units-ps0`, 4 000), `inspection.runtime` (`walk`, 4 000),
  `runtime.reset` and `runtime.snapshot` (4 000).
- Decide where the baseline results live. Committing a results file ties it to one machine;
  the alternative is to keep it out of the repository and quote the numbers in the pull request.

### 2. Bring a ranked list to the owner

For each candidate: the scenario and numbers it would improve, what the profile shows, the size of
the change, and whether any observable behavior changes. Internal optimizations can be scheduled
without asking. Anything that changes public behavior, public types, diagnostics order or object
identity needs the owner's decision first. The owner was asked which workloads matter most to them
(editor keystrokes, embedded batch evaluation, first render of large documents) and has not
answered; ask again with the numbers in hand.

### 3. Optimize

- One optimization per commit, each with the before and after numbers from the same harness on the
  same machine in the commit message or the pull request.
- The existing tests are the definition of unchanged behavior. Do not edit a test to make an
  optimization pass; if a test pins something an optimization must change, that is a behavior
  change and goes to the owner.
- Re-run the affected scenarios in `--jitless` too: an optimization that helps the JIT can hurt an
  interpreter.

### 4. Deliver

One pull request for the whole pass. Before opening it: delete `benchmarks/handoff/`, make sure
`pnpm check` passes, and say in the description which machine the numbers come from.

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

