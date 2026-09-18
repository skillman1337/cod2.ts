> **Historical document.** Superseded for loading and release status by [LOADING-ARCHITECTURE.md](LOADING-ARCHITECTURE.md), [MODULE-AUDIT.md](MODULE-AUDIT.md) and [VERIFICATION.md](VERIFICATION.md). Original measurements/claims below describe an earlier revision.

# cod2.ts — Browser-Local Installation Loader

## Architecture and Scope

**cod2.ts** implements a pure-TypeScript browser-native asset virtualization loader and WebGPU engine port for Call of Duty 2. Players bring their own game files (from retail discs, digital installs, or `.iwd` archives), which are parsed and extracted locally within the browser.

### Key Highlights
- **100% Native TypeScript**: Zero Pyodide or Python runtime dependencies. All IWD (ZIP) decompression, binary decoding (BSP maps, XModels, XAnims, IWI textures, fonts, sounds, menus, EFX graphs), and asset orchestration execute in native TypeScript inside Web Workers.
- **Zero WebAssembly Emulators**: No Unicorn, no Capstone, and no binary emulation. Asset formats are decoded directly from specification and reverse-engineered binary layouts.
- **Universal Archive Compatibility**: Does not mandate fixed binary SHA-256 hashes or specific game executable versions. Works directly with retail `.iwd` archives from the game's `main/` directory.
- **Client-Side Asset Virtualization**: Proprietary assets are never hosted or bundled into application code. Converted assets are stored locally in the browser's Origin Private File System (OPFS) and IndexedDB, then served to the engine via a dedicated Service Worker (`local-assets.sw.js`).
- **WebGPU Engine**: Renders maps, skeletal character models, animated viewmodels, muzzle flashes, and UI widgets through modern WebGPU pipelines.

---

## Player Workflow

1. Open the website in a desktop Chromium-based browser (Chrome, Edge, Opera, Brave).
2. Choose your Call of Duty 2 installation directory or archive folder containing the `main/` directory (e.g., `main/iw_00.iwd` through `main/iw_15.iwd`).
3. The loader requests **read-only** permission to extract the necessary game assets (maps, models, animations, audio, and UI definitions).
4. Extracted assets are cached in local browser storage (OPFS).
5. Subsequent visits instantly load from the local cache without requiring re-import.

---

## Technical Pipeline

1. **Directory Selection & Discovery (`browser/install.mjs`)**:
   - Queries directory handles using the File System Access API.
   - Discovers and indexes all available `.iwd` archives.
2. **Dedicated Import Worker (`browser/import.worker.js`)**:
   - Spawns a background Web Worker to handle extraction without blocking UI rendering.
   - Decompresses archive entries on demand using `DecompressionStream`.
3. **Pure TypeScript Decoders (`browser/decoders/retail-*.ts`)**:
   - `retail-zip.ts`: Central directory parsing and streaming DEFLATE decompression.
   - `retail-bsp.ts`: IBSP v4 world geometry, collision brushes, terrain meshes, lightmaps, and 3D lightgrid sampling.
   - `retail-model.ts`: CoD2 XModel/XModelSurfs skeletal mesh unpacking and vertex skinning.
   - `retail-xanim.ts`: CoD2 skeletal animation channel decoding and pose sampling.
   - `retail-iwi.ts` & `retail-png.ts`: DXT1/DXT5/RGBA texture decoding and PNG compression.
   - `retail-menus.ts` & `retail-preprocessor.ts`: C-style preprocessor (`#include`, `#define`, comments) and CoD2 `.menu` syntax parsing.
   - `retail-pipeline.ts`: Master pipeline orchestrating asset extraction for maps (e.g. `mp_toujane`), player models, weapons, sounds, and visual effects (`.efx`).
4. **Local Asset Virtualization (`browser/local-assets.sw.mjs`)**:
   - Service Worker intercepts requests for `/assets/*`, `/maps/*`, `/viewmodels/*`, `/characters/*`, `/sound/*`, and `/weaponfx/*`.
   - Streams requested assets directly from OPFS slices to the engine with byte-range support.

---

## Build and Deployment

### Site Operator Setup
Only standard Node.js is required:

```sh
npm ci
npm run typecheck
npm run verify:browser
npm run build
```

The output site will be built to `temp/dist/` (or configured `outDir`), ready to serve over HTTPS.

### Distribution & Licensing
- No copyrighted retail game binaries, archives, audio files, textures, or geometry are bundled into the site distribution.
- All code delivered to the client is pure application source and decoders.
- Third-party decoder components (such as the OpenAssetTools wavelet decoder in `tools/vendor/iwi/`) retain their respective upstream GPL/permissive licenses.
