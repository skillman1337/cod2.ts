"""Complete all exported triangle prisms without changing their native face planes."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import json,sys
from pathlib import Path
from lib.collision_bevels import complete_bevels
root=_PROJECT_ROOT
target=root/'public/maps'/sys.argv[1]/'manifest.json'
manifest=json.loads(target.read_text());count=0
for brush in manifest['collision']:
    if len(brush['planes'])!=5:continue
    brush['planes']=complete_bevels(brush['planes']);count+=1
manifest['collision_adapter']='convex-prism-aabb-complete-bevels-v1'
temporary=target.with_suffix('.json.tmp');temporary.write_text(json.dumps(manifest,separators=(',',':'))+'\n');temporary.replace(target)
print('Completed edge/box bevel planes on',count,'triangle proxies')
