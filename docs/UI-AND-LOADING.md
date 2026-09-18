> **Historical document.** Superseded for loading and release status by [LOADING-ARCHITECTURE.md](LOADING-ARCHITECTURE.md), [MODULE-AUDIT.md](MODULE-AUDIT.md) and [VERIFICATION.md](VERIFICATION.md). Original measurements/claims below describe an earlier revision.

# cod2.ts — Minimal Launcher and Loading Pipeline

## Delivery scope

This source update redesigns the browser-local installer and reduces repeated
import and startup work for **cod2.ts**. It contains **no retail game files** and does not upload
selected files. The original installation is accessed read-only. No 100× or
subsecond end-to-end speedup has been established.

The cache format remains **version 5**, at `cod2-local-assets-v5`. Valid existing
caches can be reused. A rebuild is not required merely to get the new interface,
parallel cache reads, or menu-first startup. Import-only changes take effect on
new imports and explicit rebuilds.

## User-facing flow

**First visit:** “Your game. One-time setup.” The primary action is “Locate game
folder.” Supporting copy says: “Choose your Call of Duty 2 folder once. Next time,
we’ll load straight from the local cache.” A compact, collapsed “Details & local
files” disclosure contains the example path, privacy/storage caveats, log, and
rebuild/delete controls. There is no wall of competing primary actions.

**Returning visit:** validate the completed cache and launch it automatically.
Do not ask for folder permission or extract IWD archives again. When a folder is
remembered but the cache has disappeared, show “Use saved folder” instead of
silently re-importing. Storage eviction, cleared site data, a different browser
profile, or a different origin can still require another import.

**Loading:** show the actual stage, current archive or asset path, completed
file/JSON-table counts, bytes cached where available, and elapsed time. Import
has Locate / Prepare / Cache / Launch wayfinding. Cached startup omits those
first-time steps. Progress uses completed pipeline stages, not an invented
percentage of elapsed work. Stage costs are unequal, so the bar is not an ETA.
File counts and bytes are cumulative completed writes; the displayed current
path can be the next file being processed.

**Graphics handoff:** the installer remains visible through engine-module
loading, GPU initialization, background/font/cursor loading, visible-menu
material requests, and submission of the first presentable menu frame. A loaded
JavaScript module is no longer treated as a finished game screen. Submission is
the measured endpoint, not an independently observed display scanout.

The theme uses olive/khaki tones, a large condensed wordmark, restrained contour
lines, and an animated signal/progress sweep. It uses CSS and system fonts only.
Reduced-motion preferences disable the animation. Stage announcements are
throttled; high-frequency file changes are not screen-reader live announcements.
The setup panel is responsive, although running the game still requires the
supported desktop browser capabilities.

## What the supplied trace establishes

Input: `Trace-20260918T073938.json.gz`. The raw trace is not redistributed in this
source package. A sanitized numerical summary is included in
`docs/performance/original-trace-summary.json`.

| Observation | Value | Interpretation |
| --- | ---: | --- |
| Exported recording window | 36.575248 s | Not itself an instrumented time-to-menu |
| Dedicated-worker CompressionStream Deflate slices | 8.386320 s | Substantial conversion/compression work |
| Dedicated-worker DecompressionStream Inflate slices | 0.540339 s | Smaller than compression in this recording |
| Dedicated-worker RunTask slices | 16.044877 s | Includes nested work; do not add to compression |
| Engine `/index.ts` request | 31.008901 s after window start | Much of this recording precedes engine entry loading |
| Configured download rate | 5,000,000 bytes/s | About 40 Mbit/s |
| Configured latency | 80 ms | Development-module loading is not an unthrottled production benchmark |

The trace also records an import worker and `retail-pipeline.js`, and requests
originate from the Vite development server. It therefore includes first-time or
rebuild extraction work, rather than demonstrating a pure cached-return launch.
The export has `packetLoss: 1`; that raw setting is preserved in the JSON without
assuming an undocumented unit.

Slice durations are grouped by thread and event name. Nested slices and
parallel threads overlap. These values are not an additive wall-clock waterfall.
The supplied version has no equivalent first-menu-ready marker, so a precise
old-versus-new time-to-menu comparison cannot be derived from this trace alone.

Reproduce the extraction:

```sh
python tools/analyze_load_trace.py /path/to/Trace.json.gz --output trace-summary.json
```

## Implemented performance changes

| Area | Change | Scope / tradeoff |
| --- | --- | --- |
| Cache validation | Eight bounded concurrent reads rather than serial required-file reads | Real files and sizes remain checked |
| Cache launch | Reuse validated File snapshots for JSON; parse up to eight tables concurrently while binding the service worker | Does not skip initialization ordering |
| Service worker | Reuse directory/file handles; avoid another full required-file scan on every bind | Each served file is still opened and size-checked against its committed manifest |
| Import writes | Prefer worker-only OPFS synchronous access handles, with checked partial writes, truncate, flush and close | Async stream fallback remains when the API is unavailable |
| Archive reads | Coalesce concurrent reads and retain a 64 MiB byte-bounded LRU | Adds bounded temporary worker memory, not a second persistent asset cache |
| PNG conversions | Reuse/coalesce identical texture conversion results in a 48 MiB LRU | Identical source/face conversions can avoid repeated decode/compress work |
| JSON / audio output | Compact JSON and skip duplicate audio writes | JSON values and audio data are unchanged |
| Menu materials | Request materials when visible quads need them, with at most four pending loads in flight | Opening other menus may cause their first load then |
| Gameplay sounds | No full alias-bank prefetch at app startup; begin bounded map-time warmup | An immediate first-use sound can wait for an uncached fetch/decode |
| UI overhead | Throttled progress, bounded log, no hidden-log DOM rewrites | Detailed status does not require a framework |
| Development/build | Vite engine-source warmup; production worker is an explicit bundled entry | Production bundling still needs verification in a dependency-enabled environment |

