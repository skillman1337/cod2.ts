"""Execute the original render-flag dispatch and capture D3D viewport depth ranges."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_DLL

from pathlib import Path
import pefile,struct,json,hashlib
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
path=NATIVE_DLL;raw=path.read_bytes();pe=pefile.PE(data=raw);base=0x10000000
u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(base,pe.get_memory_mapped_image());u.mem_map(0x20000000,0x10000)
def word(a,v):u.mem_write(a,struct.pack('<I',v))
for a,v in [(0x101ce7f4,0x20000100),(0x101d1bf8,0x20000300),(0x20000300,0x20000400),(0x200004bc,0x20001000),(0x10981bc8,0x20000500),(0x20000648,0x3dcccccd)]:word(a,v)
calls=[]
def hook(u,a,size,data):
 if a==0x1003e5a0:
  sp=u.reg_read(UC_X86_REG_ESP);ret=struct.unpack('<I',u.mem_read(sp,4))[0];u.reg_write(UC_X86_REG_ESP,sp+4);u.reg_write(UC_X86_REG_EIP,ret)
 elif a==0x20001000:
  sp=u.reg_read(UC_X86_REG_ESP);ret,device,viewport=struct.unpack('<3I',u.mem_read(sp,12));calls.append(list(struct.unpack('<2f',u.mem_read(viewport+16,8))));u.reg_write(UC_X86_REG_ESP,sp+12);u.reg_write(UC_X86_REG_EIP,ret);u.reg_write(UC_X86_REG_EAX,0)
u.hook_add(UC_HOOK_CODE,hook);cases=[]
for flags in [0,8,16,24]:
 calls.clear();word(0x109ba540,0x3f800000);word(0x109ba544,0);sp=0x20008000;word(sp+0x24,flags);u.reg_write(UC_X86_REG_ESP,sp);u.emu_start(0x1002fbc1,0x1002fc11,count=10000)
 cases.append(dict(flags=flags,viewport=list(calls),near=struct.unpack('<f',u.mem_read(0x10982058,4))[0] if flags==8 else None))
out=Path('artifacts/retail-menu-evidence/renderer');candidate=Path('engine/com/client/screen/scr_draw/rgpu/internal/rgpu_viewmodel.ts');code=pe.get_data(0x2fb8c,0x85)
(out/'native-viewmodel-depth.json').write_text(json.dumps(dict(binary_sha256=hashlib.sha256(raw).hexdigest(),candidate_sha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),range_sha256=hashlib.sha256(code).hexdigest(),cases=cases),indent=2))
(out/'viewmodel-depth.asm').write_text('\n'.join(f'{i.address:08x} {i.bytes.hex()} {i.mnemonic} {i.op_str}' for i in Cs(CS_ARCH_X86,CS_MODE_32).disasm(code,0x1002fb8c)))
print(cases)
