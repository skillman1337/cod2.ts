# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script
from lib.retail_paths import MAIN

from pathlib import Path
import zipfile,csv
for archive in sorted(MAIN.glob('*.iwd')):
 with zipfile.ZipFile(archive) as z:
  for name in z.namelist():
   if not name.startswith('soundaliases/') or not name.endswith('.csv'):continue
   lines=z.read(name).decode('cp1252').splitlines();start=next((i for i,l in enumerate(lines) if l.startswith('name,')),None)
   if start is None:continue
   rows=[r for r in csv.DictReader(lines[start:]) if any(r.get('name','').startswith(p) for p in ['step_','jump_','land_'])]
   if rows:print(name,len(rows),[r['name'] for r in rows[:18]],rows[0])
