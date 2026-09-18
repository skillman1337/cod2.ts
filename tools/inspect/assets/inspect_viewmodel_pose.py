# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

from pathlib import Path
import json
from lib.retail_model import pose_model,skin_vertex
base=Path('public/viewmodels');hands=json.loads((base/'models/viewmodel_hands_cloth.json').read_text());gun=json.loads((base/'models/viewmodel_sten.json').read_text())
for animation in ['viewmodel_sten_idle','viewmodel_sten_ADS_up']:
 channels=json.loads((base/'animations/viewmodel_sten_idle.json').read_text())['channels']
 overlay=json.loads((base/'animations'/f'{animation if 'ADS' in animation else 'viewmodel_sten_ADS_down'}.json').read_text())['channels']
 for c in overlay.values():
  if c['rotations']:c['rotations']=[c['rotations'][-1]]
  if c['translations']:c['translations']=[c['translations'][-1]]
 channels.update(overlay)
 if 'ADS' in animation:
  for c in channels.values():
   if c['rotations']:c['rotations']=[c['rotations'][-1]]
   if c['translations']:c['translations']=[c['translations'][-1]]
 h=pose_model(hands,channels);attachment=h[next(i for i,b in enumerate(hands['bones']) if b['name']=='tag_weapon')];g=pose_model(gun,channels,attachment)
 print(animation,'tag_weapon',attachment)
 for name,m,t in [('hands',hands,h),('gun',gun,g)]:
  pts=[skin_vertex(v,t)[0] for s in m['surfaces'] for v in s['vertices']];print(name,[(min(p[i] for p in pts),max(p[i] for p in pts)) for i in range(3)])
 print('camera',[(b['name'],h[i]) for i,b in enumerate(hands['bones']) if 'camera' in b['name']])