The two import LRUs bound retained payloads to 112 MiB combined; decoder working
buffers, archive indices, pending requests and the engine use additional memory.
Evicted textures can be converted again. This is not a claim that every source
is converted exactly once for the entire import.

A sampled PNG row-predictor experiment was **rejected** after synthetic tests:
it reduced file sizes but made all three tested encoding cases slower. The
shipped encoder retains raw, lossless RGBA scanlines, validates dimensions, and
properly propagates stream errors. Byte-exact tests cover transparent RGB too.
No encoder-only speedup is claimed. Baseline and rejected-experiment numbers are
in `docs/performance/`; they are synthetic Node measurements, not CoD2 timings.

```sh
npm run bench:load
```

No new production dependencies were added.

## Safety and cache behavior

The complete marker and IndexedDB active-generation update remain the activation
boundary. Canceling setup terminates the dedicated worker and removes the
incomplete generation. A failed conversion/write cannot silently activate a
partially written cache. Import and deletion use the existing exclusive lock.
Asset responses retain local-only routing, path checks, manifest size checks,
HTTP byte-range support, and `Cache-Control: no-store`. The completed OPFS cache,
not duplicated HTTP response bodies, is the persistent asset source.

A read or size check cannot detect arbitrary same-size byte corruption. This
update does not introduce full content hashing or promise transactional behavior
across unrelated browser tabs, external site-data deletion, or storage eviction.
“Delete local cache” explicitly warns that other running tabs can lose access.

## Instrumentation and a fair before/after comparison

The console exposes `window.__cod2LoadTimings` after successful menu handoff:

- `source`: `first-import` or `local-cache`.
- `cacheCheckMs`: initial required-cache validation.
- `importMs`: first import, including folder inspection, conversion and commit;
  null on a cached visit.
- `launchMs`: launch preparation through first presentable menu frame submission.
- `engineModuleMs`: dynamic engine import/evaluation.
- `graphicsMs`: time after module import until menu readiness is observed.
- `totalSinceBootMs`: bootstrap-to-menu, including user wait before choosing a
  folder on first visit. Do not compare this to pure processing time.

`cod2:*` marks/measures also appear in a new DevTools recording. Graphics work
can start during module evaluation; the split is a scheduling boundary, not
mutually exclusive CPU accounting. `launchMs` is post-validation; compare
`totalSinceBootMs` for cached visits, where there is no folder-selection pause.

For a useful comparison, test the original and updated builds on the same device
and browser. Record first import and cached launch as separate scenarios, with
at least five trials each and median plus slowest result. Use production builds,
no artificial throttling for the normal benchmark, and the same scheme, host,
port and browser profile. An intentional cache reset belongs only in cold-import
trials. Keep a separate throttled run for regression diagnosis.

If the previous app used `http://localhost:5173`, stop that dev server before
running preview on the same port:

```sh
npm ci
npm run build
npm run preview -- --port 5173 --strictPort
```

Serve at `/`, not a subdirectory. Using preview's usual different port creates a
different storage origin and will not demonstrate reuse of the existing cache.
This cache is for converted game assets; this change does not add an offline
app-shell installation.

## Verification completed here and remaining limits

The supplied source archive referenced an absent `tools/` directory. This update
restores the helpers needed by the canonical browser build, runtime-asset bridge,
dev movement-trace endpoint, and browser tests. It does not recreate all the
historical architecture-verifier commands listed in the original package.

**Completed:** TypeScript `--noEmit` passed with the environment's 5.8.3 compiler;
77 browser/unit tests ran, with 76 passing and one explicitly skipped because
`tmp_surfs.bin` was absent. Tests cover path/range behavior, cache manifests,
concurrency, partial writes, failure propagation, archive precedence, lossless
PNG output, runtime import graphs, production-plugin emission hooks, and real
launcher control flow with mocked storage/service-worker/engine ports.

Chromium rendered five design states (setup, importing, ready, cached loading,
error), plus a 375 px mobile layout. There was no horizontal overflow or page
JavaScript error; disclosure and reduced-motion behavior were checked. The PNG
screenshots are **design previews with sample counters/times**, not load
measurements or screenshots of the retail game running.

**Not completed here:** installation of the pinned TypeScript 5.9.3 / Vite 6.4.3
dependencies, a real `vite build`, live directory-picker/OPFS/service-worker/GPU
integration, or a retail-asset end-to-end benchmark. This environment cannot
reach the package registry and its managed browser blocks navigations. No retail
IWD archives were supplied. Unit tests and plugin-hook checks do not replace
those remaining build/integration tests. The ZIP is updated source, not a
prebuilt, fully game-validated distribution.

The 100× goal would require roughly 0.36 seconds relative to 36 seconds. Nothing
in this delivery establishes that result; repeat-visit startup and first import
need their own actual measurements.

## Technical references

- Vite's official performance guidance: https://vite.dev/guide/performance
- File System standard (origin-private storage and dedicated-worker synchronous access): https://fs.spec.whatwg.org/
