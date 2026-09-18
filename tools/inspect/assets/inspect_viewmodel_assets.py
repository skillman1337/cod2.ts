"""Audit shared gun/hand skeleton names and authored idle channels before renderer integration."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.native_paths import NATIVE_DLL
from lib.retail_paths import MAIN

from pathlib import Path
import zipfile,json
from lib.retail_model import ModelDecoder,pose_model,skin_vertex
entries={};main=MAIN
for archive in sorted(main.glob('*.iwd')):
 with zipfile.ZipFile(archive) as z:
  for name in z.namelist():entries[name]=archive
def read(name):
 with zipfile.ZipFile(entries[name]) as z:return z.read(name)
decoder=ModelDecoder(NATIVE_DLL,read)
channels=json.loads(Path('artifacts/retail-menu-evidence/models/viewmodel_sten_idle.json').read_text())['channels']
for name in ['viewmodel_sten','viewmodel_hands_cloth']:
 model=decoder.load(name)
 print(name,[(i,b['name'],b['parent'],b['pose'][1]) for i,b in enumerate(model['bones'])][:16])
 transforms=pose_model(model,channels);points=[skin_vertex(v,transforms)[0] for s in model['surfaces'] for v in s['vertices']]
 print('bounds',[(min(p[i] for p in points),max(p[i] for p in points)) for i in range(3)])
 print('missing animation channels',set(b['name'] for b in model['bones'])-channels.keys())
Path('artifacts/retail-menu-evidence/models/viewmodel-asset-audit.json').write_text(json.dumps({'models':list(decoder.cache),'status':'skeleton audit only; animated first-person rendering is not implemented'},indent=2))
