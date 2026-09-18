"""Bounded original triangle-face sweeps with disabled edge/vertex features."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import runpy,json,struct,hashlib
from pathlib import Path
from unicorn.x86_const import UC_X86_REG_EDI,UC_X86_REG_EBX
g=runpy.run_path(str(_tool_script('inspect/native/inspect_retail_steps.py')));u=g['u'];reset=g['reset'];put=g['put'];f=g['f'];get=g['get'];stack=g['stack'];ret=g['ret']
work=0x20005000;triangle=0x20006000;trace=0x20007000;cases=[]
points=[[-1000,-1000,0],[1000,-1000,0],[0,1000,0]]
for start,end in [([0,0,100],[0,0,50]),([0,0,64],[0,0,50]),([0,0,60.125],[0,0,59.875]),([0,0,64],[1,0,64]),([0,0,64],[0,0,100]),([1100,0,64],[1100,0,50])]:
 reset();u.mem_write(triangle,struct.pack('<12f6I',0,0,1,0,.0005,-.00025,0,-.25,0,.0005,0,-.5,*([0xffffffff]*6)))
 for i in range(3):f(work+i*4,start[i]-(25 if i==2 else 0));f(work+12+i*4,end[i]-(25 if i==2 else 0));f(work+36+i*4,end[i]-start[i])
 f(work+0x30,sum((end[i]-start[i])**2 for i in range(3))**.5);f(work+0x34,sum((end[i]-start[i])**2 for i in range(3)));f(work+0x8c,15);f(work+0x90,20)
 f(trace,1);put(stack+4,triangle);f(stack+8,20);u.reg_write(UC_X86_REG_EDI,work);u.reg_write(UC_X86_REG_EBX,trace)
 u.emu_start(0x418d70,ret,count=100000)
 cases.append({'start':start,'end':end,'triangle':points,'face':[0,0,1],'fraction':get(trace),'normal':[get(trace+4+i*4) for i in range(3)]})
p=g['p'];address=0x418d70;code=p.get_data(address-0x400000,2284)
Path('artifacts/retail-menu-evidence/physics/native-capsule-cases.json').write_text(json.dumps({'scope':'Original triangle face path with disabled edge/vertex features; not complete capsule collision equivalence.','function_sha256':hashlib.sha256(code).hexdigest(),'candidate_sha256':hashlib.sha256(Path('engine/common/collision_capsule.ts').read_bytes()).hexdigest(),'cases':cases},indent=2))
print('Captured',len(cases),'native triangle-face sweeps')
