# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import RE_WORKSPACE

import runpy,struct,json,hashlib,re
from pathlib import Path
g=runpy.run_path(str(_tool_script('inspect/native/inspect_retail_steps.py')));u=g['u'];p=g['p'];f=g['f'];put=g['put'];get=g['get'];reset=g['reset'];stack=g['stack'];ps=g['ps'];v=g['v']
from unicorn.x86_const import UC_X86_REG_ESI,UC_X86_REG_ECX
for address in [0x5c3e10,0x5c41dc,0x5c41d4,0x5c3cbc,0x5c3cc8,0x5c3d24]:print(hex(address),struct.unpack('<f',p.get_data(address-0x400000,4))[0])
for address in [0x516990,0x4ceda0]:
 asm=(RE_WORKSPACE / f'functions/sub_{address:x}/asm.asm').read_text()
 for line in asm.splitlines():
  m=re.match(r'\s+0x([0-9a-f]+)  ((?:[0-9a-f]{2} )+)',line)
  if m:assert p.get_data(int(m[1],16)-0x400000,len(bytes.fromhex(m[2])))==bytes.fromhex(m[2])
cases=[]
for velocityZ in [-30,-100,-234,-400]:
 for drop in [0,.1,1,10]:
  reset();u.reg_write(UC_X86_REG_ESI,ps);put(stack+4,v);put(ps+0x48,800);f(ps+0x1c,100-drop);f(v+0x68,100);f(v+0x74,velocityZ)
  u.emu_start(0x516990,0x516a2a,count=1000);cases.append({'kind':'impact','start':100,'end':100-drop,'velocityZ':velocityZ,'gravity':800,'expected':get(stack-12)})
for amount in [2,4,8,16,24]:
 for elapsed in [0,1,75,149,150,151,300,449,450,600]:
  reset();f(0x1442558,-amount);f(0x1442610,100);put(stack+0x30,elapsed);u.reg_write(UC_X86_REG_ECX,1000+elapsed)
  u.emu_start(0x4cf041,0x4cf0c8,count=1000);cases.append({'kind':'height','amount':amount,'elapsed':elapsed,'expected':get(0x1442610)})
for height in [0,2,8,12,13,20,36,39,64,128,256]:
 reset();f(stack+0xc,height);u.emu_start(0x516ac3,0x516ae4,count=1000)
 cases.append({'kind':'amount','height':height,'expected':min(24,u.reg_read(g['UC_X86_REG_EAX'])) if height>12 else 0})
Path('artifacts/retail-menu-evidence/physics/native-landing-cases.json').write_text(json.dumps({'candidate_sha256':hashlib.sha256(Path('engine/common/landing.ts').read_bytes()).hexdigest(),'cases':cases},indent=2));print('Captured',len(cases),'landing cases')
