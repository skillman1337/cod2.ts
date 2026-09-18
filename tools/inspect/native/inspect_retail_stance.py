"""Original complete 0x5172d0 table interpolator; all integer-percent branches."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import runpy,json,hashlib,struct
from pathlib import Path
g=runpy.run_path(str(_tool_script('inspect/native/inspect_retail_steps.py')));u=g['u'];reset=g['reset'];v=g['v'];ret=g['ret'];get=g['get']
from unicorn.x86_const import *
cases=[]
for (a,b),table in [((60,40),0x5db630),((40,60),0x5db6a0),((40,11),0x5db710),((11,40),0x5db7b8)]:
 for percent in range(101):
  reset();u.reg_write(UC_X86_REG_EDI,table);u.reg_write(UC_X86_REG_EAX,percent);u.reg_write(UC_X86_REG_EBX,v)
  u.emu_start(0x5172d0,ret,count=1000);u.mem_write(ret,b'\xd9\x1d'+struct.pack('<I',v+4));u.emu_start(ret,ret+6)
  cases.append(dict(a=a,b=b,percent=percent,expected=get(v+4),shift=get(v)))
Path('artifacts/retail-menu-evidence/physics/native-stance-cases.json').write_text(json.dumps(dict(candidate_hashes={name:hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in ['engine/common/stance.ts','assets/ui/stance.json']},cases=cases),indent=2))
print('Captured',len(cases),'native stance interpolation cases')
