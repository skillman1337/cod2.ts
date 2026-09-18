"""Verify the ADS-layer dispatch preceding every ordinary weapon animation."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE, RE_WORKSPACE

from pathlib import Path
import pefile,struct,json,hashlib,re
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
raw=NATIVE_EXE.read_bytes()
assert hashlib.sha256(raw).hexdigest()=='bc5a7d561cb993cf43d5d4159b71721b4c4dca239d04de83540977769fcb05b8'
pe=pefile.PE(data=raw)
for address in [0x4d38e0,0x4d36b0]:
 for line in (RE_WORKSPACE / f'functions/sub_{address:x}/asm.asm').read_text().splitlines():
  m=re.match(r'\s+0x([0-9a-f]+)  ((?:[0-9a-f]{2} )+)',line)
  if m:assert pe.get_data(int(m[1],16)-0x400000,len(bytes.fromhex(m[2])))==bytes.fromhex(m[2])
u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0x400000,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(0x400000,pe.get_memory_mapped_image());u.mem_map(0x20000000,0x10000)
def word(a,v):u.mem_write(a,struct.pack('<I',v))
ps=0x20000100;state=0x20001000;tree=0x20002000;definition=0x20003000;stack=0x20008000;calls=[]
def hook(u,a,size,data):
 if a==0x4d36b0:
  calls.append(u.reg_read(UC_X86_REG_EAX));sp=u.reg_read(UC_X86_REG_ESP);ret=struct.unpack('<I',u.mem_read(sp,4))[0];u.reg_write(UC_X86_REG_ESP,sp+4);u.reg_write(UC_X86_REG_EIP,ret)
u.hook_add(UC_HOOK_CODE,hook)
word(state,tree);word(tree,tree+0x100);word(0x1654204,definition);word(ps+0xd4,1);word(ps+0xd0,1);word(definition+0x524,100);cases=[]
for animation in range(20):
 for flags in [0,0x40,0x10,0x50]:
  for adsSupported in [0,1]:
   calls.clear();word(ps+0x5d0,animation);word(ps+0xd8,animation);word(ps+0xc,flags);word(ps+0x34,200);word(definition+0x32c,adsSupported)
   word(stack+4,ps);word(stack+8,state);u.reg_write(UC_X86_REG_ESP,stack);u.emu_start(0x4d38e0,0x4d3972,count=2000)
   assert len(calls)==adsSupported
   cases.append(dict(animation=animation,flags=flags,adsSupported=adsSupported,calls=list(calls)))
out=Path('artifacts/retail-menu-evidence/weapons/native-weapon-layers.json');out.write_text(json.dumps(dict(binary_sha256=hashlib.sha256(raw).hexdigest(),range_sha256=hashlib.sha256(pe.get_data(0xd38e0,0x92)).hexdigest(),cases=cases),indent=2));print('PASS:',len(cases),'native animation/ADS/layer dispatch cases')
