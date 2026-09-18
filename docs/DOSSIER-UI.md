# cod2.ts — WWII Dossier UI Implementation

## Scope

This is a source update to `cod2-minimal-fast-loader.zip`, not a return to the
older original ZIP. It implements the last approved concept,
`cod2_browser_port_wwii_dossier_ui.png`, in the actual installer. The previous
cache and startup improvements remain in place. No claim of a new speedup is
made by this visual revision.

## Design

The launcher is now a single black / charcoal dossier with a large typewriter
headline, fine borders, a faint ruined-town backdrop and lower-right map detail.
Warm paper color is confined to the primary button and the progress fill. The
olive wash, oversized game wordmark, contour graphic, step breadcrumb and
animated signal bars have been removed.

The tiny local background images are text-free crops of the approved concept;
all headings, controls, status, counters and progress remain actual HTML/CSS.
They total 3,662 bytes. No fonts or UI framework were added. Typography uses
system fonts, so exact letterforms vary by OS. Nonfunctional OS window controls
from the concept are deliberately not presented as clickable controls.

## Real states, not a frozen concept

| State | Primary action / behavior | Status rail |
| --- | --- | --- |
| No completed cache | Browse for game folder | Awaiting game folder; `main/*.iwd`; read-only / no uploads |
| Remembered folder, no cache | Use saved game folder | Explains that the cache needs preparation |
| Import | Disabled preparation button; Cancel while worker is active | Named stage, completed stages, actual files and bytes cached, current full path, elapsed time |
| Cached return | Auto-launch; no folder request | Cache check, JSON tables read, engine / graphics progress |
| `?assets=manage` | Launch from cache | Local cache ready; Rebuild cache only when a saved folder exists |
| Error | Available recovery action retained | Attention required; inline error; Import log available |
| Menu frame ready | Dossier hidden | Existing engine handoff and Local files button preserved |

“Browse once” is explicitly explained by the two-line main copy. Cached assets
are still browser-profile / origin specific, and storage eviction can require
another import. The new interface does not force a cache rebuild or change the
version-5 storage format. No retail game files are included in the source.

The two secondary disclosures work inline. **Import log** displays up to 160
recent messages as escaped text and avoids pulling readers back to the bottom
when they have scrolled upward. **Local files** contains the correct Windows
example path, read-only / storage caveats, change-folder and deletion controls.
Rebuild remains a small toolbar action when appropriate. The existing delete
confirmation is unchanged.

## Truthful loading feedback

`main.mjs` now passes structured `done`, `total` and `unit` values for cache
validation and JSON loading. Import progress uses the pipeline's eleven real
stage notifications and its file/byte task events. Graphics activity retains
the existing resource observer and ready signal.

`progressValue()` bounds known work and keeps unknown totals indeterminate.
The segmented strip animates a lightweight CSS transform. Import stages have
unequal costs; its accessible label says stage progress is not time remaining.
There is no invented ETA or total output size. Long current paths wrap instead
of hiding their filenames behind ellipses.

Stage announcements are coalesced; rapidly changing paths and byte counts do not
flood a screen reader. Re-entering cache mode resets old import counters and
pending status announcements. Clock timers stop on success, failure and cancel.
Focus moves to an available control when a previous action disappears. Escape
closes a focused disclosure and returns focus to its trigger. Reduced-motion
and forced-colors preferences are handled.

## Files changed

- `browser/setup-view.mjs`: dossier DOM, state presentation, disclosures,
  structured progress, lifecycle / focus handling.
- `browser/setup.css`: scoped black theme, icons, segmented loader, responsive
  layouts, reduced motion and forced colors.
- `browser/main.mjs`: human-readable import stage labels and structured file /
  table counters; corrected error text pointing to **Import log**.
- `browser/art/*`: optional tiny background art and provenance.
- `browser/preview.html`, `browser/preview.mjs`: isolated interactive preview.
- `tools/export_setup_preview.mjs`: exports the exact production view and CSS
  with preview fixtures as one offline HTML; no duplicated mock layout.
- `tools/test_setup_ui.py`, `browser/tests/setup-progress.test.mjs`: UI and
  progress tests; `package.json` gains optional preview / UI-test commands.

The conversion pipeline, cache version, service worker, local permissions,
engine, asset activation rules and previous performance optimizations were not
changed in this revision. No production or development npm dependency was added.

## Run

```sh
npm ci
npm run build
npm run preview -- --port 5173 --strictPort
```

Stop the existing server before previewing on port 5173. Keep the same scheme,
hostname, port and browser profile to reuse the previous local cache. The actual
installer must be served at `/` over HTTPS or localhost.

During development, open `/browser/preview.html`. Optional states:
`?state=loading`, `?state=cache`, `?state=ready`, `?state=saved`, `?state=error`.
Click Browse for game folder to walk through the simulated import and cached
handoff. The preview is labeled, uses sample data, never opens a real folder
picker and never touches real game files or the production cache.

```sh
npm run preview:ui
# Writes temp/cod2-dossier-preview.html, which can be opened directly offline.

npm run typecheck
npm run verify:browser
npm run verify:ui
# Optional UI test: Python Playwright and a Chromium executable are required.
```

## Verification on this delivery

**Passed:** TypeScript checking with the environment's installed 5.8.3 compiler;
79 Node tests, with one optional `tmp_surfs.bin` fixture test skipped; and all 15
automated real Chromium UI tests. The UI suite includes 42 combinations of six
states and seven widths (320, 390, 768, 1024, 1366, 1448, 1920 pixels), keyboard
controls, counters, error / cancel behavior, timer cleanup, escaped bounded
logs, reduced motion, forced colors and the full interactive demo. The normal
1366 × 768 desktop states fit without vertical scrolling; small displays and
expanded disclosures remain scrollable. Screenshots were also visually reviewed.

**Not verified:** a full production Vite build, the pinned TypeScript 5.9.3
compiler, or a real retail-game import / cache-to-menu run. `npm ci` failed with
`EAI_AGAIN` resolving the npm registry; the managed browser restricts navigation
and live filesystem access; retail IWD archives were not provided. Chromium UI
tests rendered the self-contained export directly. Existing launcher tests use
mocked storage / service-worker / engine ports. Those are useful checks, not a
substitute for production integration on the user's machine.

The ZIP is source, not a prebuilt or fully retail-game-validated distribution.
The screenshots / preview timings are sample data, not performance results.
