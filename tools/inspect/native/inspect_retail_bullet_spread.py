"""Run original spread endpoint code with controlled CRT-rand boundary samples."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE

from pathlib import Path
import pefile,struct,json,hashlib,math
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
raw=NATIVE_EXE.read_bytes();pe=pefile.PE(data=raw)
assert hashlib.sha256(raw).hexdigest()=='bc5a7d561cb993cf43d5d4159b71721b4c4dca239d04de83540977769fcb05b8'
u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0x400000,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(0x400000,pe.get_memory_mapped_image());u.mem_map(0x20000000,0x10000)
def word(a,v):u.mem_write(a,struct.pack('<I',v))
def floats(a,v):u.mem_write(a,struct.pack('<'+'f'*len(v),*v))
samples=[]
def hook(u,a,size,data):
 if a==0x57ba1d:
  sp=u.reg_read(UC_X86_REG_ESP);ret=struct.unpack('<I',u.mem_read(sp,4))[0];u.reg_write(UC_X86_REG_EAX,samples.pop(0));u.reg_write(UC_X86_REG_ESP,sp+4);u.reg_write(UC_X86_REG_EIP,ret)
u.hook_add(UC_HOOK_CODE,hook);basis=0x20000100;out=0x20000300;stack=0x20008000;stop=0x20009000;cases=[]
for spread in [0,.05,1,5,10]:
 for distance in [800,8192]:
  for angle,radius in [(0,0),(0,32767),(8192,32767),(16384,20000),(24576,8000),(32767,32767),(12345,23456)]:
   for yaw in [0,1.2]:
    forward=[math.cos(yaw),math.sin(yaw),0];right=[math.sin(yaw),-math.cos(yaw),0];up=[0,0,1];origin=[100,200,300]
    floats(basis,forward+right+up+origin);word(stack,stop);floats(stack+4,[spread,distance]);samples[:]=[angle,radius]
    u.reg_write(UC_X86_REG_ESP,stack);u.reg_write(UC_X86_REG_EDI,basis);u.reg_write(UC_X86_REG_ESI,out);u.emu_start(0x527360,stop,count=2000)
    assert not samples
    actualBasis=list(struct.unpack('<9f',u.mem_read(basis,36)))
    cases.append(dict(spread=spread,range=distance,angle=angle,radius=radius,origin=origin,forward=actualBasis[:3],right=actualBasis[3:6],up=up,expected=list(struct.unpack('<3f',u.mem_read(out,12)))))
fields={}
for address in range(0x5dbc00,0x5dc800,4):
 name,offset,kind=struct.unpack('<III',pe.get_data(address-0x400000,12))
 if 0x590000<name<0x600000 and offset in [0x59c,0x1dc,0x4bc]:fields[hex(offset)]=pe.get_string_at_rva(name-0x400000).decode(errors='replace')
dest=Path('artifacts/retail-menu-evidence/weapons/native-bullet-spread.json');dest.write_text(json.dumps(dict(binary_sha256=hashlib.sha256(raw).hexdigest(),fields=fields,cases=cases),indent=2));print('Captured',len(cases),'native endpoints;',fields)
