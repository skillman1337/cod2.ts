# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import json
for m in json.load(open('assets/ui/hud.json')):
 print('MENU',m['name'],[m.get(k) for k in ['rect_x','rect_y','rect_w','rect_h','horz_align','vert_align']])
 for i in m.get('items',[]):print({k:v for k,v in i.items() if k in ['name','ownerdraw','ownerdrawFlag','ownerdrawflag','label','background','rect_x','rect_y','rect_w','rect_h','visible','exp','forecolor','type','textscale','visible_expression']})
