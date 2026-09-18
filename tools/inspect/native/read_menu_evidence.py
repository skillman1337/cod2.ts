# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE

from pathlib import Path
import pefile,struct
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
p=pefile.PE(str(NATIVE_EXE))
for addr in [0x5a1d54,0x5a1d4c,0x5a1d40,0x59bcb8,0x5c3bcc]:
    print(hex(addr),p.get_data(addr-0x400000,80).split(b'\0')[0])
for addr in [0x5c3d24,0x5c3f98,0x5c3e50,0x5c3e10,0x5c413c]:print(hex(addr),struct.unpack('<f',p.get_data(addr-0x400000,4))[0])
md=Cs(CS_ARCH_X86,CS_MODE_32)
for a,b in [(0x4597eb,0x459b00),(0x5dcca0,0x5dccb0)]:
    data=p.get_data(a-0x400000,b-a)
    if a==0x5dcca0:
        print('game type script table',data.hex());continue
    for i in md.disasm(data,a):print(hex(i.address),i.bytes.hex(),i.mnemonic,i.op_str)
