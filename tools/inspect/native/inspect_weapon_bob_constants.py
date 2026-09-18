# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE

import pefile,struct,json
p=pefile.PE(str(NATIVE_EXE))
for a in [0x5c40f8,0x5c40f4,0x5c41b8,0x5c3cc4,0x5c3cc0,0x5c41ec,0x5c40d4,0x5c41e8,0x5c3e64,0x5c3d24,0x5c406c,0x5c4068,0x5c4050,0x5c3fa8,0x5c3f9c,0x5c4250]:print(hex(a),struct.unpack('<f',p.get_data(a-0x400000,4))[0])
m=json.load(open('public/maps/mp_toujane/manifest.json'))
print('keys',list(m))
for t in m['textures']:
 if t and 'door' in t['material']:print(t)
