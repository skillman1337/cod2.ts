# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_DLL, NATIVE_EXE

import pefile,json
from pathlib import Path
p=pefile.PE(str(NATIVE_EXE))
for a in [0x5b6300,0x5b6344,0x5a66bc]:print(hex(a),p.get_string_at_rva(a-0x400000))
m=json.loads(Path('public/viewmodels/models/viewmodel_sten.json').read_text())
print([(b['name'],b['parent'],b['pose']) for b in m['bones']])
import struct
p=pefile.PE(str(NATIVE_DLL))
for a in [0x1019be68,0x1019bddc,0x1019be70,0x1019bf98]:print(hex(a),struct.unpack('<f',p.get_data(a-0x10000000,4))[0])
p=pefile.PE(str(NATIVE_EXE))
for a in [0x5c4208,0x5c3ccc,0x5c4044,0x5c4048]:print(hex(a),struct.unpack('<f',p.get_data(a-0x400000,4))[0])
