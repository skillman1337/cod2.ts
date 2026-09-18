# cod2.ts — Retail Reference & Loading Investigation

Reference: `cod2mp_1.3_i386`, Mach-O 32-bit i386, 20,211,172 bytes. SHA-256 and named direct calls are recorded in [retail-symbol-evidence.json](retail-symbol-evidence.json). Inspection was static; the executable was not run. No executable, instruction stream or raw disassembly is distributed.

## Observed boundaries

| Native function | Direct-call evidence | Design implication |
| --- | --- | --- |
| `FS_AddIwdFilesForGameDirectory` | `unzOpen`, archive metadata and search-path construction. | Mount/index containers separately from decoding every payload. |
| `FS_ReadFile` | Open/read and temporary allocation functions. | Named filesystem reads resolve data when a consumer requests it. |
| `UI_Init` / `UI_LoadMenus` | UI sound aliases, arenas, menu parsing and frontend asset registration. | Frontend initialization is a distinct phase, not a selected world import. |
| `SV_SpawnServer` | Loading transition, BSP and collision loading, sound aliases and game-program initialization. | Level-dependent work belongs at a selected-map transition. |
| `CG_Init` / `CG_RegisterGraphics` / `CG_RegisterSounds` | Map, graphics, animation and sound registration. | Retail performs substantial **level registration/precache**, not only per-draw demand loading. |
| `CG_RegisterWeapon` | Model/material/effect registration and animation precache. | Weapon definitions and dependencies guide registration. |
| `XModelPrecache` / `XAnimPrecache` | `Hunk_FindDataForFile`, named loader, `Hunk_SetDataForFile`. | Cache by named asset identity; do not reconvert the same model per consumer. |
| `R_LoadWorld` | Geometry/static-model/image registration. | World loading references shared asset families. |

The browser design is an **adaptation of these boundaries**, not a claim that native CoD2 uses service workers, persistent conversion units, or fully lazy per-frame loading. The binary provides evidence of call structure and names; it does not provide an exhaustive behavioral specification, a performance profile, or complete retail payload coverage.

## Metadata cross-checks

`R_ParseSunLight` and `R_InterpretSunLightParseParamsIntoLights` expose angle conversion, color normalization and separate ambient/diffuse terms. The browser uses the native angle-vector convention without a map-specific hemisphere flip; its directional lighting remains a simplified renderer contract.

The binary's diagnostic usage text identifies `setExpFog(density, red, green, blue, transition time)`. The browser stores the first four values as density/RGB to match the shader's `.x` / `.yzw` layout. It does not insert an invented starting-distance argument.

## Reproduce locally

```sh
python tools/debug/inspect_retail_symbols.py /private/path/cod2mp_1.3_i386 \
  --objdump llvm-objdump --output temp/private-retail-evidence.json
```

The script requires LLVM's Mach-O-capable `llvm-objdump`. It emits only function identities and direct-call summaries. Keep the reference binary and raw analysis private and outside the repository.
