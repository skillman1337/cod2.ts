# cod2.ts — Verification Protocol & Test Results

> The GitHub/subpath pass has its own [current verification record](GITHUB-VERIFICATION.md). Counts and limitations below describe the earlier menu-first refactor, not the current CI result.

## Source-only checks

```sh
npm ci
npm run verify
npm run build
```

`verify` checks TypeScript, ownership boundaries, WebGPU ownership, execution annotations/map freshness, 31 architecture mutation cases, emitted local-worker dependency resolution and synthetic browser-loader contracts. These checks need no retail archives. The production build is **separate** and requires the pinned Vite dependency; a source-graph check is not a Vite/Rollup build.

## Historical results from the menu-first refactor environment

- Type checking passed using installed TypeScript **5.8.3**, not the pinned **5.9.3**. Recheck with `npm ci` on a normal networked machine/CI runner.
- Loader tests: **117 passed, 1 skipped**. The suite is run sequentially to avoid resource contention between independent worker/format fixtures. The skip needs an optional external binary fixture. The passing set includes 18 tests around real import/demand-worker and service-worker handlers with simulated OPFS, IndexedDB, locks and client ports.
- Runtime emission check: 40 files, 80 import edges, 37 virtual engine asset imports. It does not read or bundle retail assets.
- Native reference inspection completed statically using LLVM, without running the binary.
- Full production Vite build: **not executed successfully** because pinned package installation was blocked by package-registry DNS/network access in this environment.
- Native-browser demand integration: **not verified**. Chromium blocked the localhost test navigation with `ERR_BLOCKED_BY_ADMINISTRATOR` under a managed URL policy. No browser-policy bypass was attempted.
- The separate launcher DOM suite did not complete within the environment's execution timeout. The approved UI is retained, but earlier-turn UI pass counts are not claimed as verification of this source revision.
- Real retail map/gameplay/end-to-end timing: **not verified**. Complete retail IWD archives were not supplied for this run. The reference executable and synthetic fixtures are not substitutes.

The aggregate `npm run verify` command was attempted twice and timed out after reaching the loader suite, despite the standalone sequential loader run completing successfully. The cause of that aggregate-run timeout is unresolved. Treat the individual passed checks and the timed-out aggregate run as separate results; do not report the aggregate as passed.

## What the demand tests exercise

Bootstrap rejects eager BSP/model/animation/gameplay-audio reads; arbitrary map dispatch and faction isolation; cold and warm cache responses; aliases share model/animation units; range and HEAD responses; worker restart; cross-request coalescing; corrupt cache detection; quota/cancellation/publication failures; changed source index; no network fallback for retail media. Tests import the actual handlers, not a second reimplementation of the loader. Their storage/worker ports are mocks, so browser scheduling, permissions and OPFS semantics still need native integration testing.

Synthetic fixtures generate original tiny ZIP/IBSP/model/XAnim/image records. They do not contain game media and do not validate real-map visual fidelity.

## Optional native-browser tests

```sh
python -m pip install playwright
python -m playwright install chromium
npm run verify:demand-browser
npm run verify:ui
```

The demand suite starts a local server for the exact emitted runtime files and uses browser storage. It never serves private retail assets. Run it on a machine whose browser policy permits local testing. Missing test prerequisites or blocked execution must not be recorded as a pass.

## Legacy offline toolchain

`build:modules`, `verify:legacy-build`, `verify:legacy-build-selftest`, `verify:lifecycle`, physics/native comparison and movement-recording tools predate the browser-only asset build. Several require privately extracted `assets/` tables/media and/or native fixtures. The legacy build self-test was attempted here and failed on missing extracted assets; it has not been silently relabeled a success.

These commands remain available for private reference work but are no longer part of the no-retail-data source CI. Do not add proprietary assets to a GitHub repository just to make those old checks pass. The current browser production entry point is `npm run build` and its runtime-asset plugin.
