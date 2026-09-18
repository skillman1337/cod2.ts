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
for i in md.disasm(p.get_data(0x97310,0xc0),0x497310):print(hex(i.address),i.mnemonic,i.op_str)
for pattern in [b'Tail\0',b'.?AV',struct.pack('<I',0x496930)]:
 hits=[m.start() for m in re.finditer(re.escape(pattern),b)]
 for h in hits:
  if pattern==b'.?AV' and b'tail' not in b[h:h+65].lower():continue
  print(hex(h+0x400000),repr(b[max(0,h-24):h+80]))
  if pattern==struct.pack('<I',0x496930):
   print([hex(v) for v in struct.unpack('<16I',b[h-16:h+48])])
