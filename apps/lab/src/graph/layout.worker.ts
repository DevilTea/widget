/**
 * The persistent ELK layout Worker (diagnostic #13 Phase 5 "Dependency Graph worker loading" comment).
 *
 * `elkjs` splits across two halves: `elk-api.js`'s `ELK` class is the *requesting*-side orchestrator
 * (it owns a `Worker` handle and does promise/request-id bookkeeping over `postMessage`), while
 * `elk-worker.js` is the actual GWT-compiled layout algorithm, designed to run *inside* a Worker and
 * self-register `self.onmessage` the moment it is loaded there (see its own `exportLayout()`). This
 * module is deliberately just that one side-effect import: it makes this dedicated Vite module Worker
 * be* the elkjs worker, with zero protocol code of our own to keep the worker itself thin (diagnostic #13
 * Phase 5: the worker is excluded from the test suite by design — `layout-client.ts` owns the
 * `ELK`/`layoutGraph()` orchestration and is what `layout-session.ts` tests exercise via a fake).
 *
 * `elkjs` is imported normally (not via `importScripts()`/function stringification) so Vite owns
 * dependency bundling for this module.
 */
import 'elkjs/lib/elk-worker.js'
