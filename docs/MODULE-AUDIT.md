# cod2.ts — Subsystem Ownership & Module Audit

Source: the supplied `cod2-browser-local-install(2).zip`, not a reconstruction from an earlier response. Metrics count physical lines including comments and static import declarations including type imports. Dynamic imports are reported separately. `npm run audit:modules` reproduces the current [JSON inventory](module-audit.json).

A file over 750 lines or 12 static imports is a **review signal**, not proof of an SRP violation. A composition root may legitimately have many imports; a tightly coupled format decoder should not be split arbitrarily to satisfy a number.

## Refactored responsibilities

| Module | Before: lines / imports | After: lines / imports |
| --- | ---: | ---: |
| `browser/decoders/retail-pipeline.ts` | 1904 / 12 | 54 / 5 |
| `browser/main.mjs` | 707 / 7 | 572 / 9 |
| `engine/com/server/sv_main.ts` | 645 / 7 | 615 / 8 |

The importer was a clear SRP violation: one class owned archive reads, texture/audio/model/animation decoding, menu parsing, world conversion and file persistence. It now orchestrates four frontend stages. Cohesive menu, metadata, audio, model, effects and world stages sit behind a per-job context and an on-demand family dispatcher. Skeletal/world/effect conversion modules are dynamically imported after the menu path.

The launcher no longer owns service-worker registration/binding and first-presentable-frame observation; those moved to `launcher-runtime.mjs`. The page broker, source permission resolver, unit cache and HTTP service worker have distinct responsibilities. The launcher has more explicit collaborators than before, despite being smaller; import count was not gamed by hiding dependencies in a barrel.

Selected level manifest/geometry validation and loading moved from server orchestration into `engine/common/level_assets.ts`. Shared bounded asset jobs and URL handling live in `engine/common/asset_jobs.ts`; the server still owns transition state. Sound initialization now separates frontend audio from level-time gameplay catalogs. Existing frame-loop code remains synchronous and ownership verifiers pass.

## Bugs/assumptions addressed

The fixed Toujane import was removed; BSP discovery is generic, including entries without an arena mode list. Model and animation URLs share canonical identity across first/third person. Non-bullet definitions are no longer dropped from the **model catalog**. Weapon menu selection uses the definition table rather than a `_mp` suffix. Character selection no longer silently substitutes an American/M1 Carbine setup. Optional hands/head models are represented explicitly.

Static props accept bare model names, and required decode failures no longer disappear behind a catch. CSV parsing retains quoted fields, continuation rows and explicit zero values. Commented-out script literals are not selected. Menu image keys no longer collide across punctuation. Fog argument ordering is checked against the binary and shader. Archive corruption, path traversal, declared-size mismatch and partially committed units have tests.

**Correction to an initial inspection note:** the supplied latest model decoder was already asynchronous and the caller already awaited it. An async/sync mismatch was not a confirmed bug. The actual static-prop issues addressed were the prefix restriction and silently swallowed failures.

## Large modules that remain

| Module | Lines | Static imports |
| --- | ---: | ---: |
| `engine/com/client/cl_main/scr_menu/ui_menu_runtime.ts` | 1640 | 13 |
| `engine/common/pm.ts` | 1564 | 16 |
| `engine/com/client/screen/scr_draw/rgpu/rgpu_menu/internal/rgpu_menu_text.ts` | 1454 | 15 |
| `engine/com/client/screen/scr_draw/rgpu/rgpu_draw.ts` | 1365 | 8 |
| `engine/com/client/screen/scr_draw/r_webgpu.ts` | 1276 | 11 |
| `browser/decoders/retail-iwi.ts` | 1092 | 0 |
| `engine/com/client/screen/scr_draw/rgpu/internal/rgpu_level.ts` | 1018 | 8 |
| `engine/common/character.ts` | 991 | 5 |
| `engine/com/client/sound/sound.ts` | 833 | 7 |
| `engine/com/client/screen/scr_draw/rgpu/internal/rgpu_character.ts` | 825 | 12 |
| `browser/decoders/retail-bsp.ts` | 819 | 1 |
| `engine/com/client/screen/scr_draw.ts` | 815 | 7 |
| `engine/com/client/cl_main.ts` | 580 | 19 |

`ui_menu_runtime.ts` still mixes script dispatch, profile persistence, focus/input and feeder policy. It is a remaining high-priority SRP split, not declared fixed by the importer work. A suitable next boundary is a pure profile store and command/feeder adapters, preserving menu transition ordering.

`rgpu_menu_text.ts` mixes glyph preparation, layout and GPU atlas/draw batching; separate layout from GPU allocation under the existing package owner. `rgpu_draw.ts` remains a composition/scene-submission hotspot. `r_webgpu.ts` owns hardware lifecycle intentionally; its high coupling needs ownership review, not blind import reduction. `pm.ts`, BSP and IWI decoding contain dense format/math logic; retain cohesive numerical state and tests when extracting algorithms.

This pass did **not** finish every large-module refactor or replace the game simulation. [Compatibility](COMPATIBILITY.md) records bullet-only simulation, partial GSC/animation/FX/material coverage and remaining per-mode assumptions. General loader routing is implemented; full retail compatibility is not.

## Comment policy and evidence

New modules use id-style file banners and function comment separators, describe invariants and retain execution annotations. They do not add invented id Software copyright statements. Retail inspection is recorded as named-call evidence, with inferences and compatibility limitations separated from observed behavior.
