# cod2.ts — Performance Verification Protocol

## What changed, not an invented speedup

The previous importer converted gameplay images/audio/models/animations and a fixed map before the engine menu. Bootstrap now excludes those payload families. Regression tests reject a gameplay payload read during bootstrap. This removes categories of work from first-menu latency; it does **not** prove a particular number of seconds or a 100× speedup.

A real browser first-menu / first-map / warm-map timing was **not** completed in this environment. The symbolized executable is not a set of retail IWD assets. Tiny synthetic fixtures test correctness only. PNG microbenchmarks are not end-to-end benchmarks.

## Measurement protocol

Build with `npm ci && npm run build` and serve the same origin on every run. Disable CPU/network throttling for the baseline, close other game tabs, and record browser/OS/CPU/GPU/storage, archive inventory, production build revision and persistence status. Never compare Vite development startup against a production warm cache.

Measure separate milestones:

1. **First menu:** fresh site storage, choose the installation, stop at the first presentable menu frame. Confirm no BSP/model/animation/gameplay-audio payloads were converted.
2. **First selected map:** pick a map not yet cached, stop when the map and required visible resources are ready. Note conversion time separately from GPU upload/audio decoding.
3. **Warm selected map:** reload the page and select the same map. Confirm `X-CoD2-Cache: unit-hit` for unit responses and no archive read for those hits.
4. **Different map/shared assets:** select another map with shared materials/models. Check shared canonical paths, no unnecessary duplicate unit, and the correct faction/atmosphere.

Repeat at least five times per condition and report the individual samples, median and slowest result. Also test a revoked folder permission: warm content should work; a genuinely cold unit should request permission rather than claiming a completed full install.

## Instrumentation

`window.__cod2LoadTimings` records launcher milestones. `window.__cod2AssetTimings` records requests that reached the demand worker and their converter durations. Warm responses served entirely inside the service worker **do not** pass through that broker timing array; inspect DevTools resource timings and the `X-CoD2-Cache` response header for them. `cod2:asset-status` events expose current worker task paths and completion/error information.

Cache hits avoid extraction/conversion, not JavaScript parse, GPU resource creation, shader compilation or audio decoding. A selected map still compiles as one world unit; intra-map streaming and speculative idle prewarming are future work. Demand-unit lookup currently reads marker/size metadata and can be optimized further after a real warm-load trace identifies its cost.

## Acceptance criteria

No gameplay payload work before the first menu; only the selected world's geometry during map conversion; shared assets cached once per canonical variant; no invalid generation publication; no source-folder reads for warm hits; explicit errors for unavailable/unsupported content. Timing targets must be set from measured real-install results rather than fabricated estimates.
