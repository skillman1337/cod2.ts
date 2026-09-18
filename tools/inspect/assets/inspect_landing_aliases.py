# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import runpy
g=runpy.run_path(str(_tool_script('assets/extract_retail_audio.py')))
for name in g['entries']:
 if not name.startswith('soundaliases/') or not name.endswith('.csv'):continue
 lines=g['read'](name).decode('cp1252').splitlines();start=next((i for i,l in enumerate(lines) if l.startswith('name,')),None)
 for line in lines:
  if line.lower().startswith(('land_plr_rock,','land_plr_default,','gear_rattle_plr_run,')):print(name,line[:240])
