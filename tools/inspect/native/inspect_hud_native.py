"""Read HUD registration constants and strings from the original PE, not pseudo-code."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE

import pefile, struct, json
p=pefile.PE(str(NATIVE_EXE))
for a in [0x5b3ee0,0x5b3ed0,0x5b3ec0,0x5b3eb0,0x5b534c,0x5b5348,0x5a9960]:
 print(hex(a),p.get_data(a-0x400000,100).split(b'\0')[0])
for a in [0x5c413c,0x5c4068,0x5c4140,0x5c4220,0x5c3d38,0x5c40f0]:print(hex(a),struct.unpack('<f',p.get_data(a-0x400000,4))[0])
d=json.load(open('assets/ui/dvars.json'))
print('dvars',[(v['name'],v.get('default')) for v in d['dvars'] if 'hud' in v['name'].lower() or 'compass' in v['name'].lower()])
w=json.load(open('assets/ui/weapons.json'))['sten_mp']
print('weapon', {k:v for k,v in w.items() if any(s in k.lower() for s in ['icon','display','ammo','clip'])})
