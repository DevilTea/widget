# Benchmarks on GitHub Actions

`.github/workflows/benchmark.yml` measures several commits **in one job on one hosted runner, interleaved**, and
compares them, so a benchmark run does not need a developer machine. It only reports: read-only permissions, a job
summary and an artifact. It does not run for pull requests or on a schedule, and it must not become a required check.

## Request a run

Edit [`request.json`](./request.json):

| field | meaning |
| --- | --- |
| `refs` | two or more git refs or SHAs; the first is the base. Consecutive refs are compared pairwise, and the last is also compared with the first |
| `filters` | scenario ids or prefixes (see `pnpm bench --list`); empty = everything |
| `modes` | `normal`, `jitless`, `alloc`; default `["normal", "jitless"]` |
| `sizes` | widget counts; empty = the scenarios' own sizes |
| `stackSizes` | QuickJS stack sizes in KB (integers from 64 to 1 048 576, at most 12); empty (the default) = a normal run. A non-empty list switches the whole run to the [stack-size sweep](#stack-size-sweep) |
| `rounds` | measurements per ref, 1 to 20; default 3 |
| `quickjs` | also run the QuickJS suite (`benchmarks/quickjs`, Linux x86_64 binary) and, next to it, the same bundle under `node --jitless` as a calibration |
| `quick` | few samples, only to test the workflow itself |
| `note` | free text shown at the top of the summary |

Then either

* commit and push to a branch named `perf/**`: a push that changes `benchmarks/ci/request.json` starts the run (this
  works before the workflow is on `main`). If the very first push of a new branch does not start it, push another
  commit that changes the file; or
* once the workflow is on `main`: `gh workflow run benchmark.yml -f refs=main,perf/x -f filters=runtime.create -f rounds=3`
  (the inputs override the request's fields; an empty input keeps the request's value).

Each ref is checked out as a detached `git worktree` of the same clone, installed with `pnpm install --frozen-lockfile
--ignore-scripts` and built with `pnpm --filter "./packages/*" build` in that worktree, so a ref needs a lockfile that is
in sync and a build that works. The harness itself always comes from the commit that triggered the run
(`BENCH_PACKAGES_ROOT` points it at each ref's packages), so refs older than the harness can be measured.

## Read the result

Open the run's job summary (written by `run-ab.mjs`): the note, the commits with their SHAs, the runner hardware, any
problems, then per comparison the rows whose medians differ by more than 5 % (A is the first ref of the pair, B the
second; a B/A ratio above 1 means B is slower). Per row a ref's value is the median of the per-round medians, and
min..max shows the spread between rounds. A difference that is not marked significant is noise. The full tables, every
raw sample (`r<round>-<ref>.json`) and every log are in the artifact `benchmark-results` (kept for 30 days).

`--jitless` rows are the most reproducible and matter most for the interpreter-only embedding. Normal-mode rows of
sub-microsecond operations can differ between processes by more than the spread shows; use more rounds.

## Stack-size sweep

With a non-empty `stackSizes` (a request field, or the `stackSizes` input of `gh workflow run benchmark.yml -f
refs=... -f stackSizes=256,512,1024,2048,4096`; it implies `quickjs`) the job does **not** measure time. It runs only
the QuickJS stack probes (`benchmarks/quickjs/run.mjs --probes-only true`; see
[`../quickjs/README.md`](../quickjs/README.md#stack-probes)) on the real binary, once per ref and per stack size, plus
once without `--stack-size` (the engine's default). `filters`, `modes`, `sizes`, `rounds` and `quick` are ignored, there
is no harness run, no calibration under Node and no comparison between refs: the probes are deterministic bisections, so
the sweep has no rounds, and the refs only serve as separate tables.

The job summary has one table per ref: rows are the engine's plain recursion depth (a calibration without any Widget
code) followed by shape and phase, columns are the engine default and each stack size. A cell is the largest length
that still works, "at least N" when the probe still worked at the cap of its search (N is then a lower bound, not a
limit) and "< N" when it failed already at the first length tried. If the calibration row does not grow in proportion
to the stack size, the engine did not read `--stack-size` as KB and the other rows mean nothing. The artifact has the
complete results of each cell (`s<ref>-<stack>.json`, every attempt included).

Cost: each cell is a bisection of up to about 17 fresh processes per shape and phase (12 combinations), so a cell is
a few hundred engine starts. This has only been timed under Node (about 17 s for the default stack; larger stacks take
longer because more attempts reach the cap); the real interpreter will be slower. Keep `refs` and `stackSizes` short.
The default request has no `stackSizes`, so it behaves as before.

## Why numbers from different jobs must not be compared

A hosted runner is a shared virtual machine. Its CPU model, its neighbours and its clock differ from job to job, so an
absolute number (or a ratio against a baseline taken in another job) says nothing. Only commits measured **in the same
job, interleaved (A, B, A, B, ... with the order rotating each round) and with the same copy of the harness** can be
compared. To compare against `main`, put `main` in `refs`; never against an earlier run's summary. Running the same
code under two refs (as the default request does: the two refs have identical `packages/`) measures the noise floor of
that runner: whatever it shows as a difference is noise.

## Duration

The job has a 330 minute timeout. Measuring is sequential: `rounds` x `refs` harness runs, plus the same count of
QuickJS runs when enabled, plus about half a minute per ref to install and build. Measured locally (Apple M1 Pro, loaded by other work): one full-quality harness run of the default smoke filters
(`runtime.create`, `embedded.loop`, `blueprint.compile.valid`, normal + jitless) takes about 8 minutes, so the two
refs x two rounds of the default request are about 32 minutes of harness time here. A hosted runner is slower than
that by a factor that is not known yet (assume 1.5 to 2.5), so expect roughly 50 to 90 minutes in total; the first
real run will replace this estimate. The QuickJS part per run (suite plus the `node --jitless` calibration of the same
bundle) was measured only with Node as the engine, about 15 seconds each;
the real interpreter and its stack probes will take longer and that is not measured. A full request (no filters, 3
rounds) is about 45 minutes per harness run on the M1, so a few refs x 3 rounds can approach the 330 minute limit:
reduce `rounds`, `modes` or `filters` instead of relying on the timeout.
