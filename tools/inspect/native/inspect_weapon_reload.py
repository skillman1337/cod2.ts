# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE

import json,pefile,struct,capstone
from pathlib import Path
p=pefile.PE(str(NATIVE_EXE))
for a in range(0x5db800,0x5dc800,4):
 try:
  name,offset,kind=struct.unpack('<III',p.get_data(a-0x400000,12))
  if offset not in [0x78,0xc0,0xc4,0xc8,0xcc,0xd0,0xd4,0xd8,0xdc] and not 0x130<=offset<=0x1b4:continue
  s=p.get_string_at_rva(name-0x400000).decode('ascii')
  if s:print(hex(a),s,hex(offset),kind)
 except Exception:pass
w=json.loads(Path('assets/ui/weapons.json').read_text())
for name,d in w.items():
 if d.get('weaponType')=='bullet': print(name,{k:v for k,v in d.items() if 'reload' in k.lower()})
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_32)
for i in md.disasm(p.get_data(0x4f3060-0x400000,0x20),0x4f3060):print(hex(i.address),i.mnemonic,i.op_str)
