"""Execute original lean timing block and full camera translation helper."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import RE_WORKSPACE

import runpy,struct,json,hashlib,re
from pathlib import Path
g=runpy.run_path(str(_tool_script('inspect/native/inspect_retail_steps.py')));u=g['u'];p=g['p'];f=g['f'];put=g['put'];get=g['get'];reset=g['reset'];stack=g['stack'];ps=g['ps'];v=g['v'];ret=g['ret']
from unicorn.x86_const import *
for address in [0x518f60,0x44b2f0]:
 for line in (RE_WORKSPACE / f'functions/sub_{address:x}/asm.asm').read_text().splitlines():
  m=re.match(r'\s+0x([0-9a-f]+)  ((?:[0-9a-f]{2} )+)',line)
  if m:assert p.get_data(int(m[1],16)-0x400000,len(bytes.fromhex(m[2])))==bytes.fromhex(m[2])
cases=[]
for height in [11,40,60]:
 for value in [-.5,-.25,0,.25,.5]:
  for direction in [-1,0,1]:
   for msec in [1,8,66,350]:
    reset();put(v+4,64 if direction<0 else 128 if direction>0 else 0);put(ps+0xf4,height);f(ps+0x4c,value);f(stack+4,msec)
    u.reg_write(UC_X86_REG_EAX,v);u.reg_write(UC_X86_REG_ESI,ps);u.emu_start(0x518f60,0x51909b,count=1000)
    cases.append(dict(kind='advance',height=height,value=value,direction=direction,msec=msec,expected=get(ps+0x4c)))
for yaw in [0,45,90,180,270,-90]:
 for value in [-1,-.5,-.25,0,.25,.5,1]:
  reset();f(v,100);f(v+4,200);f(v+8,300);f(stack+4,yaw);f(stack+8,value);f(stack+12,16);f(stack+16,20)
  u.reg_write(UC_X86_REG_EDX,v);u.emu_start(0x44b2f0,ret,count=1000)
  cases.append(dict(kind='origin',yaw=yaw,value=value,expected=[get(v+i*4) for i in range(3)]))
Path('artifacts/retail-menu-evidence/physics/native-lean-cases.json').write_text(json.dumps(dict(candidate_sha256=hashlib.sha256(Path('engine/common/lean.ts').read_bytes()).hexdigest(),cases=cases),indent=2))
print('Captured',len(cases),'original lean cases')
