# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import json,struct,numpy as np
m=json.loads(Path('public/maps/mp_toujane/manifest.json').read_text())
raw=Path('public/maps/mp_toujane/world.bin').read_bytes();v=np.frombuffer(raw,dtype='<f4').reshape(-1,18);layers=np.frombuffer(raw,dtype='<u4').reshape(-1,18)[:,17]&65535
for d in m['draws']:
 i=d['start'];n=d['count'];t=m['textures'][layers[i]]
 if t and ('door' in t['material']):
  p=v[i:i+n,:3];print(t['material'],i,n,p.min(axis=0).tolist(),p.max(axis=0).tolist(),d['state'])
