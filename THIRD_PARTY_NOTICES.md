# Third-party notices and provenance

## Code license

`LICENSE` contains GNU GPL version 3. The chosen project license identifier is `GPL-3.0-only`. This applies only to code that the contributors have authority to license; it does not override existing notices or license retail files. No claim of authorship is made for pre-existing code supplied with this project. Maintainers must audit that code's provenance before public release.

## IWI wavelet decoder

`tools/vendor/iwi/decoder_core.inc` adapts the OpenAssetTools wavelet decoder by **Laupetin and contributors**. The browser implementation in `browser/decoders/retail-iwi.ts` follows that decoder's adaptation and must not be presented as MIT-only code. Retain `tools/vendor/iwi/LICENSE` and `tools/vendor/iwi/README.md` and comply with the upstream GPL terms.

Upstream: https://github.com/Laupetin/OpenAssetTools/tree/main/src/ObjImage/Image

License: https://github.com/Laupetin/OpenAssetTools/blob/main/LICENSE

## WebGPU type declarations

`browser/types/third_party/webgpu-types-0.1.71/` is the vendored WebGPU type declaration package. Its original BSD-style license is retained in that directory. These declarations are not retail game data.

## id-style source comments

File banners and function comment blocks follow the style illustrated by id Software's public engine repositories. This is a formatting convention, not a statement that id Software authored or endorsed this port. Do not add id Software copyright claims to new files merely because they use that style.

Style reference: https://github.com/id-Software/Quake-III-Arena/blob/master/code/qcommon/files.c

## Compatibility data and reference research

The source contains numeric compatibility facts, format constants, semantic animation identifiers and a compact functional lightmap-weight lookup. The lookup in `retail-constants.ts` / `extract_lightmap_weights.py` was retained from the supplied project and needs the same provenance review as other reference-derived material. It is not a claim that a retail-derived table can be licensed solely by adding this notice.

The previous compressed default-variable blob included native instruction bytes and reference addresses. It has been replaced with readable name/type/default/bounds/flags/choices data in `retail-defaults.ts`. `docs/retail-symbol-evidence.json` contains function names, addresses, direct-call names and a reference digest, not executable code. The user-supplied Mach-O, raw disassembly, extracted media and private reference captures are not included in releases.

## Retail intellectual property

Call of Duty 2, game archives, executables, fonts, textures, audio, models, animations, maps, scripts, names, logos and trademarks remain the property of their respective rights holders. The repository's code license grants no rights in that content. Activision, Infinity Ward and id Software are not sponsors or endorsers of this independent project. Users provide their own lawfully acquired installation. No actual font files are distributed.

Synthetic test fixtures are generated from small original values; they are not copied retail assets. The font fixture is a generated empty format record, not a retail font or usable typeface.
