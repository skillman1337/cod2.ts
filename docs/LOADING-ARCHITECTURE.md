# cod2.ts — Menu-First Loading Architecture

## The boundary

The startup contract is **frontend first, selected gameplay content later**. `RetailPipeline.run()` now owns four bootstrap stages: font tables, menu/definition metadata, required menu graphics/audio, and configuration. It does not own a world, weapon meshes, character meshes, gameplay animations or sound payload extraction.

Archive enumeration reads central-directory records, not every compressed payload. Some small global metadata is still read before the menu: weapon definitions, menu includes and providers. Menu material metadata is indexed, while images not in the small frontend set are converted when their URL is requested. There is no automatic full-install warm-up after opening the menu.

## Request path

```text
engine fetch of a named asset
  -> local-assets service worker
  -> completed bootstrap generation / completed cache unit?
       hit  -> local HTTP response (including HEAD/ranges)
       miss -> matching page broker -> dedicated demand worker
                 -> shared install lock + exclusive unit lock
                 -> source binding / archive index validation
                 -> family-specific conversion
                 -> staged OPFS files + completion marker
                 -> publish immutable directory pointer in IndexedDB
                 -> local HTTP response
```

`browser/asset-routing.mjs` is the identity contract. `retail-asset-compiler.ts` dispatches by **family**, not by known map or weapon names. `retail-context.ts` owns per-job output and diagnostics; stages own conversion. The service worker never converts assets and does not download missing retail content from a server.

## Unit boundaries

| Unit | Contents and dependencies |
| --- | --- |
| `map/<name>` | Selected BSP geometry, collision, static-prop geometry, baked lighting, manifest and map metadata. References external textures by shared URL. |
| `model/<name>` | Decoded named model and its required model-parts/surface data. First/third-person aliases resolve to the same canonical cache unit. |
| `animation/<name>` | Decoded named XAnim; no global animation payload sweep. |
| `material/<name>` | Parsed material metadata and references to shared image identities. |
| image / normal / cubemap face | One converted image variant. Names preserve paths and punctuation; color and normal variants are distinct. |
| sound path | One original compressed audio payload copied unchanged to local storage. AudioBuffer decoding remains in the engine. |
| audio / viewmodel / character / effect catalog | Small definition units requested after the menu. Audio alias enumeration is metadata-only. Effect registration remains broader than individual weapon selection; see limitations. |

Maps are discovered from arena metadata and mounted `maps/mp/*.d3dbsp` paths. A missing arena mode list no longer hides an otherwise discovered BSP from the UI. This does **not** prove that an unknown map supports every game mode.

## Consistency, permissions and failure

A completed bootstrap is a generation. The new layout is `menu-first-v1`, with compiler revision in unit identity. A source binding records ordered archive names, sizes, timestamps and a central-directory digest. Cold loading refuses a changed index; already completed units remain readable. This is not a cryptographic proof of every archive payload: individual reads also check CRC and decompressed size.

Each unit is written under a new UUID, checked for declared file sizes, marked complete, then published with one IndexedDB pointer. A failed conversion, quota error, cancellation before publication or failed pointer write does not replace the old pointer. A terminated worker can leave an unreachable staging directory; automatic crash-orphan collection is not implemented yet. Removing the installation clears the generation tree.

Cross-tab Web Locks coalesce the same unit and exclude simultaneous import/deletion. The per-page worker queue runs one conversion job at a time to bound working memory; renderer fetch/decode fan-out is bounded separately. Whole selected maps still compile as map-sized jobs. This is **not** spatial cell streaming or a general predictive scheduler.

Warm requests read browser storage without reopening the retail folder. Cold requests after a new visit may need a user gesture to renew read permission. The page broker owns that dialog; the service worker cannot prompt. The low-level importer can accept session file snapshots, but the current launcher exposes native directory access only; it has no upload-fallback UI. Session snapshots are not persistent directory permission. The interface must not promise that all future uncached assets are accessible forever after a single click.

## Engine integration

`engine/common/level_assets.ts` validates selected manifest/geometry data and loads map dependencies; server state keeps the transition ticket. Stable mantle tables are hydrated at map entry, not replaced underneath existing imports. Material descriptors, models, animations and images are fetched by name. Menu sound initialization is separate from map-time alias catalog loading and bounded movement-sound prewarm.

The renderer still has registration-time work, GPU upload, pipeline creation and its existing entity/simulation limitations. Cache hits eliminate conversion, not those costs. Detailed demand-worker events are available as `cod2:asset-status`; the original black dossier setup UI and the engine's level progress UI are retained.

## Compatibility with previous cache versions

Completed version-5 base caches remain recognized. New code does not force their deletion. Because an old cache lacks the new source-index binding and UI-image source table, content outside that cache can require a one-time rebuild. The rebuild creates the new menu-first bootstrap rather than eagerly converting the entire game.
