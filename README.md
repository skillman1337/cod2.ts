# cod2.ts

```text
   C O D 2 . T S                                    FIELD MANUAL / 002
   ─────────────────────────────────────────────────────────────────

   YOUR FILES.
   YOUR BROWSER.

   A fast path to the menu. Game content prepared when needed.

   LOCAL INSTALLATION             EXPERIMENTAL             UNOFFICIAL
```

An experimental **TypeScript / WebGPU** client for your own **Call of Duty 2** installation. Prepare the menu first. Convert the selected map and shared assets when needed. Reuse completed work from this browser's cache.

[![Verify and publish](https://github.com/skillman1337/cod2.ts/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/skillman1337/cod2.ts/actions/workflows/ci.yml)

[Run locally](#run-locally) · [Operations map](docs/OPERATIONS-MAP.md) · [Compatibility](docs/COMPATIBILITY.md) · [Publish to Pages](docs/GITHUB-SETUP.md) · [Support](#support-development)

> **Experimental, not a finished retail-compatible port.** Weapon simulation, GSC execution, animation selection, materials, effects and game modes have known gaps. A passing workflow checks the stated contracts and synthetic fixtures; it does not certify every retail map or online multiplayer compatibility. Read [Compatibility](docs/COMPATIBILITY.md).

## Run locally

Use **Node.js 22.16+** (CI uses Node 22), npm, and a desktop browser exposing WebGPU, local directory access, OPFS, Web Locks and service workers. The launcher checks its prerequisites. Use localhost for development or HTTPS when hosted.

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open the local address printed by Vite. Choose the **installation root** containing `main/*.iwd` and your language archives, such as `D:\Program Files (x86)\Activision\Call of Duty 2`. No executable is needed by the launcher. No retail archives or converted game media ship in this repository.

For a production-mode local run:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 5173 --strictPort
```

Stop the development server before previewing on the same port. Keep the same origin, application base path and browser profile to reuse the same cache. Use a production build, not the Vite development module server, for performance measurements.

## Operation: first frame

```text
FIRST VISIT       your IWDs ── index + frontend ──► main menu
                                                   │
FIRST MAP                                          ▼
                  resolve asset ── convert ──► commit local unit
                                                   │
RETURN VISIT      request same asset ── cache hit ───┘
                                        │
                                        └──► runtime decode / GPU upload
```

**The fastest conversion is the one you do not repeat.** This is a sequence illustration, not a benchmark or a claim of zero runtime preparation.

| Moment | Work performed |
| --- | --- |
| First folder selection | Index archives and read frontend tables, fonts, required menu graphics and menu audio. Do not convert BSP worlds, skeletal models, gameplay animations or gameplay sound payloads before the menu. |
| First map selection | Prepare the selected world's geometry, collision, static props and baked lighting. Resolve shared models, animations, materials, images and sounds by canonical identity. |
| Cache hit | Read committed browser files. Skip repeated archive extraction and conversion for that unit. GPU upload and audio decoding can still be necessary. |
| Uncached content on a later visit | Read the saved source installation. The browser may require permission again; completed cache entries do not need source-folder permission. |

Units are staged, validated, then committed. Interrupted writes do not publish partial replacements. A changed archive index is rejected rather than mixed with an existing installation. Older completed version-5 caches remain recognized at their original root deployment; adding demand loading to a legacy installation can require a rebuild to establish its source binding.

The current launcher requires native directory access; there is no directory-upload fallback in its UI. Clearing site data or browser storage eviction removes cached content. The asset path does not upload game data or write back into your installation. [Loading architecture](docs/LOADING-ARCHITECTURE.md) explains the guarantees and limits.

<details>
<summary><strong>Open the engineering dossier</strong> — source, not decorative arrows</summary>

The [operations map](docs/OPERATIONS-MAP.md) is generated from resolved static calls in the engine inventory. Every displayed function links to its source definition; unresolved relationships are not invented. Its input digest and scope are visible. It is not a runtime trace.

```sh
npm run exec:map
npm run docs:map
npm run verify:docs
```

[Full execution inventory](docs/EXECUTION_MAP.md) · [Module audit](docs/MODULE-AUDIT.md) · [Retail call evidence](docs/RETAIL-LOADING.md) · [Performance protocol](docs/PERFORMANCE.md)

</details>

## Verification is part of the build

Pull requests and pushes to `main` run the committed [workflow](.github/workflows/ci.yml). No retail files, account credentials or payment keys are needed for these checks.

| Lane | Contract |
| --- | --- |
| Source | TypeScript, ownership, frame-loop rules, execution-map freshness, verifier mutation tests, runtime dependencies, synthetic loader tests, tracked-file hygiene and documentation checks. |
| Browser / root | Build for `/`; validate the emitted files; exercise the launcher and synthetic import, worker, IndexedDB, OPFS and service-worker paths in Chromium. |
| Browser / project | Repeat at `/cod2.ts/` to catch domain-root URL assumptions. |
| `Verified` | Stable aggregate status. It fails unless both source and all browser lanes succeed. |
| Pages / opt-in | After verification, rebuild using Pages' actual base, test that exact artifact, upload only `temp/dist/`, then deploy from `main`. |

```sh
npm run verify
npm run verify:docs
python -m pip install -r tools/tests/requirements.txt
python -m playwright install chromium
npm run verify:ui
npm run build:bundle
npm run verify:site
npm run verify:demand-browser -- --dist temp/dist
```

The native browser test uses original synthetic fixtures, not your retail installation. Browser tests are mandatory in CI; missing prerequisites do not silently count as success. [Verification and current limitations](docs/GITHUB-VERIFICATION.md) separates local results from configured CI checks. These checks do not make the known game-compatibility gaps disappear.

## Deploy the code, never the game files

The intended repository is **`skillman1337/cod2.ts`**. Periods are supported in repository names. Once Pages has been enabled and the workflow has succeeded, its expected project URL is `https://skillman1337.github.io/cod2.ts/`.

**Deployment is off by default.** Set Pages' source to **GitHub Actions**, then add the repository Actions variable **`ENABLE_PAGES=true`**. No personal access token is required. The [publishing guide](docs/GITHUB-SETUP.md) covers the first push, branch checks, local subpath testing and funding setup.

The static site distributes the browser client and license notices—not a multiplayer server or retail assets. Each visitor supplies their own files. GitHub Actions never receives their game folder. Project-scoped worker routes and logical cache names prevent accidental collisions with another path, but same-origin paths are **not security isolation**; deploy only trusted code on the same origin.

## Find your way around

| Directory | Responsibility |
| --- | --- |
| `browser/` | Launcher, permissions, archive conversion, workers, local storage and deployment-aware routing. |
| `engine/` | Client/server composition, simulation, UI, sound and WebGPU rendering. |
| `tools/` | Build, verification, generated documentation and optional private native-reference tools. |
| `docs/` | Architecture, compatibility, evidence, performance and publishing instructions. |

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Publication setup](docs/GITHUB-SETUP.md)

## Copyright, license and disclaimer

**Call of Duty 2 and its game content, names, logos and trademarks belong to their respective rights holders.** This is an independent, unofficial project. It is not affiliated with, endorsed by, or sponsored by Activision, Infinity Ward, id Software or their affiliates. No ownership of their intellectual property is claimed.

Use your own lawfully acquired files. The software license grants no rights to retail assets, executables, trademarks or other third-party content. Do not redistribute those files or attach them to issues.

Project code is **GPL-3.0-only**; see [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). Existing notices remain in force. Maintainers must review provenance and redistribution rights before release; a license or disclaimer does not establish those rights. The software is provided without warranty.

## Support development

Help keep the field manual honest: report reproducible bugs, test a documented scenario, improve compatibility, or contribute a focused patch. See [Contributing](CONTRIBUTING.md).

Tips are optional support for independent software development via [Ko-fi](https://ko-fi.com/skillman1337); see [Support](docs/SUPPORT.md). Tips do not purchase Call of Duty 2, retail content, access, or guaranteed features. Playing will not require a payment account or wallet connection.
