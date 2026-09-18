"""Freeze candidate, execute original atlas initialization/update at renderer API boundary."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE

from pathlib import Path
import pefile,struct,json,hashlib,itertools
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
path=NATIVE_EXE;raw=path.read_bytes();pe=pefile.PE(data=raw)
u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0x400000,(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(0x400000,pe.get_memory_mapped_image());u.mem_map(0x20000000,0x10000)
def word(a,v):u.mem_write(a,struct.pack('<I',v&0xffffffff))
def flt(a,v):u.mem_write(a,struct.pack('<f',v))
def hook(u,a,size,data):
 if a==0x20001000:
  sp=u.reg_read(UC_X86_REG_ESP);ret=struct.unpack('<I',u.mem_read(sp,4))[0];u.reg_write(UC_X86_REG_ESP,sp+4);u.reg_write(UC_X86_REG_EIP,ret);u.reg_write(UC_X86_REG_EAX,frames)
u.hook_add(UC_HOOK_CODE,hook);word(0x652220,0x20001000);word(0x5d7684,0x20000800)
cases=[];obj=0x20004000;definition=0x20005000;sp=0x20008000
for startMode,rateMode,loopMode,loops,elapsed in itertools.product(range(4),range(3),range(3),[0,1,3],[0,99,100,1000,3000]):
 frames=16;life=700;index=3;seed=1234567;fixed=14;fps=30
 word(definition+0x288,startMode);word(definition+0x28c,fixed);word(definition+0x290,rateMode);flt(definition+0x294,fps);word(0x5cef00,seed)
 word(sp+4,frames);word(sp+0x10,life);word(sp+0x14,index);u.reg_write(UC_X86_REG_ESP,sp);u.reg_write(UC_X86_REG_ESI,definition);u.reg_write(UC_X86_REG_EAX,frames)
 u.emu_start(0x4a160b,0x4a1573,count=1000)
 word(obj+0x108,u.reg_read(UC_X86_REG_ECX));word(obj+0x10c,u.reg_read(UC_X86_REG_EAX));word(obj+0x110,loopMode);word(obj+0x114,loops);word(obj+0xb8,0);word(0x20000804,elapsed)
 word(sp,0x20009000);u.reg_write(UC_X86_REG_ESP,sp);u.reg_write(UC_X86_REG_ESI,obj);u.emu_start(0x495f30,0x20009000,count=10000)
 result=struct.unpack('<i',u.mem_read(obj+0x94,4))[0]
 part=dict(kind='Particle',sequenceStartFrameMode=[str(startMode)],sequencePlayRateMode=[str(rateMode)],sequenceLoopMode=[str(loopMode)],sequenceLoopTimes=[str(loops)],sequenceFixedFrameValue=[str(fixed)],sequenceFixedFpsValue=[str(fps)])
 cases.append(dict(part=part,frames=frames,elapsed=elapsed,life=life,index=index,random=(((seed*214013+2531011)&0xffffffff)>>17)/32768,frame=result))
candidate=Path('engine/common/weapon_fx.ts')
Path('artifacts/retail-menu-evidence/weapons/native-fx-sequence.json').write_text(json.dumps(dict(binary_sha256=hashlib.sha256(raw).hexdigest(),candidate_sha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),cases=cases),indent=2))
print('Captured',len(cases),'native atlas cases')
