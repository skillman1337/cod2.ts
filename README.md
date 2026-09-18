# cod2.ts

**Your installation. A fast path to the menu. Assets cached when needed.**

An experimental TypeScript / WebGPU client for locally installed **Call of Duty 2**. Choose your game folder once, prepare the frontend, and convert gameplay content on demand in your browser. No game archives, textures, models, sounds, fonts, or executable are distributed with this repository.

> **Status: experimental.** The asset loader is general-purpose, but this is not yet a complete retail-compatible game. Projectile simulation, GSC execution, animation selection, materials and game modes have known gaps. Read [Compatibility](docs/COMPATIBILITY.md) before testing or presenting it as a finished port.

## Start locally

Use Node.js **22.16 or newer**, npm, and a desktop browser that exposes WebGPU, File System Access, OPFS, Web Locks and service workers. The launcher checks capabilities. Use `localhost` for development or HTTPS in deployment. Keep the same hostname, port and browser profile to retain access to the same browser cache.

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open the local address printed by Vite. Select the **installation root**, for example `D:\Program Files (x86)\Activision\Call of Duty 2`, containing `main/*.iwd` and your language archives. You do not need to supply an executable to the launcher.

For a production-mode local test:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 5173 --strictPort
```

Stop the development server before previewing on that port. Deploy the contents of **`temp/dist/`** at an origin's root; arbitrary subpath hosting is not implemented. Use the production build for timings, not Vite's development module server.

## How loading works

| Moment | Work performed |
| --- | --- |
| First folder selection | Index IWD central directories; read frontend definitions, fonts, required menu graphics and menu sounds. Do **not** convert BSP worlds, skeletal models, gameplay animations or gameplay sound payloads. |
| First map selection | Convert the requested map's geometry, collision, static props and baked lighting. Materials, images, models, animations and sounds are requested by canonical asset name and cached in separate units. |
| Return to cached content | Read committed browser files. Skip archive extraction and conversion for cache hits. GPU upload and audio decoding may still be necessary. |
| First use of uncached content later | Read the saved installation. A browser may require **Allow read access** again; completed cache entries do not need source-folder permission. |

The cache uses completed generations and independently committed units. Partial writes are not published. A changed archive index is rejected instead of silently mixing installations. Old version-5 completed caches remain usable; to demand-load content not present in a legacy cache, rebuild once to establish the new source binding.

A fallback directory upload supplies files for the current session but cannot persist a native directory handle. After reload, newly requested uncached content may require selecting the folder again. Clearing site data or storage eviction removes cached content. There are no asset uploads or writes to your installation in this code path.

## Development

```sh
npm run verify                 # source, architecture, runtime and synthetic loader checks
npm run audit:modules          # module size/import inventory as JSON
npm run exec:map               # update execution inventory after call-graph changes
npm run verify:demand-browser  # optional native browser cache integration; needs Python Playwright
npm run verify:ui              # optional launcher DOM/layout tests
```

The default verification path needs **no retail assets**. Legacy offline-extraction / native-comparison tools are separate; they are not the production browser build. See [Verification](docs/VERIFICATION.md) for prerequisites and results, including what was not verified in this environment.

| Directory | Responsibility |
| --- | --- |
| `browser/` | Launcher, directory permissions, workers, local storage and retail format conversion. |
| `engine/` | Client/server composition, simulation, UI, sound and WebGPU rendering. |
| `tools/` | Build tooling, verification, synthetic tests and optional private reference inspection. |
| `docs/` | Loading design, module audit, compatibility limits, measurements and native call evidence. |

[Loading architecture](docs/LOADING-ARCHITECTURE.md) · [Audit and refactor](docs/MODULE-AUDIT.md) · [Retail evidence](docs/RETAIL-LOADING.md) · [Performance protocol](docs/PERFORMANCE.md) · [Contributing](CONTRIBUTING.md)

## Copyright, license and disclaimer

**Call of Duty 2 and all associated game content, names, logos and trademarks belong to their respective rights holders.** This is an independent, unofficial project and is not affiliated with, endorsed by, or sponsored by Activision, Infinity Ward, id Software, or their affiliates. No ownership of their intellectual property is claimed.

You must obtain and use your own lawfully acquired game files. The software license does not grant any license to retail assets, executables, trademarks or third-party content. Do not commit, redistribute, or attach those files to issues.

The project code license is **GPL-3.0-only**; see [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). Existing third-party notices remain in force. Maintainers must confirm provenance and redistribution rights before a public release; adding a license or disclaimer does not establish those rights. This software is provided without warranty.
