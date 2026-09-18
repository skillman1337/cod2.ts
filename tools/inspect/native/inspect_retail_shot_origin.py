"""Execute the lean and minimum-height block in retail's firing eye helper."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE

from pathlib import Path
import pefile,struct,json,hashlib
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32
from unicorn.x86_const import *
raw=NATIVE_EXE.read_bytes()
assert hashlib.sha256(raw).hexdigest()=='bc5a7d561cb993cf43d5d4159b71721b4c4dca239d04de83540977769fcb05b8'
pe=pefile.PE(data=raw);u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0x400000,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(0x400000,pe.get_memory_mapped_image());u.mem_map(0x20000000,0x10000)
def floats(a,v):u.mem_write(a,struct.pack('<'+'f'*len(v),*v))
ps=0x20000100;out=0x20000300;stack=0x20008000;cases=[]
for height in [60,40,11,8]:
 for lean in [-.5,-.25,0,.25,.5]:
  for yaw in [0,45,90,180,270,-90]:
   start=[100,200,240+height];floats(out,start);floats(ps+0x1c,[240]);floats(ps+0x4c,[lean]);floats(ps+0xec,[yaw]);floats(stack,[20])
   u.reg_write(UC_X86_REG_ESP,stack);u.reg_write(UC_X86_REG_ESI,out);u.reg_write(UC_X86_REG_EDI,ps);u.emu_start(0x4fdf39,0x4fdf75,count=1000)
   cases.append(dict(height=height,lean=lean,yaw=yaw,start=start,expected=list(struct.unpack('<3f',u.mem_read(out,12)))))
dest=Path('artifacts/retail-menu-evidence/weapons')
(dest/'native-shot-origin.json').write_text(json.dumps(dict(binary_sha256=hashlib.sha256(raw).hexdigest(),cases=cases),indent=2))
ranges=[(0x527d80,0x54),(0x4fdf31,0x44)]
(dest/'shot-origin.asm').write_text('\n'.join(f'{i.address:08x} {i.bytes.hex()} {i.mnemonic} {i.op_str}' for start,size in ranges for i in Cs(CS_ARCH_X86,CS_MODE_32).disasm(pe.get_data(start-0x400000,size),start)))
print('Captured',len(cases),'native firing-origin cases including minimum-height clamp')
