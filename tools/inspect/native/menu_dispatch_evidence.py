# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE

import pefile, struct
p=pefile.PE(str(NATIVE_EXE))
def data(a,n):return p.get_data(a-0x400000,n)
for a in [0x59bcb8,0x5c3e30]:print(hex(a),struct.unpack('<4f',data(a,16)))
print('console value column',struct.unpack('<f',data(0x5c4138,4)))
for a in [0x5a3588]:print(hex(a),data(a,64).split(b'\0')[0])
for a in [0x5c2844,0x5c2854,0x5c2878,0x5c2894,0x5c28c8,0x5c28dc,0x5c2d64]:print(hex(a),data(a,96).split(b'\0')[0])
for a in struct.unpack('<3I',data(0x5dcb44,12)):print('source',hex(a),data(a,64).split(b'\0')[0])
for id in [220,245,247,250,253,255]:
    index=data(0x5339bc+id-205,1)[0]
    target=struct.unpack('<I',data(0x533978+4*index,4))[0]
    print('owner',id,hex(target))
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
md=Cs(CS_ARCH_X86,CS_MODE_32)
for a,n in [(0x4064c8,80),(0x53aece,24),(0x451f50,70)]:
    for i in md.disasm(data(a,n),a): print(hex(i.address),i.mnemonic,i.op_str)
for a in [0x59bcdc,0x59bcb8,0x59bccc,0x59bd0c]:print('color',hex(a),struct.unpack('<4f',data(a,16)))
