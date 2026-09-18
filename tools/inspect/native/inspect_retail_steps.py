"""Original-machine step arithmetic and camera cases; bounded blocks, not whole Pmove."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_EXE, RE_WORKSPACE

from pathlib import Path
import hashlib,json,struct,re
import pefile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
root=_PROJECT_ROOT;dest=root/'artifacts/retail-menu-evidence/physics'
raw=NATIVE_EXE.read_bytes()
assert hashlib.sha256(raw).hexdigest()=='bc5a7d561cb993cf43d5d4159b71721b4c4dca239d04de83540977769fcb05b8'
p=pefile.PE(data=raw);u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0x400000,(p.OPTIONAL_HEADER.SizeOfImage+4095)&~4095);u.mem_write(0x400000,p.get_memory_mapped_image());u.mem_map(0x20000000,0x10000)
dossier=[]
for address in [0x4037a0,0x530a30,0x4cebc0,0x4e0910]:
 saved=(RE_WORKSPACE / f'functions/sub_{address:x}/asm.asm').read_text()
 size=int(re.search(r'; size: (\d+)',saved)[1]);code=p.get_data(address-0x400000,size)
 for line in saved.splitlines():
  m=re.match(r'\s+0x([0-9a-f]+)  ((?:[0-9a-f]{2} )+)',line)
  if m:assert p.get_data(int(m[1],16)-0x400000,len(bytes.fromhex(m[2])))==bytes.fromhex(m[2])
 dossier.append({'address':hex(address),'size':size,'sha256':hashlib.sha256(code).hexdigest()})
 (dest/f'{address:x}-step.asm').write_text(saved)
stack=0x20001000;ps=0x20002000;v=0x20003000;ret=0x20004000
def put(a,x):u.mem_write(a,struct.pack('<I',x&0xffffffff))
def f(a,x):u.mem_write(a,struct.pack('<f',x))
def get(a):return struct.unpack('<f',u.mem_read(a,4))[0]
def reset():
 u.mem_write(0x20000000,bytes(0x10000));put(stack,ret);u.reg_write(UC_X86_REG_ESP,stack)
 u.mem_write(ret,b'\xdb\xe3');u.emu_start(ret,ret+2);u.reg_write(UC_X86_REG_FPCW,0x37f)
cases=[]
hashes={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ['engine/common/pm.ts','engine/common/step_view.ts']}
for delta in [-30,-16,-10.5,-10,-.51,-.5,0,.5,.51,1.5,10,10.5,24,30]:
 reset();f(stack+4,delta);u.emu_start(0x4037a0,ret);amount=u.reg_read(UC_X86_REG_EAX);amount=amount if amount<2**31 else amount-2**32
 cases.append({'kind':'quantize','delta':delta,'amount':max(-16,min(24,amount)) if abs(delta)>.5 else 0})
for amount in [-16,0,10,24]:
 for elapsed in [-1,0,25,99,100,101]:
  reset();put(0x143fc30,1000+elapsed);put(0x1442554,1000);f(0x1442550,amount);f(0x1442610,116.125)
  u.emu_start(0x4cebc0,ret);cases.append({'kind':'height','amount':amount,'elapsed':elapsed,'expected':get(0x1442610),'time':struct.unpack('<I',u.mem_read(0x1442554,4))[0]})
for previous in [-16,0,10,24]:
 for elapsed in [0,50,99,100,120]:
  for delta in [-16,10,24]:
   reset();put(0x143fc30,1000+elapsed);put(0x1442554,1000);f(0x1442550,previous);put(stack+0x18,delta+128)
   hook=u.hook_add(UC_HOOK_CODE,lambda uc,a,s,d:uc.emu_stop() if a in [0x4e0e60,0x4e0e8b] else None)
   u.emu_start(0x4e0de6,0,count=1000);u.hook_del(hook)
   cases.append({'kind':'event','previous':previous,'elapsed':elapsed,'delta':delta,'expected':get(0x1442550)})
for rise in [-9,0,1,10,18]:
 reset();u.reg_write(UC_X86_REG_EDI,ps);u.reg_write(UC_X86_REG_ESI,v);u.reg_write(UC_X86_REG_EAX,138)
 f(ps+0x1c,100+rise);f(stack+0x44,100);f(stack+0x20,18)
 for i,x in enumerate([190,45,10]):f(v+i*4,x)
 u.emu_start(0x531049,0x531092)
 cases.append({'kind':'scale','rise':rise,'expected':[get(v+i*4) for i in range(3)]})
for normal,candidate,velocity in [([0,1,0],[1,0,0],[0,10,0]),([0,0,0],[.00001,0,0],[10,0,0]),([0,0,0],[1,0,0],[10,0,0]),([1,0,0],[1,0,0],[10,0,0])]:
 reset();u.reg_write(UC_X86_REG_EBP,ps);u.reg_write(UC_X86_REG_ESI,v)
 for i in range(3):f(ps+i*4,candidate[i]);f(v+i*4,velocity[i]);f(stack+0x3c+i*4,0)
 f(stack+0x6c,normal[0]);f(stack+0x70,normal[1]);u.emu_start(0x530e3d,0x530e70)
 cases.append({'kind':'progress','normal':normal,'candidate':candidate,'velocity':velocity,'expected':not bool(u.reg_read(UC_X86_REG_EFLAGS)&64)})
(dest/'native-step-cases.json').write_text(json.dumps({'scope':'Original-machine arithmetic blocks and complete camera-height helper; no complete collision/step equivalence claim.','executable_sha256':hashlib.sha256(raw).hexdigest(),'functions':dossier,'candidate_hashes':hashes,'cases':cases},indent=2))
print('Captured',len(cases),'native step and camera cases')
