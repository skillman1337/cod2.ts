# cod2.ts — Compatibility & Retail Parity

This release removes the fixed-map loading boundary. It is not certified to run every retail map, weapon, animation, material, localized install or mod. The validation archive in the automated tests contains **original empty/small format fixtures**, not a retail install. Two synthetic map identities passing is evidence for dispatch/cache isolation, not all-map gameplay coverage.

## Implemented and remaining scope

| Area | Implemented | Remaining limitation / validation needed |
| --- | --- | --- |
| Archive search | Ordered IWD central-directory indexing; case-insensitive names; later archives override earlier entries; CRC/size checks. | Base `main/*.iwd` mounting only. Not full native `fs_game`, loose-file, pure-server, language-priority or mod search-path semantics. ZIP64, encrypted and split archives explicitly rejected. |
| Map discovery | Arena records plus any mounted multiplayer BSP basename. No Toujane gate. | A BSP without mode metadata is visible, not certified for all modes. Duplicate-name override behavior needs real patch/language testing. |
| Localization | Mounted localized archives can be indexed. | The current menu string reader still selects `LANG_ENGLISH` and uses Windows-1252; full language selection/encoding support is not implemented. |
| World conversion | IBSP v4 geometry, collision, static props, baked lighting and referenced textures. | No full mover/entity/GSC gameplay, portal/PVS streaming or all-map retail validation. Static model conversion failures now surface instead of disappearing. |
| Atmosphere/factions | Worldspawn sun/bounds and comment-stripped literal map-script faction/fog values. | Literal reader is not a GSC interpreter; includes, expressions and dynamic assignments may be unresolved. No unrelated map's lighting/faction fallback. Ambient/diffuse material mixing is not full native parity. |
| Models | Named model units, model-parts/surfaces, shared first/third-person cache identity. Non-bullet definitions remain in the viewmodel catalog; hands and head can be absent. | Existing decoder targets model version 20 and top LOD; complete LOD, model attachment and animation-tree behavior are not established. |
| Animations | Generic named XAnim requests, version-14 decoder, map-time mantle conversion. | Character renderer still uses a semantic animation mapping. Full native animscript/animation-tree selection, all notifies, blending and every weapon animation combination remain incomplete. |
| Weapons | Definition-driven models/effects; menu selection no longer requires a `_mp` suffix; no default M1 Carbine substitution. | **`Weapon_Update` still handles `weaponType === 'bullet'`.** Rendering a projectile weapon's model does not implement grenade/rocket simulation, damage or inventory parity. Do not advertise all weapons as playable. |
| Audio | All alias-file metadata enumerated on level entry; quoted CSV, continuation rows and explicit zero values preserved. Individual sound files loaded on request. | Full native sound channels/spatialization/alias rules need validation. Ambient map selection reads literal calls only. Already warmed sound bytes still require runtime decode; not all effects trigger every alias. |
| Images/materials | Shared punctuation-safe image paths; DXT1/3/5, supported uncompressed/wavelet images, cubemap faces and normal-map conversion. | Finite decoder limits, technique/stage/state subset, transparency/decal/normal fidelity need a real content matrix. Unsupported cases are not made correct by successful caching. |
| Effects | Weapon effect fields and referenced subeffects parsed into shared image URLs. | Existing effect parser/rendering is partial; effect catalog and renderer registration can still inspect/preload more than the selected weapon. |
| Gameplay/network | Existing local client/server simulation and menu flow retained. | Not a replacement for the retail game VM, all game modes, vehicles, movers, scripts or compatible online multiplayer protocol. Spawn handling still has DM/TDM-specific logic. |

## Required retail acceptance matrix

Use your own private installation, not a public fixture upload. Enumerate every discovered BSP, weapon definition, model and animation reference. For each map test first load, second load, map switch, faction selection, geometry/collision, foliage/alpha/decal materials, sky/lightmap/fog, ambient sound, spawn points and every available weapon class. Include at least two factions, contrasting lighting, a non-Toujane map, a projectile weapon, a missing reference and an intentionally unsupported format.

Record **pass / fail / untested** per asset and behavior; save diagnostics with precise asset paths. A zero-error loader log alone does not establish visual or gameplay equivalence. No blanket support claim should be made until this matrix is executed against complete retail archives and compared with retail behavior.
