"""Execute the complete original 0x41bf10 brush trace on bounded fixtures."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import RE_WORKSPACE

import runpy,json,struct,hashlib,re
from pathlib import Path
g=runpy.run_path(str(_tool_script('inspect/native/inspect_retail_steps.py')));u=g['u'];reset=g['reset'];put=g['put'];f=g['f'];get=g['get'];stack=g['stack'];ret=g['ret'];p=g['p']
asm=(RE_WORKSPACE / 'functions/sub_41bf10/asm.asm').read_text()
for line in asm.splitlines():
 m=re.match(r'\s+0x([0-9a-f]+)  ((?:[0-9a-f]{2} )+)',line)
 if m:assert p.get_data(int(m[1],16)-0x400000,len(bytes.fromhex(m[2])))==bytes.fromhex(m[2])
work=0x20005000;brush=0x20006000;trace=0x20007000;sides=0x20008000;planes=0x20009000;material=0x2000a000
manifest=json.loads(Path('public/maps/mp_toujane/manifest.json').read_text());cases=[]
def capture(start,end,b):
 reset()
 for i in range(3):
  f(work+i*4,start[i]-(25 if i==2 else 0));f(work+12+i*4,end[i]-(25 if i==2 else 0));f(work+24+i*4,1/(start[i]-end[i]) if start[i]!=end[i] else 0)
  f(work+0x94+i*4,35 if i==2 else 15);f(brush+i*4,b['bounds'][2*i]);f(brush+16+i*4,b['bounds'][2*i+1])
 f(work+0x8c,15);f(work+0x90,20);put(brush+12,b['contents']);put(brush+28,len(b['planes'])-6);put(brush+32,sides)
 for i,plane in enumerate(b['planes'][6:]):
  for j,value in enumerate(plane):f(planes+i*20+j*4,value)
  put(sides+i*8,planes+i*20);put(sides+i*8+4,0)
 put(0xac9410,material);put(material+64,b['surfaceFlags'][0]);f(trace,1)
 put(stack+4,work);put(stack+8,brush);put(stack+12,trace);u.emu_start(0x41bf10,ret,count=100000)
 cases.append({'start':start,'end':end,'brush':b,'fraction':get(trace),'normal':[get(trace+4+i*4) for i in range(3)],'allsolid':bool(u.mem_read(trace+34,1)[0]),'startsolid':bool(u.mem_read(trace+35,1)[0])})
box={'bounds':[0,100,0,100,0,100],'planes':[[-1,0,0,0],[1,0,0,100],[0,-1,0,0],[0,1,0,100],[0,0,-1,0],[0,0,1,100]],'contents':1,'surfaceFlags':[0]*6}
for distance in [.001,.01,.025,.124,.125,.126,1,10]:
 for motion in [.001,.01,.05,.2,2,-.1,0]:capture([-15-distance,50,80],[-15-distance+motion,50,80],box)
for file,seqs in [('cod2-movement-2026-09-07T13-49-21-723Z-5535af36.json',[354,355,356]),('cod2-movement-2026-09-07T13-51-56-446Z-4525ee1a.json',[1490,923])]:
 data=json.loads(Path('logs/trace/movement',file).read_text())
 for seq in seqs:
  for t in data['frames'][seq]['traces'][:5]:
   for index in [141,142]:capture(t['start'],t['end'],manifest['collision'][index])
Path('artifacts/retail-menu-evidence/physics/native-brush-cases.json').write_text(json.dumps({'function_sha256':hashlib.sha256(p.get_data(0x1bf10,919)).hexdigest(),'candidate_sha256':hashlib.sha256(Path('engine/common/pm.ts').read_bytes()).hexdigest(),'scope':'Complete original brush tracer; synthetic and recorded queries, not full movement equivalence','cases':cases},indent=2))
print('Captured',len(cases),'original brush traces')
