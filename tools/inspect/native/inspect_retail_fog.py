"""Freeze world shader and execute the original fog color selection with a D3D boundary."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_DLL

from pathlib import Path
import pefile,struct,json,hashlib
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
path=NATIVE_DLL;raw=path.read_bytes();pe=pefile.PE(data=raw);base=pe.OPTIONAL_HEADER.ImageBase
u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(base,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(base,pe.get_memory_mapped_image());u.mem_map(0x20000000,0x10000)
def word(a,v):u.mem_write(a,struct.pack('<I',v))
for a,v in [(0x101d620c,1),(0x101ce7f4,0x20000100),(0x101d1bf8,0x20000300),(0x20000300,0x20000400),(0x200004e4,0x20001000),(0x10981cc8,0x008090a0)]:word(a,v)
calls=[]
def hook(u,a,size,data):
 if a==0x20001000:
  sp=u.reg_read(UC_X86_REG_ESP);ret,device,state,value=struct.unpack('<4I',u.mem_read(sp,16));calls.append([state,value]);u.reg_write(UC_X86_REG_ESP,sp+16);u.reg_write(UC_X86_REG_EIP,ret);u.reg_write(UC_X86_REG_EAX,0)
u.hook_add(UC_HOOK_CODE,hook);cases=[]
for mode in [0,1,2]:
 for dst in range(1,12):
  calls.clear();word(0x109ba480,(dst<<4)|2);word(0x109ba5d8,0xdeadbeef);word(0x20002000,0x20003000);u.reg_write(UC_X86_REG_ESP,0x20002000);u.reg_write(UC_X86_REG_EAX,mode)
  u.emu_start(0x10035070,0x20003000,count=10000);assert len(calls)==1 and calls[0][0]==34;cases.append(dict(mode=mode,dst=dst,color=calls[0][1]))
candidate=Path('engine/com/client/screen/scr_draw/rgpu/internal/rgpu_level.ts')
Path('artifacts/retail-menu-evidence/renderer/native-fog.json').write_text(json.dumps(dict(binary_sha256=hashlib.sha256(raw).hexdigest(),candidate_sha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),cases=cases),indent=2))
print('Captured',len(cases),'native fog color branches')
