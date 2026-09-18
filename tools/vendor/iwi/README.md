The IWI wavelet decoder is adapted from OpenAssetTools by Laupetin and contributors:
https://github.com/Laupetin/OpenAssetTools/tree/main/src/ObjImage/Image

Upstream files: IwiWaveletDecoder.cpp and IwiWaveletDecoder.h.
License: GNU GPL version 3; see LICENSE in this directory.

decoder_core.inc adapts the upstream decoder for standalone compilation.
decode_main.cpp is the extraction adapter used by tools/lib/iwi.py. This code
runs during asset extraction, not in the browser renderer. Extracted game assets
remain retail game data; this notice does not license those assets.
