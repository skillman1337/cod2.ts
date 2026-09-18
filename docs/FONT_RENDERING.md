# cod2.ts — Retail Menu Font Investigation

The menu renderer previously used `normalFont` (16 pixels) at every resolution.
Retail `UI_FONT_NORMAL` does not force that atlas font: it selects a font by
physical text scale. This affects both glyph shape and spacing.

## Evidence

Source workspace: `$COD2_RE_WORKSPACE` (optional disassembly workspace).
Source installation: `$COD2_GAME` (or detected retail installation directory).

- `main/iw_06/ui_mp/main.menu` sets the main rows to `UI_FONT_NORMAL` and
  `textscale .4`. Its asset globals include small, normal, big, extra-big,
  bold, and console fonts.
- `main/iw_07/ui/menudefinition.h` defines `UI_FONT_NORMAL` as 1.
- `CoD2MP_s.exe`, `0x531f26–0x531f9a`, registers the font aliases into slots
  `0x18a5110` (big), `0x18a5114` (small), `0x18a5120` (normal), and
  `0x18a5124` (extra-big).
- `0x53198c–0x5319ec` initializes the selection dvars to `.25`, `.4`, `.55`.
- `0x44bb6a–0x44bb74` stores screen height multiplied by the float32 value
  `1/480` into `0xbdcc0c`.
- `0x532380–0x532428` selects the font. For ID 1, multiply text scale by
  `0xbdcc0c`, round to float32, and compare with the float32 thresholds:

| Physical scale | Font | Native font height |
| --- | --- | --- |
| ≤ .25 | smallFont | 12 |
| > .25 and < .4 | normalFont | 16 |
| ≥ .4 and < .55 | bigFont | 24 |
| ≥ .55 | extraBigFont | 32 |

- `gfx_d3d_mp_x86_s.dll`, `0x1000bf60–0x1000bf71`, normalizes the requested
  scale by multiplying by 48 and dividing by the selected font's height.
  This confirms the existing normalization factor; it was the selected
  glyph table that was missing.
- The existing normal-font table and BC3 atlas match their retail sources.
  All four extracted font tables use the same existing `gamefonts` atlas.

At text scale .4, this selects bigFont at height 480 or 600, and extraBigFont
at height 720 or 1080. Device pixels, including browser DPR, determine height.

## Change and validation

`tools/extract_retail_fonts.py` extracts the four tables from `iw_00.iwd`.
`assets/fonts/provenance.json` records source-entry and output hashes.
No bitmap pixels or font UV corrections were changed.

`tools/verify_retail_font_evidence.py` compares the selector's recorded assembly
instruction bytes with the original executable, freezes the renderer hash, and
emulates the original x86 selector over 84 predefined screen/scale cases. Its
fixture records binary, manifest, disassembly, function-byte, and candidate hashes.

The lifecycle suite consumes that fixture to check actual GPU uniform uploads
for glyph bearings, dimensions, UVs, and advances. Four mutations must fail:
missing small font, wrong inclusive boundary, ignored resolution, and the old
fixed-normal-font behavior. These checks run under `npm run build`.

Reproduce the optional native evidence step with Python `pefile` and `unicorn`:

```powershell
python tools/assets/extract_retail_fonts.py "$env:COD2_GAME/main"
python tools/verify/verify_retail_font_evidence.py "$env:COD2_RE_WORKSPACE" "$env:COD2_GAME/CoD2MP_s.exe"
```

## Limits

Status: bounded native selector validation and tested TypeScript integration.
There is no exact AutoDFS/IR proof available in this session, and this is not a
claim of component or application equivalence. The regression verifies emitted
draw data using mock WebGPU, not final hardware pixels. Native shadow rasterization,
pixel snapping, gamma, and the existing half-texel correction have not been
established as equivalent. Explicit bold/console overrides and localized font
atlases remain outside the currently implemented normal-font menu path.
