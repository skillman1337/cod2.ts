"""Frozen candidate, bounded original machine movement before collision submission."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import RE_WORKSPACE

import runpy,json,hashlib,re,math,struct
from pathlib import Path
from unicorn.x86_const import *
from unicorn import UC_HOOK_CODE
g=runpy.run_path(str(_tool_script('inspect/native/inspect_retail_steps.py')));u=g['u'];p=g['p'];reset=g['reset'];put=g['put'];f=g['f'];get=g['get'];stack=g['stack'];ps=g['ps'];pm=g['v'];pml=pm+0x200;ret=g['ret'];dest=g['dest']
hashes={s:hashlib.sha256(Path(s).read_bytes()).hexdigest() for s in ['engine/common/ladder.ts','engine/common/frame_clock.ts','engine/common/movement_events.ts']}
functions=[]
for address in [0x519f90,0x51a2d0,0x515650,0x515850,0x52fe40,0x518540,0x434f20]:
 saved=(RE_WORKSPACE / f'functions/sub_{address:x}/asm.asm').read_text()
 for line in saved.splitlines():
  m=re.match(r'\s+0x([0-9a-f]+)  ((?:[0-9a-f]{2} )+)',line)
  if m:assert p.get_data(int(m[1],16)-0x400000,len(bytes.fromhex(m[2])))==bytes.fromhex(m[2])
 functions.append(dict(address=hex(address),asm_sha256=hashlib.sha256(saved.encode()).hexdigest()))
def vec(address,values):
 for i,x in enumerate(values):f(address+4*i,x)
def readvec(address):return [get(address+4*i) for i in range(3)]
cases=[]
for pitch,yaw in [(-60,180),(0,180),(60,180),(-14.477512,180),(-30,145),(20,215)]:
 a,b=math.radians(pitch),math.radians(yaw)
 forward=[math.cos(a)*math.cos(b),math.cos(a)*math.sin(b),-math.sin(a)];right=[math.sin(b),-math.cos(b),0]
 for fm,rm in [(127,0),(-127,0),(0,127),(127,127),(0,0)]:
  for velocity in [[0,0,0],[-50,18,95],[25,-45,-95]]:
   for grounded in [False,True]:
    reset();put(pm,ps);put(stack+0x38,pm);put(ps+0xc,0x20);put(ps+0x50,190);put(ps+0x48,800);vec(ps+0x64,[1,0,0]);vec(ps+0x20,velocity)
    u.mem_write(pm+0x1c,struct.pack('bb',fm,rm));vec(pml,forward);vec(pml+12,right);f(pml+0x24,.012);put(pml+0x2c,int(grounded))
    u.reg_write(UC_X86_REG_EBX,pml);u.reg_write(UC_X86_REG_EBP,ps)
    u.emu_start(0x51a2fd,0x51a69d,count=10000)
    cases.append(dict(forward=[struct.unpack('<f',struct.pack('<f',x))[0] for x in forward],right=[struct.unpack('<f',struct.pack('<f',x))[0] for x in right],normal=[1,0,0],fm=fm,rm=rm,velocity=velocity,grounded=grounded,dt=struct.unpack('<f',struct.pack('<f',.012))[0],expected=readvec(ps+0x20)))
jumps=[]
for forward in [[-1,0,0],[1,0,0],[-.6,.8,0],[.6,.8,0]]:
 reset();vec(ps+0x20,[0,0,249.7999]);vec(ps+0x64,[1,0,0]);vec(pml,forward);put(0x189bf84,pm);f(pm+8,128);u.reg_write(UC_X86_REG_EDI,ps);u.reg_write(UC_X86_REG_EBX,pml);u.emu_start(0x52fe40,ret)
 jumps.append(dict(forward=forward,expected=readvec(ps+0x20)))
# Ground reference/rate: skip only animation submission calls, preserving x87.
rates=[]
for stance in [11,40,60]:
 for slow in [False,True]:
  for fm,rm in [(127,0),(-127,0),(0,127),(127,127),(-127,127)]:
   reset();put(pm,ps);put(ps+0xf4,stance);put(ps+0x50,190);put(ps+0xc,0x80 if fm<0 else 0);u.mem_write(pm+0x1c,struct.pack('bb',fm,rm));f(pm+0xdc,150)
   put(stack+0x18,1 if stance==11 else 2 if stance==40 else 0);put(stack+0x1c,int(slow));put(0x186fa74,pm+0x400);f(pm+0x408,.8);put(0x186fa3c,pm+0x420);f(pm+0x428,.7)
   u.reg_write(UC_X86_REG_EBP,pm);u.reg_write(UC_X86_REG_EBX,ps);u.reg_write(UC_X86_REG_EDI,int(slow))
   def hook(uc,a,s,d):
    if a in [0x4f92f0,0x4f9120]:
     esp=uc.reg_read(UC_X86_REG_ESP);target=struct.unpack('<I',uc.mem_read(esp,4))[0];uc.reg_write(UC_X86_REG_ESP,esp+4);uc.reg_write(UC_X86_REG_EIP,target);uc.reg_write(UC_X86_REG_EAX,0)
   h=u.hook_add(UC_HOOK_CODE,hook);u.emu_start(0x51874c,0x518aaa,count=10000);u.hook_del(h)
   rates.append(dict(stance=stance,slow=slow,fm=fm,rm=rm,expected=get(stack+0x10)))
checks=[]
u.mem_map(0x21000000,0x40000);put(0x18cdc7c,0x21000000)
def integer(a):return struct.unpack('<I',u.mem_read(a,4))[0]
for grounded in [False,True]:
 for stance in [11,40,60]:
  for old,detached in [(False,False),(True,False),(False,True)]:
   for fm in [0,127]:
    for jumpElapsed in [299,300]:
     for surface in [0,8]:
      reset();put(stack+4,pm);put(stack+8,pml);put(pm,ps);put(pm+4,2000);put(ps+0x70,2000-jumpElapsed);put(ps+0xf4,stance);put(ps+0xc,(0x20 if old else 0)|(0x40000 if detached else 0));put(ps+0x60,0 if grounded else 1023);put(pml+0x2c,int(grounded));vec(ps+0x64,[1,0,0]);vec(ps+0x14,[100,200,30]);vec(pml,[-1,0,0]);vec(pm+0xc4,[-15,-15,0]);vec(pm+0xd0,[15,15,30 if stance==11 else 50 if stance==40 else 70]);u.mem_write(pm+0x1c,struct.pack('b',fm));queries=[]
      def tracehook(uc,a,s,d):
       if a!=0x515280:return
       esp=uc.reg_read(UC_X86_REG_ESP);out=uc.reg_read(UC_X86_REG_EBX);queries.append(dict(start=readvec(integer(esp+4)),mins=readvec(integer(esp+8)),maxs=readvec(integer(esp+12)),end=readvec(integer(esp+16))))
       f(out,.5);vec(out+4,[1,0,0]);put(out+16,surface);uc.reg_write(UC_X86_REG_EIP,integer(esp));uc.reg_write(UC_X86_REG_ESP,esp+4)
      h=u.hook_add(UC_HOOK_CODE,tracehook);u.emu_start(0x519f90,ret,count=10000);u.hook_del(h);flags=integer(ps+12)
      checks.append(dict(grounded=grounded,stance=stance,old=old,detached=detached,fm=fm,jumpElapsed=jumpElapsed,surface=surface,attached=bool(flags&0x20),resultDetached=bool(flags&0x40000),queries=queries))
clocks=[]
for maxfps in [0,30,60,85,125,240,1000]:
 for dedicated in [False,True]:
  reset();put(0xb6af00,pm);put(pm+8,int(dedicated));u.reg_write(UC_X86_REG_ECX,maxfps);u.emu_start(0x434f6d,0x434f96,count=1000);clocks.append(dict(maxfps=maxfps,dedicated=dedicated,expected=u.reg_read(UC_X86_REG_EDI)))
(dest/'native-ladder.json').write_text(json.dumps(dict(scope='Bounded ordinary ladder movement through velocity preparation, full jump helper, attachment with scripted traces, grounded cadence and frame limit blocks. Collision/animation callbacks excluded; no full Pmove equivalence claim.',executable_sha256=g['hashlib'].sha256(g['raw']).hexdigest(),candidate_hashes=hashes,functions=functions,cases=cases,jumps=jumps,rates=rates,checks=checks,clocks=clocks),indent=2))
print('Captured',len(cases),'ladder velocity cases,',len(jumps),'jump cases,',len(rates),'cadence cases')

