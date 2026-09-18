"""Execute complete original alias selector with synthetic lists and explicit RNG state."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import RE_WORKSPACE

import runpy,json,hashlib,struct,re
from pathlib import Path
g=runpy.run_path(str(_tool_script('inspect/native/inspect_retail_steps.py')));u=g['u'];reset=g['reset'];put=g['put'];f=g['f'];get=g['get'];ps=g['ps'];v=g['v'];ret=g['ret'];p=g['p']
from unicorn.x86_const import *
from unicorn import UC_HOOK_CODE
for line in (RE_WORKSPACE / 'functions/sub_42e660/asm.asm').read_text().splitlines():
 m=re.match(r'\s+0x([0-9a-f]+)  ((?:[0-9a-f]{2} )+)',line)
 if m:assert p.get_data(int(m[1],16)-0x400000,len(bytes.fromhex(m[2])))==bytes.fromhex(m[2])
print('selector multiplier',get(0x5c3e8c),'landing cutoff',get(0x5c4054))
cases=[]
for weights in [[1],[1,1],[1,1,1],[1,1,1,6,.2,.2,.2],[0,1,0]]:
 for seed in [0,1,12345,0xffffffff]:
  reset();put(ps+4,v);put(ps+8,len(weights));put(0xb6bf2c,seed)
  for i,w in enumerate(weights):f(v+i*68+0x34,w)
  sequence=[]
  for iteration in range(100):
   put(g['stack'],ret);u.reg_write(UC_X86_REG_ESP,g['stack']);u.reg_write(UC_X86_REG_EDI,ps);u.emu_start(0x42e660,ret,count=10000)
   sequence.append((u.reg_read(UC_X86_REG_EAX)-v)//68)
  cases.append(dict(weights=weights,seed=seed,sequence=sequence,finalSeed=struct.unpack('<I',u.mem_read(0xb6bf2c,4))[0]))
landing=[]
for height in [0,3.999,4,4.001,7.999,8,8.001,11.999,12,12.001,39]:
 reset();f(g['stack']+12,height);put(g['stack']+28,v);put(v+0x48,17<<20);u.reg_write(UC_X86_REG_ESI,ps)
 branches={0x516c45:None,0x516c91:'walk',0x516cb6:'run',0x516cca:'land'};selected=[]
 def hook(uc,address,size,data):
  if address in branches:selected.append(branches[address]);uc.emu_stop()
 h=u.hook_add(UC_HOOK_CODE,hook);u.emu_start(0x516c4c,0,count=1000);u.hook_del(h);assert len(selected)==1
 landing.append(dict(height=height,kind=selected[0]))
Path('artifacts/retail-menu-evidence/physics/native-sound-choice.json').write_text(json.dumps(dict(candidate_sha256=hashlib.sha256(Path('engine/common/sound_alias.ts').read_bytes()).hexdigest(),cases=cases,landing=landing),indent=2))
print('Captured',sum(len(c['sequence']) for c in cases),'native choices')
