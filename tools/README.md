# cod2.ts — Developer Tooling

Developer tooling for local asset conversion, native-reference investigation, browser builds, and regression checks. The engine itself is not changed by this cleanup.

## Start here

Run these from the project root, or give the launcher an absolute path from another directory:

```sh
python tools/run.py list
node tools/run.mjs list
python tools/run.py info inspect_weapon_flash_fields
python tools/run.py assets/setup_assets --help
```

Commands run in the project root. Listing and `info` do not import or execute the underlying scripts. Direct canonical paths also work. The Python launcher needs Python 3.10 or later; use the Node version supported by the parent project. Install the project's npm dependencies for TypeScript-based tooling.

`catalog.json` is the command index. It provides paths, original-name aliases, prerequisites, warnings, and any required Node flags. Many retained legacy inspectors have module-level work: do not import them just to discover their options. Inspect their source or use `info` first.

## Layout

| Folder | Responsibility |
|---|---|
| `assets/` | IWD/retail exporters and local asset setup. This is **source code**, not bundled game assets. |
| `inspect/assets/` | Asset, material, model, animation, map, and image investigations. |
| `inspect/native/` | Version-specific disassembly, emulation, and reference-evidence probes. |
| `maintenance/` | Refresh already-extracted collision or material metadata. These commands write output. |
| `build/` | Asset-free Vite integration, local-only module builder, and source packager. |
| `debug/` | Movement trace receiver, replay, and recording analysis. |
| `verify/` | Ownership, execution-map, architecture, and reference-evidence checks. |
| `tests/tooling/` | Tool infrastructure and build tests. Some retained tests require the full project. |
| `tests/runtime/` | Engine/runtime regressions; not all are asset-free. |
| `tests/native/` | Native-reference parity regressions, typically using generated evidence or assets. |
| `lib/` | Shared parsers, decoders, paths, archive/image helpers, and JS analysis code. |
| `fixtures/` | Retained evidence fixtures; original bytes unchanged. |
| `vendor/` | Retained third-party decoder source and licenses; original bytes unchanged. |

## Common workflows

### Local asset setup

```sh
python -m pip install -r tools/requirements-assets.txt
python tools/run.py setup_assets --help
```

Use the setup script's existing installation/version checks. This cleanup does not expand the set of supported game binaries. The browser importer remains a separate player-facing workflow; players do not run these developer commands.

### Inspect weapon fields

```sh
python tools/run.py inspect/native/weapon_fields --preset general
python tools/run.py inspect/native/weapon_fields --preset flash
python tools/run.py inspect/native/weapon_fields --preset transition
python tools/run.py inspect/native/weapon_fields --preset all --exe "/path/to/supported/CoD2MP_s.exe"
```

The original `inspect_weapon_fields`, `inspect_weapon_flash_fields`, and `inspect_weapon_transition_fields` aliases choose their original filters. `--contains` can override a preset. Table addresses and interpretation are unchanged. An arbitrary EXE version is not a supported substitute.

### Inspect an animation

```sh
python tools/run.py inspect/assets/xanim ANIMATION_NAME --main "/path/to/Call of Duty 2/main"
```

This frontend uses `lib/retail_xanim.py`, just like the exporters, instead of a second partial parser. Output includes root delta and quaternion flip handling.

### Native evidence

```sh
python -m pip install -r tools/requirements-native.txt
python tools/run.py info inspect_retail_lean
```

Shared path overrides live in `lib/native_paths.py`: `COD2_NATIVE_EXE`, `COD2_NATIVE_DLL`, `COD2_NATIVE_BACKUP`, and `COD2_RE_WORKSPACE`. Existing `COD2_EXE` / `COD2_DLL` and `COD2_GAME` remain supported. Defaults resolve directly to the game installation binaries. Set the environment **before** starting a process. Changing locations does not change hard-coded instruction addresses, structure layouts, or version support. Inspect each probe's preconditions; not every legacy probe hashes its input.

The ordinary extraction paths remain in `lib/retail_paths.py`. The current pure-code model decoder was retained, not replaced with an older DLL-based decoder.

### Builds and deployment

`build/browser_assets_plugin.mjs` is the asset-free Vite plugin, imported directly by `vite.config.ts`. It reads exporter source from `tools/assets/` while keeping the browser's flat virtual filenames unchanged. Shared Python helpers are included in the hashed runtime source manifest. **Do not rewrite virtual `/cod2/tools/extract_*.py` names in the browser pipeline just because checkout paths moved.**

`build/build_browser_modules.mjs` is retained because existing tests and local workflows use it. **It copies local retail assets; do not deploy that output as the asset-free website.** The cleanup does not change a project's selected npm build strategy. Review `package.json` and deploy only the output from your asset-free Vite configuration.

```sh
python tools/run.py build/package_source /path/outside/project/source.zip
```

The source packager includes `tools/assets/` and browser source, but excludes root-level `assets/`, `public/`, `dist/`, caches, symlinks, and native binary file extensions. Its manifest hashes the bytes actually placed in the ZIP. This is a source-file selection rule, not a legal audit of arbitrary content added to source files.

## Reorganization checks

```sh
node tools/run.mjs tests/tooling/test_reorganization
node tools/run.mjs test_movement_trace_server
```

Node reorganization tests require the project's TypeScript dependency; the launcher supplies `--experimental-vm-modules`. These checks use synthetic inputs and local HTTP test servers, not a running browser game or retail executable. Other retained tests have their original project/asset requirements.
