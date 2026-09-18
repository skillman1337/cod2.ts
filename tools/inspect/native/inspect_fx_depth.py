# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE

from pathlib import Path
import pefile,struct,re
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
p=pefile.PE(str(NATIVE_EXE));b=p.get_memory_mapped_image();md=Cs(CS_ARCH_X86,CS_MODE_32)
for name in [b'viewFlashEffect\0',b'worldFlashEffect\0',b'depthHack\0',b'relative\0']:
 for m in re.finditer(re.escape(name),b):
  a=m.start()+0x400000;print(name,hex(a))
  for x in re.finditer(re.escape(struct.pack('<I',a)),b):print('ref',hex(x.start()+0x400000),[hex(v) for v in struct.unpack('<3I',b[x.start():x.start()+12])])
for s in re.finditer(rb'[ -~]{5,}',b):
 if any(v in s[0].lower() for v in [b'depthhack',b'depth hack',b'relative',b'depthrange']):print(hex(s.start()+0x400000),s[0][:100])
for i in md.disasm(p.get_data(0x4d3500-0x400000,0x1000),0x4d3500):
 if '0x118]' in i.op_str or '0x11c]' in i.op_str:print(hex(i.address),i.mnemonic,i.op_str)
